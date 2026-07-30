// Thin Electron shell. It does NOT run the server or touch SQLite itself — Electron's
// bundled Node lacks node:sqlite. Instead it spawns the Launchpad server under the
// system Node (24+) as a child process, then hosts a window pointing at localhost.
const { app, BrowserWindow, Tray, Menu, dialog, shell, nativeImage } = require('electron')
const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')
const { SHELL_ROOT, isAppDir, resolveAppRoot, saveAppDir, shellConfigPath } = require('./appRoot.cjs')

const PORT = process.env.LAUNCHPAD_PORT || '7420'
const DEV_PORT = '7421'

// Two different roots, and conflating them is the packaging bug waiting to happen:
//   SHELL_ROOT — where this shell's own files are (icons). Inside app.asar once packaged.
//   APP_ROOT   — where the server bundle and built UI are, i.e. the working copy. Resolved,
//                not derived, because the installer ships the shell only. See appRoot.cjs.
// Assigned at startup; re-assignable at runtime when the user re-points the app folder.
let APP_ROOT = null

// Dev mode is stated, never inferred. (It used to be inferred from whether dist/web existed,
// which meant a stale build on disk silently won over the code you were editing.)
//
// In dev the shell owns nothing but the window: `npm run dev` runs the server under tsx watch
// and the UI on Vite, so edits land without a build — UI through HMR, server through a restart
// that takes about a second. The shell only points at them.
const DEV = process.argv.includes('--dev') || process.env.LAUNCHPAD_DEV === '1'

// Set by the Windows login item so a machine start lands in the tray instead of throwing a
// window at you before you have looked at the desktop. Manual launches always show the window.
const START_HIDDEN = process.argv.includes('--hidden')

let tray = null
let win = null
let serverChild = null
let quitting = false
// Mirror of AppSettings.startAtLogin. Seeded from Windows so the tray shows something
// truthful before the service answers, then kept in step with the database.
let startAtLogin = false
let reconciling = false

function uiUrl() {
  // Dev: Vite serves the UI and proxies /api to the service. Stable: Fastify serves dist/web.
  return DEV ? `http://localhost:${DEV_PORT}` : `http://localhost:${PORT}`
}

