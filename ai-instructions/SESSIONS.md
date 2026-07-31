# Sessions — Launchpad v2

## 2026-07-31 — The CLI now names a stale service instead of crashing on it

**Agent:** Claude Code (Opus 5).

Reported: `launchpad ports` → `Cannot read properties of undefined (reading 'map')`, and
`launchpad ports detect` → `result.claimed is not iterable`.

**Cause:** the service was still serving the previous build. `/api/health` said `apiVersion: 4`
and `/api/ports` still returned `{projects, listening, suggested}`, so the v5 CLI read
`overview.claims` and `result.claimed` off an object that has neither. `dist/server/index.js`
was dated before the ports commit while the node process had started that morning — a restart
of a build that had never been run.

**The actual defect** is not the mismatch; it is that the mismatch was unreadable. `apiVersion`
exists so a CLI can detect a Launchpad older than the commands it knows, it was bumped to 5, and
nothing checked it. Fixed: `REQUIRES_API = 5` in the CLI, one `/api/health` before dispatch
(skipped for `guide`/`ping`), and a message that says rebuild **and** restart — because
rebuilding alone leaves the old bundle in memory, which is exactly what happened here. `ping`
reports the same thing rather than printing a version and leaving the reader to compare. The two
crash sites also default their fields now, so a half-upgraded service degrades instead of
throwing.

**Verified** against the live v4 service (all three commands print the instruction, exit 1) and
against the new build on a copy of the live database (`ports`, `ports detect`, and every way of
re-claiming 8081: for its current owner → idempotent, with a label → updates in place, for
another project → 409 with `--force` offered).

**Note for next time:** `npm run build` while the service is running puts the *new* UI in front
of the *old* API, and `ProjectCard` maps over `project.ports`, which a v4 service does not send —
so the dashboard breaks, not just the ports page. Build and restart together.

## 2026-07-30 (latest) — A project can claim many ports, and claiming is enforced

**Agent:** Claude Code (Opus 5).

Reported: a project should be able to claim several ports (it runs several processes). Two bugs
came with the report — 3000 was claimed by two projects at once even though it is permanently
taken on this machine, and `ports free` suggested 7431 while another project already held it.

**What was actually wrong.** `setProjectPort` only range-checked. `checkPort` knew about
`RESERVED_PORTS` and about other projects' claims, but nothing consulted it before writing: the
CLI printed its verdict as a *warning* and claimed anyway. Detection was worse — it stored
whatever the config file said, which is how three projects came to hold 3000, each "detected"
from its own `.claude/launch.json`. `PATCH /api/projects/:id` passed its body straight to
`updateProject`, so `devPort` could be written unvalidated (a string `"7431"` would never have
matched the numeric claim index — invisible to both the suggester and the conflict check).
`suggestPorts` did exclude claims, but nothing about its output said so, and nothing stopped the
port it suggested from being claimed by someone else a second later.

**Built:**
- Migration v6 → `project_ports` (project_id, port, label, source, sort), seeded from the old
  columns. UNIQUE is `(project_id, port)`, deliberately not `port` alone: the collision has to be
  representable so the UI can show it, and a unique index would have failed on the live data.
- `assertClaimable` — the single gate every write goes through. Reserved: refused, `--force` or
  not. Held by another project: 409 naming them, forceable. Detection routes through it too.
- `Project.ports` (ordered; first is primary) with `devPort`/`devPortSource` derived from it.
- Detection reads *all* ports the winning file declares (compose mappings, launch.json
  configurations, `dev:web` + `dev:api`), caps at 6, and reports what it refused.
- `ports free` returns what it skipped and why. UI + CLI + the agent CLAUDE.md block all updated.
- Backup version 4 includes `project_ports`; restoring an older backup rebuilds claims from the
  legacy columns rather than silently leaving every project portless.

**Also fixed (pre-existing, hit constantly by the new refusal path):** the CLI aborted with a
libuv assertion and exit code **127** instead of 1 whenever an error followed an earlier request
— a keep-alive socket still open at `process.exit()`. Requests now send `Connection: close` and
the error path sets `process.exitCode`. Reproduced against an untouched route before changing
anything, so this is not a regression from this work.

