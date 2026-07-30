// Where is "the app"?
//
// The shell is not the app (see ai-instructions/CLAUDE.md). Electron hosts a window and spawns
// a server; the server bundle and the built UI are ordinary files in the working copy. The
// installer therefore packages the shell ONLY, which means an installed shell has to be told
// which directory to read the app from — it is not the directory the shell itself lives in.
//
// Resolution order, first valid one wins:
//   1. LAUNCHPAD_APP_DIR                     — an explicit override for one run
//   2. %APPDATA%\launchpad-v2\shell.json     — what the user last picked in the app folder dialog
//   3. resources/app-dir.json                — baked at package time by scripts/bake-app-dir.mjs
//   4. the shell's own parent directory      — unpackaged only; running straight from the repo
//
// Each candidate is validated rather than trusted, so a stale shell.json (repo moved, drive
// unplugged) falls through to the baked path instead of leaving a dead app.
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const SHELL_ROOT = join(__dirname, '..')

// Kept in step with src/server/config.ts on purpose: the shell must look in the same place the
// server does, and it cannot import TypeScript.
function dataDir() {
  const override = process.env.LAUNCHPAD_DATA_DIR
  if (override) return override
  const base = process.env.APPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Roaming')
  return join(base, 'launchpad-v2')
}

function shellConfigPath() {
  return join(dataDir(), 'shell.json')
}

// A directory qualifies if the shell could actually start a server from it: a built bundle, or
// source to run under tsx. Checking for the *server* rather than a marker file means a
// half-installed or wrong folder is rejected before it produces a blank window.
function isAppDir(dir) {
  if (!dir || typeof dir !== 'string') return false
  return (
    existsSync(join(dir, 'dist', 'server', 'index.js')) ||
    existsSync(join(dir, 'src', 'server', 'index.ts'))
  )
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function savedAppDir() {
  const cfg = readJson(shellConfigPath())
  return cfg && typeof cfg.appDir === 'string' ? cfg.appDir : null
}

function bakedAppDir() {
  const cfg = readJson(join(SHELL_ROOT, 'resources', 'app-dir.json'))
  return cfg && typeof cfg.appDir === 'string' ? cfg.appDir : null
}

// `packaged` is passed in rather than read from `app` so this module stays free of Electron and
// can be unit-tested (and required before app.whenReady).
function resolveAppRoot(packaged) {
  const candidates = [
    { source: 'LAUNCHPAD_APP_DIR', dir: process.env.LAUNCHPAD_APP_DIR },
    { source: 'shell.json', dir: savedAppDir() },
    { source: 'app-dir.json', dir: bakedAppDir() },
    // An installed shell must never fall back to its own directory: that would silently point
    // the app at the install folder, which contains no server, and the failure would look like
    // a broken build instead of a missing setting.
    ...(packaged ? [] : [{ source: 'repo', dir: SHELL_ROOT }])
  ].filter((c) => c.dir)

  for (const c of candidates) {
    if (isAppDir(c.dir)) return { appDir: c.dir, source: c.source, candidates }
  }
  return { appDir: null, source: null, candidates }
}

function saveAppDir(dir) {
  const path = shellConfigPath()
  mkdirSync(dataDir(), { recursive: true })
  const cfg = readJson(path) || {}
  cfg.appDir = dir
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n')
  return path
}

module.exports = { SHELL_ROOT, isAppDir, resolveAppRoot, saveAppDir, shellConfigPath }
