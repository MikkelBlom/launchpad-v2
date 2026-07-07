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

## Planned / not yet

- Global hotkey for capture (currently in-app capture bar only).
- Optional local-AI assist (summaries, next-step suggestions) — must stay optional.
- Mobile face (server already local; would bind to LAN + auth).
- Packaged installer (`electron-builder`) + bundled Node for zero-setup desktop.