**Verified:** on a **copy** of the live database (`LAUNCHPAD_DATA_DIR`, service on 7439, per the
"dev is not a sandbox" rule). Migration preserved every existing claim including the 3000
collision; conflict → 409, reserved → refused even with `--force`, three ports on one project,
`set port` replaces while `ports add` appends, detection of a compose file declaring 7440/7441 +
3000 claimed the first two and explained the third, `PATCH devPort` → 400, a refused claim left
the project untouched. UI checked in the browser against that same copy (conflict + reserved
banners, per-project grouping, live check-as-you-type, refusal toast). `tsc --noEmit` clean.

**Not done:** the live database still has three projects on 3000 and one on 3001 — real data, not
mine to rewrite. The ports page now flags them; they need moving to free ports.

## 2026-07-30 (later) — Onboarded projects offering to onboard again

**Agent:** Claude Code (Opus 5).

Reported symptom: projects already onboarded were showing the **Onboard** button again. The
symptom was cosmetic; the cause was not.

**Root cause: project ids are not stable, and two places treated one as an identity.** A duplicate
merge keeps one registration and frees the other's id for reuse. "Ada Lovelace Day Program" was
onboarded as #13 and is now #35 — and **#13 now belongs to "Program Management System"**. "Finance
Tracker" was onboarded as #1, which no longer exists.

- `isOnboarded()` demanded id equality, so a moved id read as never-onboarded → the button.
- **`resolveProject()` in the CLI trusted the binding's id outright**, so inside Ada's folder it
  resolved to *PMS*. An agent running `launchpad task add` there would have written to the wrong
  project. That is the bug that mattered.

Fixed by making **the folder the identity and the id a cache**: `isOnboarded(path)` only checks for
a parseable binding (and deliberately repairs nothing — `mapRow` runs on every list); the CLI
resolves the binding's folder against the service, lets that win, and rewrites a stale binding
(warning on **stderr**, since stdout may be agent-parsed JSON). Bindings now also record `path`, so
a *copied* binding and a *reused* id are both detectable and are refused rather than followed.

**Verified:** the 2 broken projects report onboarded again and the other 22 (genuinely never
onboarded) still show the button — confirmed in the DOM of the running app, 22 buttons, none on the
3 onboarded projects. `launchpad whoami` in Ada's folder now resolves #35 and repairs the file;
in Finance Tracker's, #4; in launchpad-v2's it stays silent. Re-ran onboarding for both to refresh
the CLAUDE.md block and LAUNCHPAD.md, which named the stale ids in prose.

## 2026-07-30 — Packaged installer, and start-at-login finally works

**Agent:** Claude Code (Opus 5).

Mikkel's ask: "where do I build the desktop installer, the program still isn't launching at
startup, and I want the desktop app." The answer to the first was *nowhere yet* — the installer
was still open item `#13`, and it was also the cause of the second. He also had **no Launchpad
Start Menu shortcut at all**, so there was nothing to click even manually.

- **`electron-builder.yml`** — NSIS, per-user install to `%LOCALAPPDATA%\Programs\Launchpad`
  (chosen because that path has **no spaces**: Electron writes the Run value unquoted, so
  per-machine/Program Files would break the `--hidden` argument). Packages the shell only:
  `electron/**` + `resources/**` + `package.json`, `!node_modules/**/*` → a 37 KB asar.
  `npm run dist` → `release/Launchpad-Setup-0.1.0.exe` (76 MB with the Electron runtime).
- **`electron/appRoot.cjs`** — resolves the working copy the shell reads the app from:
  `LAUNCHPAD_APP_DIR` → `shell.json` → baked `app-dir.json` → (unpackaged) the repo. Each
  candidate is validated, so a stale one falls through instead of producing a blank window. Tray
  → **Change app folder…** re-points it; startup shows a picker with what it tried.
- **`scripts/bake-app-dir.mjs`** (`npm run bake`) — writes this repo's path into
  `resources/app-dir.json` before packaging, and refuses to bake without a server build.
- **`electron/main.cjs`** — `"main"` field added to package.json (a packaged app has nothing else
  to go on); `requestSingleInstanceLock()` so the Start Menu entry raises the running window;
  `--hidden` start for the login case (tray only, window created lazily); per-channel
  `app.setName()` so installed / from-source / dev shells don't share one lock; unpackaged runs
  now refuse to write the login item instead of writing a broken one.
