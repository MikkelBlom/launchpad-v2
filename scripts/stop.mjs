// Stop every Launchpad process this repo started — the service, tsx watch, Vite, concurrently.
//
// Why not just kill whatever holds port 7420: on Windows `tsx watch` regularly leaves an
// orphaned server behind whose listener is already gone, so a port-based kill reports success
// and the next `npm run dev` still dies on EADDRINUSE. Matching on the command line finds the
// orphans too.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// A process is ours only if its command line points into this repo AND looks like something
// we start. The second half is what keeps this script from killing the shell that runs it
// (`npm run stop`), or an editor/terminal that merely happens to sit in the folder.
const OURS = /(server[\\/]index\.(ts|js)|[\\/]tsx[\\/]|[\\/]vite[\\/]|[\\/]concurrently[\\/])/i

function listProcesses() {
  // Select-Object before ConvertTo-Json keeps the payload small; -Depth 2 avoids CIM's
  // self-referential properties blowing the serialiser up. No -AsArray: this has to run under
  // Windows PowerShell 5.1, where a single match serialises to a bare object instead.
  const ps = `Get-CimInstance Win32_Process |
    Where-Object { $_.Name -match '^(node|electron)\\.exe$' } |
    Select-Object ProcessId, Name, CommandLine |
    ConvertTo-Json -Depth 2`
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    )
    const parsed = JSON.parse(out.trim() || 'null')
    if (!parsed) return []
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch (err) {
    console.error('Could not enumerate processes:', err.message)
    return []
  }
}

const rootNeedle = ROOT.toLowerCase()
const targets = listProcesses().filter((p) => {
  const cmd = (p.CommandLine || '').toLowerCase()
  if (!cmd) return false
  if (p.ProcessId === process.pid) return false
  if (cmd.includes('stop.mjs')) return false
  // Match the resolved path when possible, and fall back to the folder name for processes
  // started through a different drive casing or a junction.
  if (!cmd.includes(rootNeedle) && !cmd.includes('launchpad-v2')) return false
  return OURS.test(cmd)
})

if (targets.length === 0) {
  console.log('Nothing to stop — no Launchpad server, tsx watch or Vite process is running.')
  process.exit(0)
}

// `npm run stop -- --dry-run` prints the matches and touches nothing.
if (process.argv.includes('--dry-run')) {
  console.log(`Would stop ${targets.length} process(es):`)
  for (const p of targets) {
    console.log(`  ${p.Name} (pid ${p.ProcessId})  ${(p.CommandLine || '').slice(0, 120)}`)
  }
  process.exit(0)
}

for (const p of targets) {
  const label = `${p.Name} (pid ${p.ProcessId})`
  try {
    // /T so the shell:true wrapper's real child dies too, /F because tsx ignores polite asks.
    execFileSync('taskkill', ['/PID', String(p.ProcessId), '/T', '/F'], { stdio: 'ignore' })
    console.log(`Stopped ${label}`)
  } catch {
    // Already gone, most likely killed as part of an earlier target's tree.
    console.log(`Already gone: ${label}`)
  }
}
