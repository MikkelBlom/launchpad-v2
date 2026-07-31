# CLAUDE.md — Launchpad v2 (Project-Specific)

Launchpad is Mikkel's personal command center for all his projects. It is a **local-first
service** that discovers his projects, shows their real status automatically, launches
them, and stores his notes/ideas/tasks in its own database.

This is a **ground-up rebuild** of the original Launchpad (kept for reference at
`../launchpad`). The original failed because it treated rigidly-formatted markdown files as
a database (fragile parser, hand-maintenance, silent data loss) and had a confusing
GitHub/mobile sync pipeline. v2 fixes the root cause.

## What is this?

A single background service (Node + TypeScript + Fastify) that:
- Owns a SQLite database (via built-in `node:sqlite` — no native compile).
- Serves a React/Tailwind web UI and a REST API on **localhost:7420**.
- Is reachable as a **desktop window** (thin Electron shell, tray, starts at login) AND in
  any browser — same data, two faces.

## Core principles — do not violate

- **Launchpad owns the data.** Notes/ideas/tasks live in SQLite. Any file written into a
  project repo (`ai-instructions/LAUNCHPAD.md`) is a **one-way export**, never read back.
- **Status is derived, never hand-maintained.** Git (last commit, branch, dirty, ahead/behind)
  + filesystem + README drive a project's activity. No format discipline required of the user.
- **Light mode only.** Calm, warm light palette. No dark mode.
- **The server runs under system Node, not Electron.** Electron's bundled Node lacks
  `node:sqlite`. Electron only hosts a window pointed at localhost + spawns the server as a
  child under the system Node. Never move SQLite into the Electron process.
- **Windows-first.** Use `path` helpers; normalize project paths with `normalizePath` so the
  CLI's cwd matching works. 3000/3001/5000 are PMS's ports — claimed by that project, not
  reserved in code.
- **Two channels, one live database.** The dev window (`--dev`, Vite on :7421) and the stable
  app (`dist/` on :7420) both write `%APPDATA%\launchpad-v2\launchpad.sqlite`. That is
  deliberate, and it means **dev is not a sandbox**: before touching a migration or anything
  bulk/destructive, set `LAUNCHPAD_DATA_DIR` to a copy. The dev shell must never spawn its own
  server and never write the Windows login item. See WORKING_NOTES.md.
- **The shell is not the app.** Electron only hosts the window; the server and built UI are
  files it reads at startup. A code change is picked up by reload/rebuild, never by reinstalling
  — keep it that way. The installer (`npm run dist`) therefore packages **the shell only**, and
  the installed shell resolves the working copy through `electron/appRoot.cjs`. Never put the
  server bundle, `dist/web` or `node_modules` into the package.
- **Start-at-login belongs to the installed app.** Electron writes the Run value unquoted, so it
  only works from a path without spaces — which is why the install is per-user in
  `%LOCALAPPDATA%\Programs\Launchpad`. Do not switch to a per-machine install, and never write the
  Run key directly: Bitdefender quarantines an unsigned app that does. See WORKING_NOTES.md.
- **AI is optional.** Every feature works with no network and no LLM. The agent surface is a
  plain CLI over the same REST API the UI uses — no model runs inside Launchpad.
- **Agents archive, never delete.** The CLI has no delete verb. `DELETE` endpoints exist for the
  UI only. Every agent write is reversible and attributed.
- **Never guess which project.** Targeting resolves `--project` → `$LAUNCHPAD_PROJECT` →
  `ai-instructions/.launchpad.json` → cwd path, then hard-errors. Do not add a fallback.
- **A project id is not an identity — the folder is.** Ids move (a duplicate merge frees an id for
  reuse), so anything that persists an id outside the database must store the path too and resolve
  by path first. Never gate a feature on a stored id still matching. See WORKING_NOTES.md.
- **Batch push is merge-only and idempotent.** Match by normalized title, update in place, never
  remove. If you touch `services/agentPush.ts`, keep dry-run on the same code path (transaction
  + rollback) so the preview cannot drift from the apply.
- **A port claim is validated where it is written, not where it is displayed.** Every write to
  `project_ports` goes through `assertClaimable` in `services/ports.ts`: reserved ports are
  refused outright, another project's port needs `--force`. An advisory check that a caller may
  ignore is not a check — that is exactly how three projects ended up holding 3000.

## Architecture

```
src/
  shared/types.ts          shared domain types (server + web + cli)
  server/
    config.ts              port, data dir, path normalization
    db/                    node:sqlite connection + migrations
    repo/                  data access per entity (projects, notes, ideas, tasks, ...)
    services/              scanner (git/fs/readme), launcher, scaffolder, exporter,
                           agentPush (batch apply), audit, agentDocs, provenance
    routes/                thin Fastify handlers → repo/services
    app.ts / index.ts      server factory + entrypoint
  web/                     React + Vite + Tailwind UI
electron/                  thin desktop shell (main.cjs, preload.cjs)
cli/launchpad.mjs          zero-dep agent CLI — the whole agent surface (`launchpad guide`)
cli/launchpad-pull.mjs     shim for the original bin path; do not delete (see WORKING_NOTES)
```

Data flow: UI/CLI → REST API (`/api/*`) → repo/services → SQLite. The scanner reads git +
filesystem on demand and caches results on the project row.

## Where things live

- Adding a field to an entity → migration in `src/server/db/schema.ts` (append only) +
  the repo mapper + `src/shared/types.ts`.
- New API endpoint → a route file in `src/server/routes/` (keep handlers thin).
- New view/panel → `src/web/src/components/`, wired in `App.tsx`.

## Running

See `README.md`. Short version: `npm run dev:app` for the dev window (server + Vite + shell in
one command, HMR live), or `npm run build && npm run desktop` for the stable desktop app.
`npm run stop` clears orphaned server/Vite processes; `npm run shortcuts` (re)creates the two
Start Menu entries.

<!-- launchpad:begin -->
## Launchpad

This project is tracked in **Launchpad**, a local service on http://localhost:7420 that owns
Mikkel's notes, ideas, and tasks for every project. **It is Launchpad project #2 ("Launchpad").**
Launchpad's database is the source of truth — not the markdown in this repo.

```bash
launchpad pull --json      # read this project's tasks/ideas/notes (nothing written to disk)
launchpad guide            # the full command set, with the push-plan schema
```

Every `launchpad` command run inside this folder targets project #2 automatically.
Write back with `launchpad task add "…"`, `launchpad idea add "…"`, `launchpad note add "…"`,
`launchpad set description "…"`, `launchpad tag add <name>`, or a batch `launchpad push plan.json`.

**Dev server port.** This project has no port claimed yet. Before configuring a dev server, run `launchpad ports free` to get ports that are actually available, pick one, and claim it with `launchpad set port <n>` so it shows up in Launchpad and nothing else takes it. Never assume 3000, 3001 or 5000 are free — they are already taken on this machine.

`ai-instructions/LAUNCHPAD.md` is a **read-only mirror** — editing it changes nothing.
Agents archive rather than delete; nothing you do here is unrecoverable.
<!-- launchpad:end -->