- **`scripts/make-shortcuts.mjs`** — no longer creates a stable "Launchpad" shortcut; the
  installer owns that name now.

**Verified on the real machine:** installer built and installed silently; Start Menu + Desktop
shortcuts created; app launches, spawns the server under system Node from the working copy, serves
the UI on :7420; the Run key gets written as
`dk.mikkelblom.launchpad = …\Programs\Launchpad\Launchpad.exe --hidden`; executing that exact
string starts the app and its server; value stable across a 100-second watch. **Not verifiable
without a reboot: an actual Windows login.**

**Watch-out (see WORKING_NOTES):** mid-verification, all three registry readers agreed the value
had reverted to a stale `release\win-unpacked` path whose folder had already been deleted — nothing
live could have written it — alongside three `EPERM` process-spawn failures. That signature points
at Bitdefender ATC rolling back a persistence write. The app repaired it on the next window focus.
If autostart doesn't survive a reboot, read the Run value before suspecting the shell.

## 2026-07-27 — Agent read/write surface (push/pull, item tags, per-project handles)

**Agent:** Claude Code (Opus 5).

Goal: let AI agents do "most everything" in Launchpad, and make each agent session target one
specific project without having to pick it from a list of 30.

- **Design calls made with Mikkel:** agents archive but never delete; item-level tags built now
  (not deferred); CLI only (no MCP for now — he uses Claude almost exclusively, and `npm link`
  is the only setup).
- **Pushed back on** markdown round-tripping for "push" (that was the v1 failure mode). Push is
  an explicit, schema-validated JSON plan applied through the API instead.
- **Migration v3** + provenance + `changes` log + `item_tags`; `tasks.body` added (tasks were
  title-only, so an ingesting agent had nowhere to put context).
- **`services/agentPush.ts`** — merge-only, idempotent-by-title batch apply. Dry-run runs the
  identical path inside a rolled-back transaction. Pre-apply DB backup to `<dataDir>/backups/`.
- **`services/audit.ts`, `services/agentDocs.ts`, `services/provenance.ts`**, routes in
  `routes/agent.ts`.
- **CLI rewritten** as `cli/launchpad.mjs` (~30 commands). `cli/launchpad-pull.mjs` is kept as a
  one-line shim so an existing `npm link` install doesn't break.
- **UI:** tag chips + inline adder on every item, "Show archived" toggles, archive buttons, a
  "Hand this project to an agent" panel (copy prompt / copy commands / write CLAUDE.md block),
  and a "Gaps" panel backed by the audit endpoint.

**Verified:** `tsc --noEmit` clean; every CLI command exercised against the live service on a
throwaway project (since deleted) — including dry-run-then-apply, a second identical push
returning `0 created, 0 updated, 8 unchanged`, and the archived-item guard. UI verified in the
browser: tag add round-trips and lands in the change log with the right source.

**Watch-out:** the running server was `node --import tsx src/server/index.ts` (no `watch`), spawned
by the Electron shell, so it needed a manual restart to pick up changes. Electron does **not**
respawn its server child on exit — after this session, restart the desktop app once so it owns
its own server process again.

## 2026-07-07 — Big feature batch (35 items across dashboard, projects, tasks, capture, CLI)

**Agent:** Claude Code (Opus 4.8), autonomous session (no new dependencies allowed).

Implemented ~35 features (see ROADMAP.md). Highlights:
- **Data layer:** migration v2 (task `due_date`, `tags` + `project_tags`). Repos: tags, task
  reorder/due dates. Services: insights (stats/activity/search), git history, JSON backup/restore,
  duplicate detection + merge. Settings gained scan depth, exclude dirs, default sort/group.
- **API:** tags CRUD + project assignment, `/stats`, `/activity`, `/search`, `/projects/:id/commits`,
  `/projects/:id/readme`, `/export-file`, `/open-terminal`, `/duplicates`, `/merge`, `/backup`,
  `/restore`, `/data-dir`, `/open-data-folder`, `/projects/bulk[-delete]`, `/tasks/:id/move`.
  Also fixed empty-JSON-body handling (belt-and-suspenders with the client).
