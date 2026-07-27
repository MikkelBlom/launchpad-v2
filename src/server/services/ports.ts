import { execFile } from 'node:child_process'
import { closeSync, existsSync, openSync, readSync } from 'node:fs'
import { createServer as createProbeServer } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { getProject, listProjects, updateProject } from '../repo/projects.ts'
import type { PortCheck, PortOverview, Project, ProjectPort } from '../../shared/types.ts'

const execFileAsync = promisify(execFile)

// Every failure path here produces a sentence the caller can show verbatim.
export class PortError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'PortError'
    this.status = status
  }
}

export const MIN_PORT = 1024
export const MAX_PORT = 65535

// Ports Launchpad must never hand out. 3000/3001/5000 are permanently occupied on this
// machine; 7420 is the Launchpad service and 7421 its Vite dev server.
export const RESERVED_PORTS = new Set([3000, 3001, 5000, 7420, 7421])

// Suggestions come from the band just above Launchpad's own ports: high enough to clear
// every common dev-server default (5173, 8080, 8000, 5432, 4200 …) and low enough to stay
// under the Windows ephemeral range, which starts at 49152.
const SUGGEST_FROM = 7430
const SUGGEST_TO = 7999

export function devUrl(port: number | null): string | null {
  return port === null ? null : `http://localhost:${port}`
}

function sanePort(value: unknown): number | null {
  const port = Number(value)
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) return null
  return port
}

// ---- What is listening right now ----

const LISTENING_TTL_MS = 5000
let listeningCache: { at: number; ports: number[] } | null = null

// One read of the OS socket table beats probing ports one at a time: it is a single call,
// it binds nothing, and it sees ports held by processes Launchpad knows nothing about.
async function queryListeningPorts(): Promise<number[]> {
  if (process.platform !== 'win32') return []
  try {
    const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'TCP'], {
      windowsHide: true,
      timeout: 6000,
      maxBuffer: 16 * 1024 * 1024
    })
    const ports = new Set<number>()
    for (const line of stdout.split('\n')) {
      if (!line.includes('LISTENING')) continue
      // "  TCP    0.0.0.0:7420    0.0.0.0:0    LISTENING    1234"
      const local = line.trim().split(/\s+/)[1] ?? ''
      const port = Number(local.slice(local.lastIndexOf(':') + 1))
      if (Number.isInteger(port) && port > 0) ports.add(port)
    }
    return [...ports].sort((a, b) => a - b)
  } catch {
    // netstat missing, blocked or slow. An empty list degrades the overview to "unknown",
    // which is a far better outcome than failing the whole request.
    return []
  }
}

// Cached for a few seconds so one page render doesn't shell out once per project.
export async function readListeningPorts(refresh = false): Promise<number[]> {
  if (!refresh && listeningCache && Date.now() - listeningCache.at < LISTENING_TTL_MS) {
    return listeningCache.ports
  }
  const ports = await queryListeningPorts()
  listeningCache = { at: Date.now(), ports }
  return ports
}

// "Can I actually bind this?" — the only answer the OS table can't give. The probe server
// is always closed, whichever way the attempt ends.
export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createProbeServer()
    let settled = false
    const finish = (available: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      probe.close(() => resolve(available))
    }
    const timer = setTimeout(() => finish(false), 1500)
    timer.unref?.()
    probe.once('error', () => finish(false))
    probe.once('listening', () => finish(true))
    try {
      probe.listen({ port, host: '127.0.0.1', exclusive: true })
    } catch {
      finish(false)
    }
  })
}

// ---- Detecting a project's dev port from its files ----

const HEAD_BYTES = 64 * 1024