async function isServerUp() {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/health`)
    return res.ok
  } catch {
    return false
  }
}

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isServerUp()) return true
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

async function waitForServerDown(timeoutMs = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (!(await isServerUp())) return true
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

// ---------------------------------------------------------------- the app folder
//
// An installed shell has to be pointed at the working copy that holds the server and the built
// UI. That path is baked at package time, but a repo can move, so the failure is recoverable
// from the GUI instead of by reinstalling — hence a dialog rather than a crash.

function describeAppRootFailure(candidates) {
  const tried = candidates.length
    ? candidates.map((c) => `  • ${c.dir}   (${c.source})`).join('\n')
    : '  • nothing configured'
  return (
    'Launchpad could not find its app folder — the launchpad-v2 working copy that holds the ' +
    'server and the built UI.\n\nTried:\n' +
    tried +
    '\n\nPick the folder (the one containing package.json and dist/), or quit.\n' +
    `The choice is remembered in ${shellConfigPath()}.`
  )
}

// Ask until the user picks a valid folder or cancels. Sets APP_ROOT and remembers the choice;
// returns false if they backed out.
async function pickAppFolder() {
  const picked = await dialog.showOpenDialog({
    title: 'Select the launchpad-v2 folder',
    properties: ['openDirectory'],
    defaultPath: APP_ROOT || undefined
  })
  if (picked.canceled || !picked.filePaths[0]) return false
  const dir = picked.filePaths[0]

  if (!isAppDir(dir)) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Launchpad — not an app folder',
      message: 'That folder has no Launchpad server in it.',
      detail:
        `${dir}\n\nExpected dist\\server\\index.js (a built copy) or src\\server\\index.ts ` +
        '(a source checkout). If this is the right folder, run `npm run build` in it first.'
    })
    return pickAppFolder()
  }

  APP_ROOT = dir
  saveAppDir(dir)
  return true
}

// Startup path: explain what is missing before asking, because "pick a folder" out of nowhere
// tells the user nothing about what went wrong.
async function resolveAppFolderInteractively(candidates) {
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'Launchpad — app folder missing',
      message: 'Where is Launchpad installed?',
      detail: describeAppRootFailure(candidates),
      buttons: ['Choose folder…', 'Quit'],
      defaultId: 0,
      cancelId: 1
    })
    if (response !== 0) return false
    if (await pickAppFolder()) return true
  }
}

// Re-point an already-running shell: swap the folder, then swap the server under it.
async function changeAppFolder() {
  const previous = APP_ROOT
  if (!(await pickAppFolder()) || APP_ROOT === previous) return
  refreshTray() // the menu states the folder, so it has to be rebuilt
  stopServer()
  await waitForServerDown()
  await ensureServer()
  reloadUi()
}

// What the shell runs as "the server" depends on the channel:
//
//   stable  → dist/server/index.js under plain node. The built bundle is a frozen copy, so
//             editing source cannot break the always-on app halfway through a keystroke.
//   dev     → nothing. `npm run dev` already owns the server (tsx watch) and Vite.
//
// Either way this runs under system Node, not Electron's — Electron 33 bundles Node 20, which
// has no node:sqlite.
// Absolute, quoted paths on purpose. shell:true does no quoting of its own, and the repo
// path contains a space; absolute also means the spawned process's command line names this
// repo, which is how `npm run stop` finds an orphaned server later.
function serverCommand() {
  const q = (p) => `"${p}"`
  const built = join(APP_ROOT, 'dist', 'server', 'index.js')
  if (existsSync(built)) return ['node', [q(built)]]
  // No build yet — fall back to source so a fresh clone still starts.
  console.warn('[launchpad] dist/server not found; running from source. Run `npm run build`.')
  return ['node', ['--import', 'tsx', q(join(APP_ROOT, 'src', 'server', 'index.ts'))]]
}

async function ensureServer() {
  if (await isServerUp()) return // already running (e.g. autostarted separately, or npm run dev)
  if (DEV) {
    // Don't spawn a competitor for port 7420 — wait for the one `npm run dev` starts.
    console.warn('[launchpad] dev mode: waiting for the server from `npm run dev` on :' + PORT)
    await waitForServer()
    return
  }
  // shell:true resolves node from PATH.
  const [cmd, args] = serverCommand()
  serverChild = spawn(cmd, args, {
    cwd: APP_ROOT,
    shell: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    stdio: 'ignore',
    windowsHide: true
  })
  serverChild.on('exit', () => {
    serverChild = null
  })
  await waitForServer()
}

// Kill the server process tree. Windows needs /T to reach the shell:true wrapper's child.
function stopServer() {
  if (!serverChild || !serverChild.pid) return
  try {
    spawn('taskkill', ['/pid', String(serverChild.pid), '/T', '/F'], { shell: true })
  } catch {
    /* already gone */
  }
  serverChild = null
}

// Pick up a rebuilt server without quitting the app. In dev this is a no-op beyond the reload,
// because tsx watch has already restarted the server itself by the time you click.
async function restartServer() {
  if (!DEV) {
    stopServer()
    await waitForServerDown()
    await ensureServer()
  }
  reloadUi()
}

// ---------------------------------------------------------------- start at login
//
// The Launchpad database is the source of truth for this setting, not Windows and not this
// process. The same toggle lives in the web UI, which is often a plain browser tab with no
// Electron API, so the shell's job is to read the setting and make Windows match it.
//
// (This used to force `openAtLogin: true` on every launch, which silently undid the user
// turning it off in the tray. Never write the login item without a value to write.)

async function fetchStartAtLogin() {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/settings`, {
      signal: AbortSignal.timeout(3000)
    })
    if (!res.ok) return null
    const settings = await res.json()
    return typeof settings.startAtLogin === 'boolean' ? settings.startAtLogin : null
  } catch {
    return null // service unreachable — leave the current login item exactly as it is
  }
}

// A Windows login item is an executable plus arguments, and **Electron writes that registry
// value unquoted**. Everything here follows from that one fact:
//
//   packaged   → the executable is Launchpad.exe in %LOCALAPPDATA%\Programs\Launchpad, a path
//                with no spaces, so the value survives verbatim and `--hidden` rides along
//                safely. The `includes(' ')` guard drops the argument rather than the feature
//                if the app is ever installed somewhere with a space in the path: an unquoted
//                lone path is rescued by CreateProcess's prefix fallback, mangled arguments
//                are not.
//   unpackaged → the executable is electron.exe *inside this repo*, under "…\Project
//                Manager\…", and the entry script has to ride along as an argument. Both halves
//                are unquotable, so it cannot work. `applyLoginItem` refuses to try (see below).
//
// Do NOT "fix" the unpackaged case by writing the Run key directly: an unsigned Electron binary
// in a user folder writing its own persistence entry is textbook malware behaviour, and
// Bitdefender's Advanced Threat Defense quarantined electron.exe for it — confirmed the hard
// way on 2026-07-28. Packaging is the fix, and it is the fix that shipped.
function loginItemOptions() {
  if (!app.isPackaged) return { path: process.execPath, args: [join(__dirname, 'main.cjs')] }
  return process.execPath.includes(' ') ? {} : { args: ['--hidden'] }
}

