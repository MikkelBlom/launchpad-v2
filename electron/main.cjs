// Thin Electron shell. It does NOT run the server or touch SQLite itself — Electron's
// bundled Node lacks node:sqlite. Instead it spawns the Launchpad server under the
// system Node (24+) as a child process, then hosts a window pointing at localhost.
const { app, BrowserWindow, Tray, Menu, shell, nativeImage } = require('electron')
const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

const PORT = process.env.LAUNCHPAD_PORT || '7420'
const DEV_PORT = '7421'
const APP_ROOT = join(__dirname, '..')

let tray = null
let win = null
let serverChild = null
let quitting = false
// Mirror of AppSettings.startAtLogin. Seeded from Windows so the tray shows something
// truthful before the service answers, then kept in step with the database.
let startAtLogin = false
let reconciling = false

function uiUrl() {
  const built = existsSync(join(APP_ROOT, 'dist', 'web', 'index.html'))
  return built ? `http://localhost:${PORT}` : `http://localhost:${DEV_PORT}`
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

async function ensureServer() {
  if (await isServerUp()) return // already running (e.g. autostarted separately)
  // Spawn under the system Node via tsx. shell:true resolves node/tsx from PATH + local deps.
  serverChild = spawn('node', ['--import', 'tsx', 'src/server/index.ts'], {
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

// A Windows login item is an executable plus arguments. Run unpackaged (`npm run desktop`)
// that executable is electron.exe, which at login would start a blank Electron app unless
// the entry script rides along — so path/args are stated explicitly, and the same pair is
// used when reading the setting back, since Windows matches on it.
function loginItemOptions() {
  if (app.isPackaged) return {}
  return { path: process.execPath, args: [join(__dirname, 'main.cjs')] }
}

function readLoginItem() {
  try {
    return app.getLoginItemSettings(loginItemOptions()).openAtLogin
  } catch {
    return false
  }
}

function applyLoginItem(openAtLogin) {
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
  if (reconciling) return
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

const APP_ICON = join(APP_ROOT, 'resources', 'icon.png')

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Launchpad',
    // Without this the window and taskbar show Electron's default logo.
    icon: APP_ICON,
    backgroundColor: '#faf9f7',
    webPreferences: { preload: join(__dirname, 'preload.cjs') }
  })
  win.setMenuBarVisibility(false)
  win.loadURL(uiUrl())

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
    { label: 'Open Launchpad', click: showWindow },
    { label: 'Open in browser', click: () => shell.openExternal(uiUrl()) },
    { type: 'separator' },
    {
      label: 'Start at login',
      type: 'checkbox',
      checked: startAtLogin,
      click: (item) => void setStartAtLogin(item.checked)
    },
    { type: 'separator' },
    {
      label: 'Quit Launchpad',
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
  const icon = nativeImage.createFromPath(join(APP_ROOT, 'resources', 'tray.png'))
  tray = new Tray(icon)
  tray.setToolTip('Launchpad')
  tray.setContextMenu(buildTrayMenu())
  tray.on('click', showWindow)
}

app.whenReady().then(async () => {
  // Windows groups taskbar entries and picks the icon by AppUserModelID; without an
  // explicit one, an unpackaged Electron app is shown as "Electron".
  if (process.platform === 'win32') {
    app.setAppUserModelId('dk.mikkelblom.launchpad')
  }
  startAtLogin = readLoginItem()
  createTray()
  await ensureServer()
  // Only once the service is up can the database say what start-at-login should be.
  // If it never comes up, the login item is left untouched rather than guessed at.
  await reconcileStartAtLogin()
  createWindow()
})

app.on('window-all-closed', () => {
  // Keep running in the tray — do not quit.
})

app.on('before-quit', () => {
  quitting = true
  if (serverChild && serverChild.pid) {
    // Kill the whole server process tree on Windows.
    try {
      spawn('taskkill', ['/pid', String(serverChild.pid), '/T', '/F'], { shell: true })
    } catch {
      /* ignore */
    }
  }
})
