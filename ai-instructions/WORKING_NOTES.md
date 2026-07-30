# Working Notes — Launchpad v2

Key decisions and their reasoning (plain markdown, not parsed).

## ⚠ Dev and stable share ONE live database — be careful

There are two channels (see "Two channels" below) and **both read and write the same file**:

```
%APPDATA%\launchpad-v2\launchpad.sqlite
```

This is a deliberate choice (2026-07-28, Mikkel): developing against the real projects, real
notes and real tasks is the entire point — a dev sandbox full of fake data would tell you
nothing. The cost is that **there is no safety net between an experiment and the real data.**

Before doing any of the following, point dev at a copy instead:

- adding or changing a migration in `db/schema.ts`
- anything that deletes, merges, relocates, or bulk-rewrites rows
- testing import, restore, or duplicate-merge
- letting an agent loose on `push` with a plan you haven't dry-run

```bash
# One-off dev run against a throwaway copy of the real database:
mkdir "$env:TEMP\lp-scratch"
copy "$env:APPDATA\launchpad-v2\launchpad.sqlite" "$env:TEMP\lp-scratch\"
$env:LAUNCHPAD_DATA_DIR = "$env:TEMP\lp-scratch"   # then npm run dev in that same shell
```

Reminders that this is live, not a sandbox: the dev window's title bar reads **"Launchpad
(dev) — live shared database"**, and the dev tray menu says the same. If you ever see a plain
"Launchpad" title, you are in the stable app.

Two related guards already exist, and should stay:
- The **dev shell never touches the Windows login item** (`applyLoginItem` returns early when
  `DEV`). Otherwise a dev run would silently re-register autostart to point at itself, or
  turn off the stable app's.
- The **dev shell never spawns a server** — `npm run dev` owns it. Otherwise two servers race
  for port 7420 and for the same SQLite file.

## Why a rebuild, not a refactor
The original Launchpad stored project content as rigidly-formatted markdown in each repo's
`ai-instructions/`. A regex parser silently dropped anything off-format, and serializers
rewrote files from scratch (wiping hand edits). Plus a convoluted GitHub/mobile sync folder
pipeline. Both were structural, not cosmetic. v2 inverts the model: Launchpad owns the data;
files are one-way exports; status is derived from signals that need no upkeep.

## Why `node:sqlite` (not better-sqlite3 / libsql / an ORM)
The original machine failed to native-compile `better-sqlite3` (node-gyp / VS Build Tools).
Node 24 ships a built-in `node:sqlite` — zero dependencies, zero compilation. We wrote a
thin repo layer over it instead of an ORM to keep the dependency surface minimal. Node 24 is
therefore a hard requirement for the server.

## Why the server is a separate process from Electron
Electron 33 bundles Node 20, which does **not** have `node:sqlite`. Running the DB inside
Electron would reintroduce native-module/ABI pain. So Electron is a pure window + tray that
spawns the server as a child under the **system** Node 24. This also matches the "one brain,
many faces" design — the browser and the desktop window are equal clients of the same service.

## Path normalization
Discovery joins root + entry (mixed separators on Windows), so all stored project paths go
through `normalizePath` (path.resolve → canonical). The CLI sends `process.cwd()` to
`/api/projects/resolve`, also normalized, so cwd matching is reliable.

## Port choice
Default 7420 (configurable via `LAUNCHPAD_PORT`). 3000/3001/5000 are used by other things on
Mikkel's machine. Server binds 127.0.0.1 only (not exposed on the network) — revisit if/when
the mobile face is added.

## Why agent "push" is a JSON plan, not a parsed markdown file
The obvious reading of "agents should push to Launchpad" is: the agent edits
`ai-instructions/LAUNCHPAD.md` and the CLI parses it back. That is precisely how v1 died —
markdown as a database, a fragile parser, silent data loss. Push is instead an explicit
schema-validated JSON plan applied through the API. JSON fails loudly; markdown fails quietly.
`LAUNCHPAD.md` stays a strictly one-way mirror, and now says so in its own header.

## Why push is idempotent by title
Agents retry. Without title matching, a second run of the same plan doubles every task. Items
match on a normalized title (lowercased, whitespace-collapsed) within the project, or on an
explicit `id`. A title that matches an **archived** item is skipped with a warning rather than
recreated — the user archived it deliberately, and silently resurrecting it would be worse than
either creating or ignoring.