function readLoginItem() {
  try {
    return app.getLoginItemSettings(loginItemOptions()).openAtLogin
  } catch {
    return false
  }
}

function applyLoginItem(openAtLogin) {
  // The dev shell never registers itself to start with Windows, and never unregisters the
  // stable app either. Autostart belongs to the installed copy; a dev run is a temporary
  // window over the same database and must leave that alone.
  if (DEV) return
  // Neither does an unpackaged run. It cannot produce a working login item (see
  // loginItemOptions), and writing a broken one is worse than writing none: Windows and this
  // menu would both report autostart as enabled while nothing launches. The setting still goes
  // to the database, and the installed app reconciles it on its next start.
  if (!app.isPackaged) {
    console.warn('[launchpad] not packaged: leaving the Windows login item alone (DB still updated)')
    return
  }
  try {
    if (readLoginItem() !== openAtLogin) {
      app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin })
    }
  } catch {
    /* unsupported platform / locked-down policy — the setting still lives in the DB */
  }
}

// Pull the setting and make Windows agree. Safe to call often (window shown/focused), so a
// toggle flipped in a browser tab takes effect without restarting the app.
async function reconcileStartAtLogin() {
  if (DEV || reconciling) return
  reconciling = true
  try {
    const wanted = await fetchStartAtLogin()
    if (wanted === null) return
    if (wanted !== startAtLogin) {
      startAtLogin = wanted
      refreshTray()
    }
    applyLoginItem(wanted)
  } finally {
    reconciling = false
  }
}

