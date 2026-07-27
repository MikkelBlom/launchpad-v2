# Features — Launchpad v2

Plain status tracker (readable markdown — this is not machine-parsed).

## Done (v0.1 — initial build)

- **Local service** — Fastify server on :7420, serves API + built web UI. Runs under system Node.
- **SQLite data layer** — `node:sqlite`, migrations, repos for projects/notes/ideas/tasks/captures/launch profiles/settings.
- **Project radar** — configurable roots, discovery scan (2 levels deep), git status (branch, last commit, dirty, ahead/behind), stack detection, README-derived description, derived activity (fresh/recent/stalled/dormant).
- **Dashboard** — project cards with status/activity/git/stack/counts, search + activity filter, favorites, quick launch buttons.
- **Project detail** — overview (editable description + agent-pull card), tasks (todo/doing/done + priority), ideas (add/promote-to-task/delete), notes (free-form), launch profiles (run/add/delete).
- **Launch profiles** — vscode / shell (dev server in a terminal) / url / folder, seeded defaults on discovery.
- **Quick capture + Inbox** — capture bar → inbox → file onto a project as task/idea/note.
- **New project wizard** — scaffold folder + README + .gitignore + ai-instructions/, git init, optional GitHub repo (gh), seed launch profiles, register.
- **Agent CLI** — `launchpad pull` / `launchpad status`, resolves project by cwd, writes `ai-instructions/LAUNCHPAD.md` (+ `.launchpad.json`).
- **Desktop shell** — Electron window + tray + start-at-login; spawns the server under system Node.
- **Settings** — project roots, editor command, github user, scan-on-startup, CLI install hint.
- **Import from old Launchpad** — reads the original registry and imports projects, relocating stale/OneDrive paths by name; result summary in Settings.

## Done (v0.2 — agent read/write surface)

- **Migration v3** — `tasks.body`, `archived_at` on tasks/notes, `source` + `updated_by` on
  tasks/ideas/notes, polymorphic `item_tags` (tags on individual tasks/ideas/notes), and an
  append-only `changes` table.
- **Provenance** — every write carries a source (`ui`/`cli`/`agent`/`import`) + actor, taken from
  the `X-Launchpad-Source` / `X-Launchpad-Actor` headers. Visible via `launchpad log` / `/api/changes`.
- **Archive instead of delete** — tasks and notes archive via `archived_at`, ideas via
  `status='archived'`. Agents have no delete verb at all; the UI keeps both.
- **Item-level tags** — API (`POST`/`PUT`/`DELETE /api/{tasks,ideas,notes}/:id/tags`), CLI verbs,
  and tag chips with an inline adder on every task/idea/note in the UI.
- **Batch push** — `POST /api/projects/:id/push` (+ `?dryRun=true`). Merge-only, idempotent
  (matches items by normalized title), transactional, validates enums, refuses to recreate
  archived items, writes a full DB backup before every real apply, returns a change report.
  Dry-run is the same code path rolled back, so a preview can't drift from the apply.
- **Audit** — `/api/audit` + `/api/projects/:id/audit`: missing description/tags/tasks/notes,
  untagged items, stalled-but-active, uncommitted, missing path. Shown as "Gaps" in the UI.
- **Per-project agent handles** — `ai-instructions/.launchpad.json` binding (walked up from cwd),
  a Launchpad block injected into `ai-instructions/CLAUDE.md`, and a **Copy agent prompt** button
  in the project Overview. Resolution: `--project` → `$LAUNCHPAD_PROJECT` → binding → cwd → error.
- **Full CLI** — `guide`, `ping`, `whoami`, `bind`/`unbind`, `onboard`, `list`, `status`, `pull`,
  `audit`, `search`, `log`, `set`, `rename`, `scan`, `register`, `tag(s)`, `task|idea|note`
  (add/get/update/archive/unarchive/tag/untag/tags + done/reopen/move/promote/pin/unpin),
  `inbox`, `push`. `--json` on reads; `--by` for actor attribution.

## Done (v0.3 — identity, capture UX, folder handling, live sites)

- **Logo** — a delta lifting off a split pad, drawn once in a 32×32 box and mirrored in three
  places: `src/web/src/components/Logo.tsx` (sidebar), `src/web/public/favicon.svg`, and
  `scripts/make-icon.mjs` (which rasterises tray 32px, window/taskbar 256px, PWA 192/512 with
  4× supersampled anti-aliasing, pure Node + zlib, no image deps). **Change all three together.**
  Electron now sets `icon:` on the BrowserWindow and an explicit `AppUserModelId`, so Windows
  stops showing the default Electron logo in the window and taskbar.
- **Capture bar reads as global** — moved onto `surface-2` with a "Quick capture" chip and a
  permanent `Global · goes to <destination> as <kind>` meta row, so it no longer looks like it
  belongs to the open project. Both selectors are reachable at every width.
- **Capture autocomplete** — a suggestion dropdown for the `task:` / `idea:` / `note:` prefixes
  and for `#project` targets, filtered by the same predicate `parseCapture` uses, with
  arrow/Enter/Tab/Esc handling and a live preview of the parsed result. A `#tag` in the text now
  beats the pre-selected project (it used to be silently ignored whenever a project was open).
- **Native folder picker** — `POST /api/pick-folder` opens a WinForms `FolderBrowserDialog` via
  `powershell -STA -EncodedCommand`, owned by a hidden top-most form so it lands in front.
  Cancel/timeout/non-Windows all return `null`. Used by Settings (project roots) and the
  new-project modal, replacing hand-typed paths.
- **Scan reports itself** — `POST /api/scan` returns a `DiscoveryResult` with a per-root
  breakdown and a human `message`, so a scan that finds nothing says *why*.
- **Duplicate detection** — beyond nested paths, now also same-path-different-case, stale
  non-existent paths sharing a basename with a live one, and near-identical names.
- **Live deployments** — optional Vercel personal access token in Settings; projects match to a
  Vercel project by git remote (then by name), storing `liveUrl`. A globe button opens the live
  site next to Editor/Terminal/Folder/GitHub, and a `live` badge shows on the dashboard card.
  A hand-entered URL is respected and never overwritten by detection.
- **Moved / renamed folders** — `pathExists` on every project surfaces a "folder missing" badge
  and an in-project banner; `/relocate/candidates` finds the folder again (git remote > basename
  > name similarity); `/relocate` re-points it; `/rename-folder` renames on disk and updates the
  stored path in one operation. See WORKING_NOTES for the policy.

## Planned / not yet

- Global hotkey for capture (currently in-app capture bar only).
- Optional local-AI assist (summaries, next-step suggestions) — must stay optional.
- Mobile face (server already local; would bind to LAN + auth).
- Packaged installer (`electron-builder`) + bundled Node for zero-setup desktop.
