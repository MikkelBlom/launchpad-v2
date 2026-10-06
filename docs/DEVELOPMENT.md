# Launchpad - development and setup

The full technical guide: running it, the desktop app, the installer, the agent CLI, and where data lives. For what Launchpad is, see the [README](../README.md).

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

The port is configurable via the `LAUNCHPAD_PORT` env var (default **7420**, above the usual
dev-server ports so it doesn't collide with the projects it tracks).

## Install the desktop app

```bash
npm run dist
```

That builds `release/Launchpad-Setup-0.1.0.exe`. Run it; it installs per-user into
`%LOCALAPPDATA%\Programs\Launchpad` (no admin prompt) and creates Start Menu + Desktop
shortcuts. **Start-at-login only works from the installed app** — see below.

The installer packages **the shell only**: no server bundle, no web build, no `node_modules`
(the whole app is a ~37 KB asar next to the Electron runtime). The installed shell reads the
server and the UI from this working copy at startup, so the no-reinstall dev loop survives
packaging — `npm run build` + tray → **Restart server** still ships a change, and the installer
only needs rebuilding when `electron/main.cjs` itself changes.

Which working copy it reads is baked at package time (`resources/app-dir.json`) and resolved in
this order, each candidate validated so a stale one falls through instead of breaking the app:

```
LAUNCHPAD_APP_DIR  →  %APPDATA%\launchpad-v2\shell.json  →  resources/app-dir.json
```

If you move this repo, the installed app says so on startup and offers a folder picker; the
tray's **Change app folder…** does the same at any time. It still needs **system Node 24+** on
PATH — Electron's own Node has no `node:sqlite`.

> The installer is unsigned, so SmartScreen shows "Windows protected your PC" on first run
> (**More info → Run anyway**), and Bitdefender may take an interest in a fresh unsigned
> Electron binary. See `ai-instructions/WORKING_NOTES.md`.

### Start at login

Windows starts the installed app via an `HKCU\…\Run` entry that Electron writes, keyed
`dk.mikkelblom.launchpad`, with a `--hidden` argument so a machine start lands in the **tray**
rather than throwing a window at you. Toggle it in **Settings** or the tray; the database is the
source of truth and the shell makes Windows match it.

The setting is deliberately inert outside the installed app: Electron writes that registry value
*unquoted*, and an unpackaged run is `…\Project Manager\…\electron.exe` plus a script argument,
which Windows cannot parse. An unpackaged shell therefore updates the database and leaves the
registry alone rather than writing an entry that reports success and launches nothing. The
per-user install path has no spaces in it, which is what makes the packaged case work.

## The desktop app, while you're still building it

**A code change never requires reinstalling anything.** The Electron shell is a window, a tray
icon and a process spawner — the *app* is the Fastify server and the built web UI, which are
plain files the shell reads at startup. So there are two channels off one working copy:

```bash
npm run shortcuts     # once — Start Menu entry for the dev window
```

| | **Launchpad** | **Launchpad (dev)** |
|---|---|---|
| Start it with | Start Menu (installed), or `npm run desktop` | `npm run dev:app` |
| UI comes from | `dist/web`, served on :7420 | Vite on :7421, with HMR |
| Server | `dist/server/index.js`, spawned by the shell | `tsx watch`, owned by `npm run dev` |
| Starts at login | yes, when installed | never — it won't touch the login item |
| Title bar says | Launchpad | Launchpad (dev) — live shared database |

Only the dev shortcut is script-created. The plain **Launchpad** Start Menu entry belongs to the
installer, so the two can't shadow each other — one name, one copy.

The loop in dev: **edit UI → it repaints itself** (HMR, no reload, no build); **edit server →
`tsx watch` restarts in about a second** and the next API call hits the new code. No build step
in either case.

To move a change into the always-on app: `npm run build`, then **tray → Restart server**. Both
shortcuts run this working copy directly, so there is nothing to copy and nothing to install.
The only change that needs the shell relaunched is an edit to `electron/main.cjs` itself.

In the window: **F5** or **Ctrl+R** reloads, **F12** opens devtools. In the tray: **Reload UI**
and **Restart server**.

```bash
npm run stop                  # kill orphaned server / tsx watch / Vite processes
npm run stop -- --dry-run     # ...or just see which ones would be killed
```

> ⚠ **The dev window and the stable app share one live database**
> (`%APPDATA%\launchpad-v2\launchpad.sqlite`) — on purpose, so you develop against real
> projects. Dev is **not** a sandbox. Before changing a migration or doing anything bulk or
> destructive, point dev at a copy with `LAUNCHPAD_DATA_DIR`. See
> `ai-instructions/WORKING_NOTES.md`.

## First-time setup

1. Open Launchpad → **Settings** → **Browse…** and pick a **project root**
   (e.g. `C:\Users\you\Projects`). A native folder chooser opens on the machine running the
   service, so there is no path to type — typing one still works if you prefer.
2. Click **Scan now**. Launchpad discovers every project under that root and reads its git
   status, then reports what it found per root — including roots that don't exist and projects
   that were already registered, so a scan that adds nothing tells you why.
3. Back on **Projects**, click any card to launch it, add tasks/ideas/notes, or edit it.

If import or repeated scans left the same project registered twice, **Settings → Duplicates**
finds them — nested paths, stale paths that no longer exist, and near-identical names — and
merges them into the registration whose folder actually exists.

## Renaming projects

The **display name and the folder on disk are independent.** Renaming a project in Launchpad
never touches the filesystem, so rename freely — nothing that points at the folder breaks.

If you do want the folder itself renamed, do it from the project's page: Launchpad renames the
directory and updates its stored path in one operation so the two can't drift. And if you rename
or move a folder outside Launchpad, the project shows **folder missing** and offers to find it
again by searching your project roots (matching on git remote first, then folder name).

## Live sites (Vercel)

Add a Vercel personal access token in **Settings** and Launchpad can match each project to its
Vercel deployment — by git remote first, then by name — and show a button that opens the live
site next to Editor / Terminal / Folder / GitHub. You can also paste a URL by hand for anything
not hosted on Vercel; a manual URL is never overwritten by detection. With no token configured,
everything else works exactly as before.

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
| `npm run dev:app` | The above **plus** the dev desktop window — the everyday dev command |
| `npm run build` | Build web (`dist/web`) and bundle server (`dist/server`) |
| `npm start` | Run the built service on :7420 |
| `npm run desktop` | Launch the stable Electron desktop shell |
| `npm run desktop:dev` | Launch the dev window against an already-running `npm run dev` |
| `npm run dist` | Build the installer → `release/Launchpad-Setup-<version>.exe` |
| `npm run pack` | Same, but unpacked into `release/win-unpacked` — faster, for testing the shell |
| `npm run stop` | Kill orphaned server / `tsx watch` / Vite processes (`-- --dry-run` to preview) |
| `npm run shortcuts` | Create the dev Start Menu shortcut (`--desktop` for a Desktop copy too) |
| `npm run icons` | Regenerate tray/window/PWA icons and `resources/icon.ico` |
| `npm run typecheck` | Type-check the whole codebase |
