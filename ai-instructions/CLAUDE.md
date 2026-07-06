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
  CLI's cwd matching works. Avoid ports 3000/3001/5000.
- **AI is optional / not yet present.** Every feature works with no network and no AI.

## Architecture

```
src/
  shared/types.ts          shared domain types (server + web + cli)
  server/
    config.ts              port, data dir, path normalization
    db/                    node:sqlite connection + migrations
    repo/                  data access per entity (projects, notes, ideas, tasks, ...)
    services/              scanner (git/fs/readme), launcher, scaffolder, exporter
    routes/                thin Fastify handlers → repo/services
    app.ts / index.ts      server factory + entrypoint
  web/                     React + Vite + Tailwind UI
electron/                  thin desktop shell (main.cjs, preload.cjs)
cli/launchpad-pull.mjs     zero-dep agent CLI (`launchpad pull`)
```

Data flow: UI/CLI → REST API (`/api/*`) → repo/services → SQLite. The scanner reads git +
filesystem on demand and caches results on the project row.

## Where things live

- Adding a field to an entity → migration in `src/server/db/schema.ts` (append only) +
  the repo mapper + `src/shared/types.ts`.
- New API endpoint → a route file in `src/server/routes/` (keep handlers thin).
- New view/panel → `src/web/src/components/`, wired in `App.tsx`.

## Running

See `README.md`. Short version: `npm run dev` → http://localhost:7421 (dev), or
`npm run build && npm run desktop` for the desktop app.
