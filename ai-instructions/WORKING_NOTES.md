# Working Notes — Launchpad v2

Key decisions and their reasoning (plain markdown, not parsed).

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

## Open questions / watch-outs
- Electron GUI hasn't been launched in an automated environment (it's a desktop app); the
  load target (built UI on :7420) and the shell's syntax are verified. Worth a manual run.
- Scaffolder's GitHub step shells out to `gh` and is best-effort (non-fatal warning on failure).
- `launchpad pull` requires `npm link` (or `-g` install) once to be on PATH.
