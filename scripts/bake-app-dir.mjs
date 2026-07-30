// Record which working copy the installer being built should point at.
//
// The installed shell contains no server and no web build (see electron-builder.yml); it reads
// them from this repo at runtime. So the last thing before packaging is to write down where
// "this repo" is, and ship that file inside the app.
//
// The value is a default, not a lock-in: LAUNCHPAD_APP_DIR overrides it for one run, and the
// tray's "Change app folder…" writes a permanent override to %APPDATA%\launchpad-v2\shell.json.
import { existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'resources', 'app-dir.json')

// Refuse to bake a path the shell would then reject at startup — that failure would surface as a
// dialog on the user's machine instead of an error here, where it is one command to fix.
const built = join(ROOT, 'dist', 'server', 'index.js')
if (!existsSync(built)) {
  console.error(`No server build at ${built}\nRun \`npm run build\` before packaging.`)
  process.exit(1)
}

writeFileSync(OUT, JSON.stringify({ appDir: ROOT }, null, 2) + '\n')
console.log(`Baked app folder: ${ROOT}\n  → ${OUT}`)