// The tray checkbox writes the database too, so the two views of this setting cannot drift.
async function setStartAtLogin(next) {
  startAtLogin = next
  applyLoginItem(next)
  refreshTray()
  try {
    await fetch(`http://localhost:${PORT}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startAtLogin: next }),
      signal: AbortSignal.timeout(3000)
    })
  } catch {
    // The service is down, so the database keeps its old value and the next reconcile
    // will win. Windows is already correct for this session either way.
  }
}

// Shell assets, so these follow the shell into app.asar rather than living in the working copy.
const APP_ICON = join(SHELL_ROOT, 'resources', 'icon.png')
const TRAY_ICON = join(SHELL_ROOT, 'resources', 'tray.png')

// Dev and stable share one database (%APPDATA%\launchpad-v2\launchpad.sqlite), by choice —
// developing against real projects is the whole point. The cost is that a half-finished
// migration or a destructive experiment in dev hits the real data, so the dev window says so
// in its title bar. If you are about to touch the schema, run with LAUNCHPAD_DATA_DIR pointed
// at a copy instead. See ai-instructions/WORKING_NOTES.md.
const WINDOW_TITLE = DEV ? 'Launchpad (dev) — live shared database' : 'Launchpad'

// Reload the page. After a failed load there is no document to reload, so go by URL.
function reloadUi() {
  if (!win) return
  if (win.webContents.getURL()) win.webContents.reloadIgnoringCache()
  else win.loadURL(uiUrl())
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: WINDOW_TITLE,
    // Without this the window and taskbar show Electron's default logo.
    icon: APP_ICON,
    backgroundColor: '#faf9f7',
    webPreferences: { preload: join(__dirname, 'preload.cjs') }
  })
  win.setMenuBarVisibility(false)
  win.loadURL(uiUrl())

  // The page sets its own <title>, which would overwrite the dev marker.
  win.on('page-title-updated', (e) => {
    e.preventDefault()
    win.setTitle(WINDOW_TITLE)
  })

  // The menu bar is hidden, so the default reload/devtools accelerators can't be relied on.
  // Bind them here: refreshing after a server change should never mean restarting the app.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const key = (input.key || '').toLowerCase()
    if (key === 'f5' || (input.control && !input.shift && key === 'r')) {
      event.preventDefault()
      reloadUi()
    } else if (key === 'f12' || (input.control && input.shift && key === 'i')) {
      event.preventDefault()
      win.webContents.toggleDevTools()
    }
  })

  // If the UI/server isn't ready yet, retry the load shortly.
  win.webContents.on('did-fail-load', () => {
    setTimeout(() => win && win.loadURL(uiUrl()), 800)
  })

  // Closing the window hides to tray; the server keeps running so localhost stays live.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win.hide()
    }
  })

  // Coming back to the window is the moment to re-check: the setting may have been changed
  // in the Settings page (here or in a browser tab) since the shell last looked.
  win.on('show', () => void reconcileStartAtLogin())
  win.on('focus', () => void reconcileStartAtLogin())
}

function showWindow() {
  if (!win) createWindow()
  else {
    win.show()
    win.focus()
  }
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    // A permanent reminder of which copy this is, and that it is not a sandbox.
    ...(DEV
      ? [
          { label: 'Development mode — live shared database', enabled: false },
          { type: 'separator' }
        ]
      : []),
    { label: 'Open Launchpad', click: showWindow },
    { label: 'Open in browser', click: () => shell.openExternal(uiUrl()) },
    { type: 'separator' },
    // Picking up a code change without reinstalling anything: reload for UI, restart for server.
    { label: 'Reload UI', accelerator: 'F5', click: reloadUi },
    DEV
      ? { label: 'Server: owned by `npm run dev`', enabled: false }
      : { label: 'Restart server', click: () => void restartServer() },
    // The installed shell reads the app from a working copy elsewhere on disk, so which copy
    // is worth stating — and worth being able to change without reinstalling.
    ...(app.isPackaged
      ? [
          { label: `App folder: ${APP_ROOT}`, enabled: false },
          { label: 'Change app folder…', click: () => void changeAppFolder() }
        ]
      : []),
    { type: 'separator' },
    // Autostart is the installed app's business only — see applyLoginItem().
    ...(DEV
      ? []
      : [
          {
            // Unpackaged the checkbox still writes the database — it just cannot register
            // Windows itself, and says so rather than pretending.
            label: app.isPackaged ? 'Start at login' : 'Start at login (installed app only)',
            type: 'checkbox',
            checked: startAtLogin,
            click: (item) => void setStartAtLogin(item.checked)
          },
          { type: 'separator' }
        ]),
    {
      label: DEV ? 'Quit (dev window)' : 'Quit Launchpad',
      click: () => {
        quitting = true
        app.quit()
      }
    }
  ])
}

// The checkbox reflects module state, so rebuild the menu whenever that state changes.
function refreshTray() {
  if (tray) tray.setContextMenu(buildTrayMenu())
}

function createTray() {
  const icon = nativeImage.createFromPath(TRAY_ICON)
  tray = new Tray(icon)
  tray.setToolTip(WINDOW_TITLE)
  tray.setContextMenu(buildTrayMenu())
  tray.on('click', showWindow)
}

// One shell per channel. This matters most now that Windows starts Launchpad at login: clicking
// the Start Menu entry afterwards must raise the window that is already there, not start a
// second tray icon whose server loses the race for :7420.
//
// The lock is keyed by the app's userData path, i.e. by app name — and all three ways of
// starting this shell would otherwise share one name (package.json's, since no `productName`
// field exists to override it) and therefore one lock. Naming them apart keeps each channel
// independently launchable: without it, `npm run desktop` while the installed app is running
// would silently focus the installed window instead, which is baffling in the one workflow that
// needs it — editing main.cjs itself.
//
// Only Electron's cache/userData directory follows the name. The database does not: it lives at
// %APPDATA%\launchpad-v2 by way of src/server/config.ts, so all channels still share one live
// database on purpose.
if (DEV) app.setName('launchpad-dev')
else if (!app.isPackaged) app.setName('launchpad-src')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  app.whenReady().then(async () => {
    // Windows groups taskbar entries and picks the icon by AppUserModelID; without an
    // explicit one, an unpackaged Electron app is shown as "Electron".
    // A distinct id in dev so Windows gives the dev window its own taskbar button instead of
    // merging it with the always-on app.
    if (process.platform === 'win32') {
      app.setAppUserModelId(DEV ? 'dk.mikkelblom.launchpad.dev' : 'dk.mikkelblom.launchpad')
    }

    // Nothing works before this: the server, the UI and the login item all live downstream of
    // knowing which working copy is the app.
    const resolved = resolveAppRoot(app.isPackaged)
    APP_ROOT = resolved.appDir
    if (!APP_ROOT) {
      if (!(await resolveAppFolderInteractively(resolved.candidates))) {
        quitting = true
        app.quit()
        return
      }
    } else {
      console.log(`[launchpad] app folder: ${APP_ROOT} (from ${resolved.source})`)
    }

    startAtLogin = readLoginItem()
    createTray()
    await ensureServer()
    // Only once the service is up can the database say what start-at-login should be.
    // If it never comes up, the login item is left untouched rather than guessed at.
    await reconcileStartAtLogin()
    // At login the app belongs in the tray; the window is created lazily on first open.
    if (!START_HIDDEN) createWindow()
  })
}

app.on('window-all-closed', () => {
  // Keep running in the tray — do not quit.
})

app.on('before-quit', () => {
  quitting = true
  // Only ever kills a server this shell started, so closing a dev window leaves the
  // always-on app (and `npm run dev`) running.
  stopServer()
})