## Why dry-run shares the apply code path
`--dry-run` runs the real apply inside a transaction that ends in `ROLLBACK`. The alternative —
a separate "simulate" branch — drifts from the real one over time and then lies to the user.
Note this makes push the only writer that manages its own transaction; nothing else may call it
from inside another transaction (`node:sqlite` has no nesting).

## Why agents archive instead of deleting
Mikkel's explicit choice. Agents have no delete verb at all (the API keeps `DELETE` for the UI).
Combined with provenance on every row and the `changes` log, anything an agent does is both
visible and reversible. Batch pushes additionally snapshot the whole DB to
`<dataDir>/backups/pre-push-*.json` first.

## Why targeting never falls back to "best guess"
An agent writing to the wrong project is worse than an agent that stops and asks. Resolution is
`--project` → `$LAUNCHPAD_PROJECT` → `ai-instructions/.launchpad.json` (walked up from cwd) →
cwd path match → **hard error with instructions**. The binding file is what makes "just run
`launchpad pull`" correct inside a project, and it's why `onboard` exists.

## Why provenance travels in headers
Adding `source`/`actor` to every request body would touch every endpoint's schema. Headers
(`X-Launchpad-Source`, `X-Launchpad-Actor`) give every route provenance for free and keep the
body the domain payload. The CLI infers `agent` vs `cli` from whether stdout is a TTY (agents
run piped, humans run interactive) — overridable with `--source` / `--by`.

## Renaming projects: display name and folder are deliberately separate
Mikkel's worry: "in the beginning I might call it some name, then I come up with a name and
want to rename it — in Launchpad easy, but the folder, if things are pointing to that path..."

The policy, in order of preference:

1. **Rename in Launchpad, leave the folder alone.** `projects.name` and `projects.path` are
   independent columns and renaming in the UI has never touched disk. This is the default
   answer and it is free — the dashboard, search, tags and agent bindings all key off `name`,
   while everything that points at the folder keeps working. A folder called `new-project-3`
   showing as "Solely" in Launchpad is completely fine.
2. **If the folder must be renamed, do it from Launchpad** (`POST /projects/:id/rename-folder`),
   which renames on disk and updates `path` in the same operation so the two cannot drift.
   It refuses when the target exists, when the name has separators or invalid Windows
   characters, and reports the "file in use" case explicitly — on Windows an open editor or a
   running dev server will lock the directory.
3. **If it was already renamed outside Launchpad**, `project.pathExists` goes false, the UI
   says so, and `/projects/:id/relocate/candidates` searches the project roots for the folder —
   scoring a matching git remote highest, then basename, then name similarity — so re-pointing
   is one click rather than retyping a path.

What Launchpad deliberately does **not** do: follow moves automatically. Silently re-pointing a
project at a folder that merely looks similar is how you end up with notes attached to the wrong
repo. Detection proposes; the user confirms.

## Git remote
`https://github.com/MikkelBlom/launchpad-v2` (private). The remote is the **HTTPS** URL, not
`git@github.com:…`, because SSH auth isn't available from an agent shell — pushes go through
the `gh` credential helper (`gh auth setup-git`). Changing it to SSH will break agent pushes.

## Two channels, and why a code change never needs a reinstall
Decided 2026-07-28. The complaint this solves: "build, reinstall, test takes so long every time."

It doesn't have to, because **the Electron shell is not the app.** `main.cjs` is a window, a
tray icon and a process spawner; the app is the Fastify server plus the built web UI, which are
ordinary files the shell reads at startup. So the shell is the only thing that would ever need
packaging, and it changes about once a quarter.

```
Launchpad (dev)   → electron/main.cjs --dev   → UI from Vite :7421, server from `npm run dev`
Launchpad         → electron/main.cjs         → UI + API from dist/ on :7420
```

- **UI edit in dev** — Vite HMR paints it in the Electron window. No reload, no build.
- **Server edit in dev** — `tsx watch` restarts in ~1s; the next API call hits new code.
- **Shipping to the stable app** — `npm run build`, then tray → **Restart server**. Both
  shortcuts point straight at this working copy, so there is nothing to copy or install.
- **Only `electron/main.cjs` itself** needs the shell relaunched, and that is `npm run desktop`.

Design notes worth keeping:
- Dev mode is an explicit `--dev` / `LAUNCHPAD_DEV=1` flag. It used to be *inferred* from
  whether `dist/web/index.html` existed, which meant a stale build silently outranked the code
  being edited — the exact confusion that makes people rebuild out of superstition.
