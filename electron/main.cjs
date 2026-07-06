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

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Launchpad',
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
}

function showWindow() {
  if (!win) createWindow()
  else {
    win.show()
    win.focus()
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(join(APP_ROOT, 'resources', 'tray.png'))
  tray = new Tray(icon)
  tray.setToolTip('Launchpad')
  const menu = Menu.buildFromTemplate([
    { label: 'Open Launchpad', click: showWindow },
    { label: 'Open in browser', click: () => shell.openExternal(uiUrl()) },
    { type: 'separator' },
    {
      label: 'Start at login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked })
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
  tray.setContextMenu(menu)
  tray.on('click', showWindow)
}

app.whenReady().then(async () => {
  // Launch at login by default (the user asked for startup launch).
  if (!app.getLoginItemSettings().openAtLogin) {
    app.setLoginItemSettings({ openAtLogin: true })
  }
  createTray()
  await ensureServer()
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