// Config files put what we need near the top, and some of these (a fat .env, a long
// compose file) are not worth pulling into memory whole.
function readHead(file: string): string | null {
  let fd: number | null = null
  try {
    fd = openSync(file, 'r')
    const buffer = Buffer.alloc(HEAD_BYTES)
    const read = readSync(fd, buffer, 0, HEAD_BYTES, 0)
    return buffer.toString('utf-8', 0, read)
  } catch {
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

// `.claude/launch.json` — the convention this repo itself uses.
function fromLaunchJson(text: string): number | null {
  try {
    const data = JSON.parse(text) as { port?: unknown; configurations?: Array<{ port?: unknown }> }
    const direct = sanePort(data.port)
    if (direct !== null) return direct
    for (const config of data.configurations ?? []) {
      const port = sanePort(config?.port)
      if (port !== null) return port
    }
  } catch {
    /* a malformed launch.json is the same as no launch.json */
  }
  return null
}

// Only a `port` inside a `server: { … }` block counts — a bare `port:` anywhere in a Vite
// config is as likely to be a proxy target as the dev server's own port.
function fromViteConfig(text: string): number | null {
  const start = text.search(/\bserver\s*:\s*\{/)
  if (start === -1) return null
  const match = text.slice(start, start + 600).match(/\bport\s*:\s*(\d{2,5})/)
  return match ? sanePort(match[1]) : null
}

const SCRIPT_PORT = /(?:--port[=\s]+|(?:^|\s)-p[=\s]+|(?:^|\s)PORT=)(\d{2,5})/

// Scripts are checked in the order a dev server is most likely to live in them.
const SCRIPT_NAMES = ['dev', 'start', 'serve', 'dev:web', 'web', 'preview']

function fromPackageJson(text: string): number | null {
  let scripts: Record<string, string> = {}
  try {
    scripts = (JSON.parse(text) as { scripts?: Record<string, string> }).scripts ?? {}
  } catch {
    return null
  }
  for (const name of SCRIPT_NAMES) {
    const match = (scripts[name] ?? '').match(SCRIPT_PORT)
    const port = match ? sanePort(match[1]) : null
    if (port !== null) return port
  }
  return null
}

function fromNextConfig(text: string): number | null {
  const match = text.match(/\bport\s*:\s*(\d{2,5})/)
  return match ? sanePort(match[1]) : null
}

function fromEnvFile(text: string): number | null {
  const match = text.match(/^\s*(?:export\s+)?PORT\s*=\s*["']?(\d{2,5})/m)
  return match ? sanePort(match[1]) : null
}

// A published mapping (`- "8080:80"`, `- 127.0.0.1:8080:80`) — the host side is the one a
// browser connects to. An unpublished `expose:` entry is deliberately ignored.
const COMPOSE_MAPPING = /^\s*-\s*["']?(?:\d{1,3}(?:\.\d{1,3}){3}:)?(\d{2,5}):\d{2,5}(?:\/\w+)?["']?\s*$/gm

function fromCompose(text: string): number | null {
  for (const match of text.matchAll(COMPOSE_MAPPING)) {
    const port = sanePort(match[1])
    if (port !== null) return port
  }
  return null
}

// dotnet's launchSettings.json lists applicationUrls; prefer the plain-http one.
function fromLaunchSettings(text: string): number | null {
  let httpsPort: number | null = null
  for (const match of text.matchAll(/(https?):\/\/(?:localhost|127\.0\.0\.1):(\d{2,5})/g)) {
    const port = sanePort(match[2])
    if (port === null) continue
    if (match[1] === 'http') return port
    httpsPort ??= port
  }
  return httpsPort
}

// Most trustworthy first: the first file that yields a plausible port wins, and its name
// becomes the recorded source. A wrong guess is worse than none, so every reader below
// only accepts a port it found in an unambiguous position.
const DETECTORS: Array<{ file: string; read: (text: string) => number | null }> = [
  { file: '.claude/launch.json', read: fromLaunchJson },
  { file: 'vite.config.ts', read: fromViteConfig },
  { file: 'vite.config.js', read: fromViteConfig },
  { file: 'vite.config.mts', read: fromViteConfig },
  { file: 'vite.config.mjs', read: fromViteConfig },
  { file: 'package.json', read: fromPackageJson },
  { file: 'next.config.ts', read: fromNextConfig },
  { file: 'next.config.mjs', read: fromNextConfig },
  { file: 'next.config.js', read: fromNextConfig },
  { file: '.env.local', read: fromEnvFile },
  { file: '.env', read: fromEnvFile },
  { file: 'docker-compose.yml', read: fromCompose },
  { file: 'docker-compose.yaml', read: fromCompose },
  { file: 'compose.yml', read: fromCompose },
  { file: 'compose.yaml', read: fromCompose },
  { file: 'Properties/launchSettings.json', read: fromLaunchSettings },
  { file: 'launchSettings.json', read: fromLaunchSettings }
]

export interface PortDetection {
  port: number | null
  source: string | null
}

export function detectDevPort(projectPath: string): PortDetection {
  if (!projectPath || !existsSync(projectPath)) return { port: null, source: null }
  for (const detector of DETECTORS) {
    const file = join(projectPath, ...detector.file.split('/'))
    if (!existsSync(file)) continue
    const text = readHead(file)
    if (text === null) continue
    const port = detector.read(text)
    if (port !== null) return { port, source: detector.file }
  }
  return { port: null, source: null }
}

// ---- Claims, conflicts, suggestions ----

function claimedPorts(): Map<number, string[]> {
  const byPort = new Map<number, string[]>()
  for (const project of listProjects()) {
    if (project.devPort === null) continue
    const names = byPort.get(project.devPort) ?? []
    names.push(project.name)
    byPort.set(project.devPort, names)
  }
  return byPort
}

export function projectsClaiming(port: number, exceptProjectId?: number): string[] {
  return listProjects()
    .filter((p) => p.devPort === port && p.id !== exceptProjectId)
    .map((p) => p.name)
}

// Free ports, ascending. Excludes anything listening, anything a project already claims,
// and the reserved set — then confirms each candidate is genuinely bindable before
// offering it, since the OS can hold a port without listening on it.
export async function suggestPorts(count = 3): Promise<number[]> {
  const wanted = Math.min(Math.max(Math.trunc(count) || 3, 1), 20)
  const listening = new Set(await readListeningPorts())
  const claimed = claimedPorts()
  const found: number[] = []
  for (let port = SUGGEST_FROM; port <= SUGGEST_TO && found.length < wanted; port++) {
    if (RESERVED_PORTS.has(port) || listening.has(port) || claimed.has(port)) continue
    if (!(await isPortAvailable(port))) continue
    found.push(port)
  }
  return found
}

export async function checkPort(port: number): Promise<PortCheck> {
  const valid = sanePort(port)
  if (valid === null) {
    return {
      port: Number.isFinite(Number(port)) ? Number(port) : 0,
      available: false,
      listening: false,
      claimedBy: null,
      reason: `A dev port must be a whole number between ${MIN_PORT} and ${MAX_PORT}.`
    }
  }

  const listening = (await readListeningPorts()).includes(valid)
  const claimedBy = claimedPorts().get(valid)?.join(', ') ?? null

  if (RESERVED_PORTS.has(valid)) {
    return {
      port: valid,
      available: false,
      listening,
      claimedBy,
      reason:
        valid === 7420 || valid === 7421
          ? `Port ${valid} belongs to Launchpad itself — pick another.`
          : `Port ${valid} is permanently in use on this machine — pick another.`
    }
  }

  if (listening) {
    return {
      port: valid,
      available: false,
      listening,
      claimedBy,
      reason: claimedBy
        ? `Something is listening on ${valid}; "${claimedBy}" claims it, so it is probably already running.`
        : `Something is already listening on ${valid}, but no Launchpad project claims it.`
    }
  }

  if (!(await isPortAvailable(valid))) {
    return {
      port: valid,
      available: false,
      listening,
      claimedBy,
      reason: `Port ${valid} cannot be bound — the OS or another process is holding it.`
    }
  }

  if (claimedBy) {
    return {
      port: valid,
      available: false,
      listening,
      claimedBy,
      reason: `Port ${valid} is free right now, but "${claimedBy}" already claims it — pick another.`
    }
  }

  return {
    port: valid,
    available: true,
    listening,
    claimedBy,
    reason: `Port ${valid} is free and unclaimed.`
  }
}

// ---- Overview ----

// Archived projects are hidden unless they claim a port, in which case they still have to
// show up — an invisible claim is exactly the sort of conflict this page exists to explain.
export async function buildPortOverview(): Promise<PortOverview> {
  const projects = listProjects()
  const listening = await readListeningPorts()
  const listeningSet = new Set(listening)
  const byPort = claimedPorts()

  const rows: ProjectPort[] = projects
    .filter((project) => project.status !== 'archived' || project.devPort !== null)
    .map((project) => ({
      projectId: project.id,
      name: project.name,
      devPort: project.devPort,
      devPortSource: project.devPortSource,
      url: devUrl(project.devPort),
      listening: project.devPort !== null && listeningSet.has(project.devPort),
      conflictsWith:
        project.devPort === null
          ? []
          : (byPort.get(project.devPort) ?? []).filter((name) => name !== project.name)
    }))
    .sort((a, b) => {
      if (a.devPort !== null && b.devPort !== null) return a.devPort - b.devPort
      if (a.devPort !== null) return -1
      if (b.devPort !== null) return 1
      return a.name.localeCompare(b.name)
    })

  return { projects: rows, listening, suggested: await suggestPorts(3) }
}

// ---- Writes ----

export function setProjectPort(
  projectId: number,
  port: number | null,
  source = 'manual'
): Project {
  const project = getProject(projectId)
  if (!project) throw new PortError('Project not found', 404)
  if (port === null) {
    return updateProject(projectId, { devPort: null, devPortSource: null })!
  }
  const valid = sanePort(port)
  if (valid === null) {
    throw new PortError(
      `A dev port must be a whole number between ${MIN_PORT} and ${MAX_PORT} — got "${String(port)}".`
    )
  }
  return updateProject(projectId, { devPort: valid, devPortSource: source })!
}

export interface DetectResult extends PortDetection {
  project: Project
}

// Detection is only stored when it found something: a project whose config says nothing
// keeps whatever port was claimed by hand.
export function detectAndStorePort(projectId: number): DetectResult {
  const project = getProject(projectId)
  if (!project) throw new PortError('Project not found', 404)
  if (!project.pathExists) {
    throw new PortError(`"${project.name}"'s folder is missing: ${project.path}`)
  }
  const detection = detectDevPort(project.path)
  if (detection.port === null) return { ...detection, project }
  const updated = updateProject(projectId, {
    devPort: detection.port,
    devPortSource: detection.source
  })!
  return { ...detection, project: updated }
}