- Stable runs `dist/server/index.js` under plain node, not the TypeScript source under tsx.
  The bundle is a frozen copy, so editing source can't break the always-on app mid-keystroke.
- The server is spawned with **absolute, quoted** paths. `shell: true` does no quoting of its
  own and the repo path contains a space; absolute also means the process's command line names
  this repo, which is how `npm run stop` finds it later.
- Dev gets its own `AppUserModelID` so Windows gives it a separate taskbar button.

## Packaging: the installer ships the shell, not the app
Added 2026-07-30. `npm run dist` → `release/Launchpad-Setup-<version>.exe` (NSIS, per-user,
`%LOCALAPPDATA%\Programs\Launchpad`, no admin prompt). Config in `electron-builder.yml`.

The packaged app is `electron/**` + `resources/**` + `package.json`, asar'd — **37 KB**. No server
bundle, no `dist/web`, no `node_modules` (`!node_modules/**/*` in `files`, or electron-builder
would pull fastify/react/simple-git in for a shell that imports none of them). That is the
"two channels, no reinstall" rule surviving contact with packaging: the installed shell reads the
server and UI from the working copy, so `npm run build` + tray → **Restart server** still ships a
change, and the installer only needs rebuilding when `electron/main.cjs` changes.

The cost, stated plainly: **the installed app depends on this repo staying where it is.** That is
the trade the design already made, and the failure is handled rather than fatal — the shell
validates the folder, says which candidates it tried, and offers a picker (tray → *Change app
folder…*, persisted to `%APPDATA%\launchpad-v2\shell.json`). It also still needs **system Node 24+
on PATH**; Electron's bundled Node has no `node:sqlite`. Bundling a private Node is the remaining
step toward a genuinely zero-setup install.

Three details that are load-bearing:
- **`"main": "electron/main.cjs"` in package.json.** Unpackaged runs name the file on the command
  line; a packaged app has only this field, and without it Electron looks for `index.js`.
- **`app.setName()` per channel.** Nothing sets `productName` in package.json, so all three ways
  of starting the shell would share one app name → one userData path → one single-instance lock,
  and `npm run desktop` would silently focus the installed window instead of starting. Named
  apart: `launchpad-dev` (dev), `launchpad-src` (unpackaged stable), package default (installed).
- **`requestSingleInstanceLock()`.** Now that Windows starts the app at login, clicking the Start
  Menu entry has to raise the running window, not start a second tray icon whose server loses the
  race for :7420.

`npm run shortcuts` no longer creates a stable "Launchpad" shortcut — the installer owns that
name. Two shortcuts with one name pointing at two copies is a whole evening of confusion.

## Start-at-login: why it needed packaging, and do NOT fix it by writing the Run key
Diagnosed 2026-07-28, fixed by the installer 2026-07-30. Everything here follows from one fact:
**Electron writes the Run value unquoted.**

`app.setLoginItemSettings({path, args})` produced
`C:\…\Projects\Project Manager\…\electron.exe C:\…\electron\main.cjs` with no quotes. This repo
sits under **"Project Manager"**, so Windows split on that space: the executable was read as
`C:\Users\mikke\Desktop\Projects\Project` and the entry script arrived as two mangled arguments.
Autostart reported itself as enabled everywhere and did not work. A second entry
(`electron.app.Electron`) had also been orphaned when `setAppUserModelId()` was added, because
Electron keys the entry by AppUserModelID once one is set.

**The obvious fix is a trap.** Writing the Run key directly from the shell (via PowerShell or
`reg.exe`) means an unsigned Electron binary running out of a user folder performing textbook
persistence behaviour. **Bitdefender Advanced Threat Defense flagged it as `SuspiciousBehavior`,
killed every process involved and quarantined `electron.exe`** — it also deleted the Run entry it
had just seen written, which is a confusing symptom if you don't know the cause. That attempt is
reverted; `main.cjs` carries a comment saying why.

**The fix that shipped is packaging.** The installed exe lives at
`%LOCALAPPDATA%\Programs\Launchpad\Launchpad.exe` — a path with **no spaces** — so the unquoted
value is unambiguous and even a `--hidden` argument survives it. Verified 2026-07-30: the app
writes `dk.mikkelblom.launchpad = C:\Users\mikke\AppData\Local\Programs\Launchpad\Launchpad.exe
--hidden`, and executing that exact string starts the app and its server. That is *why*
`nsis.perMachine` is false — Program Files would put a space back in the path and break the
argument. Don't "improve" it to a per-machine install.

