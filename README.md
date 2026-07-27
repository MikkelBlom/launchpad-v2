# Launchpad

A local-first command center for all your projects. One background service owns your
data (SQLite) and wears many faces: a **desktop window** that starts with Windows, and a
**localhost URL** you can open in any browser.

Launchpad finds your projects, shows their **real status automatically** (from git +
filesystem, zero upkeep), launches them in a click, and holds your notes / ideas / tasks
in its own database — no fragile markdown files to maintain.

## Architecture — one brain, many faces

```
Your project folders ──reads git/files/README──► Launchpad service (Node + SQLite)
                                                   ├── REST API + web UI  (localhost:7420)
                                                   ├── git + filesystem scanner
                                                   └── launcher + scaffolder
                                                          │
                          Desktop window (Electron, tray, starts at login) ─┘
                          Any browser  ─────────────────────────────────────┘
```

The server runs under **system Node 24** (it uses the built-in `node:sqlite`, so there is
nothing to compile). Electron is a thin window that points at localhost — it never loads
SQLite itself, which avoids native-module pain.

## Requirements

- Node 24+ (for the built-in `node:sqlite`)
- Windows (git, and optionally the `gh` CLI for GitHub repo creation)

## Run it

```bash
npm install

# Development (hot reload): server on :7420, web on :7421
npm run dev
#   → open http://localhost:7421

# Production build + run the service (serves the UI on :7420)
npm run build
npm start
#   → open http://localhost:7420

# Desktop app (window + tray + start-at-login). Build first so the UI is served on :7420.
npm run build
npm run desktop
```

The port is configurable via the `LAUNCHPAD_PORT` env var (default **7420** — 3000/3001/5000
are intentionally avoided).

## First-time setup

1. Open Launchpad → **Settings** → add a **project root** (e.g. `C:\Users\you\Projects`).
2. Click **Scan now**. Launchpad discovers every project under that root (2 levels deep)
   and reads its git status.
3. Back on **Projects**, click any card to launch it, add tasks/ideas/notes, or edit it.

## The agent CLI — `launchpad`

AI agents read *and write* Launchpad through a CLI. It is the whole agent surface: no MCP
server, no API keys, works in anything with a terminal.

```bash
# Install the command once (from this folder):
npm link          # or: npm install -g .

launchpad guide   # the complete agent manual — commands, rules, push-plan schema
```

### Pointing an agent at one specific project

An agent should never have to pick the right project out of a list. Two mechanisms make
the target explicit:

```bash
launchpad onboard          # run once per project, from inside it
```

That writes `ai-instructions/.launchpad.json` (the binding), inserts a **Launchpad block**
into `ai-instructions/CLAUDE.md` telling any agent which project this is and how to write
to it, and pulls a fresh snapshot. Afterwards every `launchpad` command run anywhere in
that folder tree targets that project automatically.

For a fresh chat session, the project's **Overview** tab has a **Copy agent prompt** button
that yields a paste-ready block naming the project by id.

Targeting resolves most-explicit-first and **never guesses**:

```
--project <id|name>  →  $LAUNCHPAD_PROJECT  →  ai-instructions/.launchpad.json  →  cwd path
```

### What agents can do

Read: `pull`, `status`, `audit`, `search`, `log`, `tasks`/`ideas`/`notes`.
Write: project description/status/tags, plus full CRUD on tasks, ideas and notes —
including tags, task bodies, due dates, priorities, promote, pin, and reorder.

Bulk setup goes through a single batch call:

```bash
launchpad push plan.json --dry-run   # preview
launchpad push plan.json             # apply
```

Push is **merge-only and idempotent**: it matches items by title, updates instead of
duplicating, never deletes, and writes a full database backup before every real apply.
Agents **archive rather than delete** — nothing they do is unrecoverable. Every write is
stamped with its source (`ui` / `cli` / `agent` / `import`) and is visible in
`launchpad log` and the change table.

Override the service URL with the `LAUNCHPAD_URL` env var.

## Data location

Your SQLite database lives in `%APPDATA%\launchpad-v2\launchpad.sqlite` (override with
`LAUNCHPAD_DATA_DIR`). It is the single source of truth — the markdown snapshot in each
repo is a one-way export.

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Server + Vite web dev server (hot reload) |
| `npm run build` | Build web (`dist/web`) and bundle server (`dist/server`) |
| `npm start` | Run the built service on :7420 |
| `npm run desktop` | Launch the Electron desktop shell |
| `npm run typecheck` | Type-check the whole codebase |
