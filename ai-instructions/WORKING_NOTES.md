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

## Open questions / watch-outs
- Electron GUI hasn't been launched in an automated environment (it's a desktop app); the
  load target (built UI on :7420) and the shell's syntax are verified. Worth a manual run.
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