`loginItemOptions()` drops the argument if the exe path ever does contain a space: an unquoted
lone path is rescued by CreateProcess's prefix fallback, mangled arguments are not. So autostart
degrades to "opens a window" instead of breaking.

An **unpackaged** shell now refuses to touch the login item at all (`applyLoginItem` returns
early when `!app.isPackaged`). It still writes the setting to the database, and the installed app
reconciles from there on its next start. Writing a broken entry is worse than writing none: both
Windows and the tray would report autostart as on while nothing launched.

Related: anything in this repo that spawns PowerShell (`scripts/stop.mjs`,
`scripts/make-shortcuts.mjs`) is fine — those are developer commands run from a terminal. The
line that matters is the *shipped app* doing it at runtime, especially for persistence.

### ⚠ Watch-out: something reverted the Run value once, mid-verification
On 2026-07-30, minutes after the installed app wrote the correct entry, three separate readers
(`reg.exe`, the PowerShell provider, and `Microsoft.Win32.Registry` directly) all reported the
value had gone back to the **previous** one — a `release\win-unpacked\Launchpad.exe` path whose
folder had already been deleted, so no live process could have written it. The app repaired it on
the next window focus. In the same window, three `uv_spawn` calls failed with `EPERM`.

That signature — a *restored previous value* plus blocked process creation — points at
Bitdefender's Active Threat Control rolling back what it read as a persistence write, the same
mechanism that quarantined `electron.exe` in the earlier attempt. Not proven: BD's own logs are
protected and the Windows Application log carries nothing.

Practical consequences:
- **After a reboot, check that Launchpad actually came up.** If it didn't, read the Run value
  first; a reverted or missing entry means BD, not a bug in the shell.
- If it recurs, add `%LOCALAPPDATA%\Programs\Launchpad` to Bitdefender's exceptions.
- Self-healing is currently tied to window show/focus (`reconcileStartAtLogin`). Deliberately
  **not** a timer: an app rewriting its own Run key on a schedule is precisely the behaviour ATC
  is looking for, and a write/revert loop would make things worse rather than better.

## Why `npm run stop` matches command lines, not ports
`tsx watch` on Windows regularly leaves an orphaned server whose listener is already gone, so a
port-based kill reports success and the next `npm run dev` still dies on EADDRINUSE.
`scripts/stop.mjs` enumerates node/electron processes via CIM and requires **two** signals: the
command line points into this repo, *and* it looks like something we start
(`server/index.(ts|js)`, `tsx`, `vite`, `concurrently`). The second condition is what stops it
killing the `npm run stop` shell itself, or a neighbouring project's dev server. Use
`npm run stop -- --dry-run` to see the matches first. Note it must run under Windows PowerShell
5.1, where `ConvertTo-Json` has no `-AsArray` — a single match comes back as a bare object.

## Open questions / watch-outs
- The installer is built, installed and verified (window, tray, server spawn, Run key,
  `--hidden` launch). **Untested by definition: an actual Windows login.** Reboot once and
  confirm the tray icon appears — and see the Bitdefender watch-out above if it doesn't.
- The installer is **unsigned**: SmartScreen warns on first run, and Bitdefender takes an
  interest. A code-signing certificate is the only real fix; there is no workaround worth
  shipping.
- Still requires **system Node 24+ on PATH** (`node:sqlite`). Bundling a private Node would make
  the install genuinely self-contained, and would also remove the `npm link` step for the CLI.
- Scaffolder's GitHub step shells out to `gh` and is best-effort (non-fatal warning on failure).
- `launchpad pull` requires `npm link` (or `-g` install) once to be on PATH.
- `cli/launchpad-pull.mjs` is a shim re-exporting `cli/launchpad.mjs`. It exists only so an
  existing `npm link` (whose shim points at the old bin path) keeps working — don't delete it
  without re-running `npm link`.
- `item_tags` is polymorphic, so SQLite can't foreign-key it to the item. The repos call
  `clearItemTags` on delete; any new item kind must do the same or tags will leak onto a later
  row with the same id.
- Backup/restore covers `item_tags` and `changes` (backup `version: 3`). Restoring a v2 backup
  is safe — missing tables just restore empty.
