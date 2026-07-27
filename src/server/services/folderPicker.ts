import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { normalizePath } from '../config.ts'

// The UI runs in a browser tab, which cannot open a folder chooser. The Launchpad service
// runs on the same machine as that browser, so it opens the *native* dialog on the user's
// desktop and hands the chosen path back over the API.

// How long a forgotten dialog may hold a request open before we kill it.
const DIALOG_TIMEOUT_MS = 3 * 60 * 1000

// Windows PowerShell 5.1 always exists on Windows 11 and always has WinForms; pwsh is a
// fallback for a stripped-down box. Both need -STA for FolderBrowserDialog.
const POWERSHELL_HOSTS = ['powershell.exe', 'pwsh.exe']

// The title arrives via an env var, never interpolated into the script, so a title can
// never turn into PowerShell code.
const TITLE_ENV = 'LAUNCHPAD_PICK_TITLE'

const PICKER_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$title = $env:${TITLE_ENV}
if ([string]::IsNullOrWhiteSpace($title)) { $title = 'Select a folder' }

# FolderBrowserDialog is notorious for opening behind the window that asked for it.
# Owning it with a 1x1, invisible, TopMost form drags it to the front of everything.
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$owner.Opacity = 0
$owner.Width = 1
$owner.Height = 1
$owner.Show()
$owner.Activate()
[System.Windows.Forms.Application]::DoEvents()

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = $title
$dialog.ShowNewFolderButton = $true
try {
  $result = $dialog.ShowDialog($owner)
} finally {
  $owner.Close()
  $owner.Dispose()
}

if ($result -eq [System.Windows.Forms.DialogResult]::OK -and -not [string]::IsNullOrWhiteSpace($dialog.SelectedPath)) {
  # Base64 so the path survives whatever OEM code page this console happens to use.
  [Console]::Out.Write([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($dialog.SelectedPath)))
}
`

// -EncodedCommand takes UTF-16LE base64, which sidesteps all cmd/PowerShell quoting.
const ENCODED_SCRIPT = Buffer.from(PICKER_SCRIPT, 'utf16le').toString('base64')

type PickOutcome =
  | { status: 'picked'; path: string }
  | { status: 'cancelled' }
  | { status: 'timeout' }
  | { status: 'failed'; reason: string }

function runDialog(exe: string, title: string): Promise<PickOutcome> {
  return new Promise((resolve) => {
    let settled = false
    let timer: NodeJS.Timeout | undefined
    const done = (outcome: PickOutcome) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(outcome)
    }

    const child = spawn(exe, ['-NoProfile', '-STA', '-EncodedCommand', ENCODED_SCRIPT], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, [TITLE_ENV]: title }
    })

    timer = setTimeout(() => {
      child.kill()
      done({ status: 'timeout' })
    }, DIALOG_TIMEOUT_MS)

    let stdout = ''
    let stderr = ''
    // The payload is base64, so ascii decoding is exact; stderr is drained so a chatty
    // failure can never fill the pipe and wedge the child.
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('ascii') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })

    child.on('error', (error) => done({ status: 'failed', reason: error.message }))

    child.on('close', (code) => {
      if (code !== 0) {
        return done({ status: 'failed', reason: stderr.trim() || `${exe} exited with code ${code}` })
      }
      const payload = stdout.trim()
      if (!payload) return done({ status: 'cancelled' })

      const picked = Buffer.from(payload, 'base64').toString('utf8').trim()
      if (!picked || !existsSync(picked) || !statSync(picked).isDirectory()) {
        return done({ status: 'failed', reason: `Picker returned an unusable path: ${picked}` })
      }
      done({ status: 'picked', path: normalizePath(picked) })
    })
  })
}

async function showPicker(title: string): Promise<string | null> {
  // Only Windows has a dialog implementation; everywhere else the UI falls back to typing.
  if (process.platform !== 'win32') return null

  for (const exe of POWERSHELL_HOSTS) {
    const outcome = await runDialog(exe, title)
    if (outcome.status === 'picked') return outcome.path
    // Cancel and timeout are the user's answer — do not reopen the dialog under them.
    if (outcome.status === 'cancelled') return null
    if (outcome.status === 'timeout') {
      console.warn(`[folderPicker] dialog timed out after ${DIALOG_TIMEOUT_MS}ms; process killed`)
      return null
    }
    console.warn(`[folderPicker] ${exe} failed: ${outcome.reason}`)
  }
  return null
}

// One dialog at a time: a second request while one is open (double-click, two tabs) joins
// the pending one instead of stacking modals the user has to dismiss twice.
let inFlight: Promise<string | null> | null = null

// Resolves to the selected folder, or null if the user cancelled, the dialog timed out,
// or no picker is available. Never throws — the caller falls back to a typed path.
export function pickFolder(title?: string): Promise<string | null> {
  if (inFlight) return inFlight
  const dialogTitle = (title ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120) || 'Select a folder'
  inFlight = showPicker(dialogTitle)
    .catch((error) => {
      console.warn(`[folderPicker] ${String(error instanceof Error ? error.message : error)}`)
      return null
    })
    .finally(() => { inFlight = null })
  return inFlight
}