- **UI:** command palette (Ctrl-K) + global shortcuts (n, g d/i/a/s, /, esc); dashboard stats header,
  needs-attention, sort/group, tag filter, bulk select; Activity view; project detail gained tags,
  rename, delete-confirm, export, terminal, git-history + README tabs; tasks got due dates, a board
  view, reorder, and filters; ideas convert-to-note + filter; notes pin + search; smart capture
  parsing (#project, task:/idea:/note:, URLs) + kind selector; inbox bulk; responsive mobile layout
  + hamburger drawer; PWA manifest + icons + favicon.
- **CLI:** added `list`, `open`, `note "…"` commands.

**Verified:** full `tsc --noEmit` passes; `vite build` + esbuild server build succeed; icons generate.
Runtime endpoint/UI verification was interrupted by a tooling (shell) outage — migration is atomic
(BEGIN/COMMIT, rolls back to v1 on any failure, so no corruption risk) and typecheck/build are green.

## 2026-07-07 — Bug fixes (scan/add), old-project import, durability

**Agent:** Claude Code (Opus 4.8)

**Fixed:**
- **Scan "bad request"** — bodyless POSTs (scan/open/run/rescan) sent `Content-Type: application/json`
  with no body, which Fastify rejects as an empty body (400). Now: client only sets the JSON
  content-type when there's a body, and the server has a lenient JSON parser that treats an empty
  body as `undefined`. The "add button doesn't work" report shared this root cause — adding a
  project root worked, but the follow-up scan 400'd so nothing appeared.
- **DB durability** — switched SQLite from WAL to rollback-journal (`journal_mode=DELETE`,
  `synchronous=FULL`) so committed data survives the hard `taskkill /F` the Electron shell uses on
  quit. Added a graceful `closeDb()` on SIGINT/SIGTERM. Verified: 32 projects survived a force-kill + reopen.

**Added:**
- **Import from old Launchpad** — reads the original app's `config.json` registry
  (`%APPDATA%\Launchpad` or `\launchpad`), imports each project. Stale paths (e.g. old OneDrive
  paths the user no longer has) are relocated by stripping the `OneDrive\` segment or searching for a
  folder of the same name under the configured roots / Desktop. `notFound` projects are reported.
  Endpoint `POST /api/import/old-launchpad`; button in Settings with a result summary.
- Discovered/imported projects now get seeded default launch profiles (was scaffold-only).

**Verified:** imported all 12 old projects; dashboard shows 32 total (scan + import); durability
under force-kill; full typecheck + production build clean.

**Note:** heavy testing spawned orphaned `tsx watch` server processes on Windows that held port 7420
(so hot-reload hit stale code). Not a product bug, but the Electron shell should ensure it doesn't
leave orphans; worth hardening.

## 2026-07-06 — Ground-up rebuild, Phases 0–4 + agent CLI

**Agent:** Claude Code (Opus 4.8)

**Summary:** Analyzed the original Launchpad, diagnosed why it stalled (parseable-markdown-as-
database + confusing GitHub/mobile sync), and rebuilt from scratch as a local service.

**Built:**
- Fastify + `node:sqlite` server (config, migrations, repos, services, routes) on :7420.
- Scanner deriving git status + stack + README description; discovery under configured roots.
- React/Vite/Tailwind UI: dashboard (cards, search, filters, favorites), project detail
  (overview/tasks/ideas/notes + launch bar), capture bar, inbox, settings, new-project wizard.
- Launcher (vscode/shell/url/folder), scaffolder (folder + files + git + optional gh + seed profiles).
- Exporter + zero-dep CLI `launchpad pull` / `status` (resolves project by cwd → LAUNCHPAD.md).
- Thin Electron shell (window + tray + start-at-login) spawning the server under system Node.

**Verified:** server API end-to-end (health/settings/scan/projects/notes/ideas/tasks/export),
discovery against real folders (found `launchpad` + `launchpad-v2` with real git status), the
dashboard + detail rendering (via DOM inspection), the CLI pull round-trip, production build
serving the UI at :7420, and the scaffolder (created + cleaned up a scratch project). Full
typecheck passes.

**Not yet:** manual Electron GUI launch; old-registry import; packaged installer.

**Next steps:** run the desktop app manually; import old projects; consider global-hotkey
capture and an optional local-AI assist.
