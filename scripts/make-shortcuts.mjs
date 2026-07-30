// Create the Start Menu shortcut for the Launchpad **dev** channel.
//
// It points straight at this working copy — that is the whole trick behind the dev loop. The
// Electron shell is a window, a tray icon and a process spawner; the app it shows is the server
// and the built UI, which are plain files it reads at startup. So a code change never needs a
// reinstall: rebuild (or don't, in dev) and reload.
//
//   Launchpad (dev)   → attaches to `npm run dev` on :7421, HMR and all. Never registers
//                       itself for start-at-login, and never touches the stable app's.
//
// The stable channel is **not** here any more: `npm run dist` builds an installer, and the
// installed app owns the plain "Launchpad" Start Menu entry. Two shortcuts of the same name
// pointing at two different copies is the kind of ambiguity that wastes an evening — whichever
// was written last would win silently. `npm run desktop` still runs the stable shell from source
// when the shell itself is what you are editing.
//
// Run with --desktop to drop a copy on the Desktop as well.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const ENTRY = join(ROOT, 'electron', 'main.cjs')
const ICON = join(ROOT, 'resources', 'icon.ico')

if (!existsSync(ELECTRON)) {
  console.error(`Electron not found at ${ELECTRON}\nRun \`npm install\` first.`)
  process.exit(1)
}
if (!existsSync(ICON)) {
  console.error(`Icon not found at ${ICON}\nRun \`npm run icons\` first.`)
  process.exit(1)
}

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`

function ps(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8'
  }).trim()
}

const startMenu = ps("[Environment]::GetFolderPath('Programs')")
const desktop = ps("[Environment]::GetFolderPath('Desktop')")

const SHORTCUTS = [
  {
    name: 'Launchpad (dev).lnk',
    args: `"${ENTRY}" --dev`,
    description: 'Launchpad dev window — attaches to npm run dev (live shared database)'
  }
]

const folders = [startMenu]
if (process.argv.includes('--desktop')) folders.push(desktop)

for (const folder of folders) {
  for (const s of SHORTCUTS) {
    const path = join(folder, s.name)
    ps(
      [
        `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${psQuote(path)})`,
        `$s.TargetPath = ${psQuote(ELECTRON)}`,
        `$s.Arguments = ${psQuote(s.args)}`,
        `$s.WorkingDirectory = ${psQuote(ROOT)}`,
        `$s.IconLocation = ${psQuote(ICON)}`,
        `$s.Description = ${psQuote(s.description)}`,
        '$s.Save()'
      ].join('; ')
    )
    console.log(`Wrote ${path}`)
  }
}

console.log(
  '\nThis shortcut runs the working copy directly — delete the .lnk file to undo.' +
    '\nThe stable app is the installed one ("Launchpad"); rebuild it with `npm run dist`.'
)
