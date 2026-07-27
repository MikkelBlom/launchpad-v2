# Sessions — Launchpad v2

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
