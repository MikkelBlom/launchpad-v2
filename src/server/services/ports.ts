import { execFile } from 'node:child_process'
import { closeSync, existsSync, openSync, readSync } from 'node:fs'
import { createServer as createProbeServer } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  deleteAllPorts,
  deletePort,
  findClaim,
  listAllPorts,
  reorderPorts,
  upsertPort
} from '../repo/projectPorts.ts'
import { getProject, listProjects } from '../repo/projects.ts'
import type {
  PortCheck,
  PortClaim,
  PortClaimResult,
  PortClaimRow,
  PortDetectResult,
  PortOverview,
  PortSuggestion,
  Project
} from '../../shared/types.ts'

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

// Ports Launchpad must never hand out: its own service and its own dev server. Nothing else
// belongs here.
//
// 3000/3001/5000 used to sit in this set as "permanently taken on this machine". They are
// not machine facts — they are the ports one registered project (PMS) runs on, and encoding
// that here was wrong twice over: it told every other project the wrong reason for the
// refusal, and it stopped PMS itself from claiming the ports it actually uses. A port that
// belongs to a project is expressed by that project claiming it; the conflict rule then
// refuses everyone else, with a message naming the owner. Reserve a port here only when
// Launchpad itself needs it.
export const RESERVED_PORTS = new Set([7420, 7421])

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

// Readers return every port their file declares, in the order the file declares them: a
// project that runs several processes says so in one place (a compose file with two
// published mappings, a launch.json with two configurations), and claiming one of them and
// silently dropping the rest is how a project ends up half-registered.
function unique(ports: Array<number | null>): number[] {
  return [...new Set(ports.filter((port): port is number => port !== null))]
}

// `.claude/launch.json` — the convention this repo itself uses.
function fromLaunchJson(text: string): number[] {
  try {
    const data = JSON.parse(text) as { port?: unknown; configurations?: Array<{ port?: unknown }> }
    return unique([
      sanePort(data.port),
      ...(data.configurations ?? []).map((config) => sanePort(config?.port))
    ])
  } catch {
    /* a malformed launch.json is the same as no launch.json */
    return []
  }
}

// Only a `port` inside a `server: { … }` block counts — a bare `port:` anywhere in a Vite
// config is as likely to be a proxy target as the dev server's own port.
function fromViteConfig(text: string): number[] {
  const start = text.search(/\bserver\s*:\s*\{/)
  if (start === -1) return []
  const match = text.slice(start, start + 600).match(/\bport\s*:\s*(\d{2,5})/)
  return unique([match ? sanePort(match[1]) : null])
}

const SCRIPT_PORT = /(?:--port[=\s]+|(?:^|\s)-p[=\s]+|(?:^|\s)PORT=)(\d{2,5})/

// Scripts are checked in the order a dev server is most likely to live in them. A repo with
// both `dev:web --port 5173` and `dev:api --port 8081` really does hold two ports.
const SCRIPT_NAMES = ['dev', 'start', 'serve', 'dev:web', 'web', 'dev:api', 'api', 'server', 'preview']

function fromPackageJson(text: string): number[] {
  let scripts: Record<string, string> = {}
  try {
    scripts = (JSON.parse(text) as { scripts?: Record<string, string> }).scripts ?? {}
  } catch {
    return []
  }
  return unique(
    SCRIPT_NAMES.map((name) => {
      const match = (scripts[name] ?? '').match(SCRIPT_PORT)
      return match ? sanePort(match[1]) : null
    })
  )
}

function fromNextConfig(text: string): number[] {
  const match = text.match(/\bport\s*:\s*(\d{2,5})/)
  return unique([match ? sanePort(match[1]) : null])
}

// Only variables that unambiguously name *this app's* listening port. DB_PORT=5432 and
// REDIS_PORT=6379 are things the app connects to, not ports it holds, and claiming them
// would put someone else's service in Launchpad under this project's name.
const ENV_PORT_NAMES = ['PORT', 'API_PORT', 'SERVER_PORT', 'WEB_PORT', 'CLIENT_PORT', 'APP_PORT']

function fromEnvFile(text: string): number[] {
  return unique(
    ENV_PORT_NAMES.map((name) => {
      const match = text.match(new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*["']?(\\d{2,5})`, 'm'))
      return match ? sanePort(match[1]) : null
    })
  )
}

// A published mapping (`- "8080:80"`, `- 127.0.0.1:8080:80`) — the host side is the one a
// browser connects to. An unpublished `expose:` entry is deliberately ignored.
const COMPOSE_MAPPING = /^\s*-\s*["']?(?:\d{1,3}(?:\.\d{1,3}){3}:)?(\d{2,5}):\d{2,5}(?:\/\w+)?["']?\s*$/gm

function fromCompose(text: string): number[] {
  return unique([...text.matchAll(COMPOSE_MAPPING)].map((match) => sanePort(match[1])))
}

// dotnet's launchSettings.json lists applicationUrls; prefer the plain-http ones and fall
// back to https only when the file offers nothing else.
function fromLaunchSettings(text: string): number[] {
  const http: Array<number | null> = []
  const https: Array<number | null> = []
  for (const match of text.matchAll(/(https?):\/\/(?:localhost|127\.0\.0\.1):(\d{2,5})/g)) {
    ;(match[1] === 'http' ? http : https).push(sanePort(match[2]))
  }
  const plain = unique(http)
  return plain.length > 0 ? plain : unique(https)
}

// Most trustworthy first: the first file that yields a plausible port wins, and its name
// becomes the recorded source. A wrong guess is worse than none, so every reader above
// only accepts a port it found in an unambiguous position — and one file's word is taken
// whole rather than merged with the next file's, which would mix a real port with a stale
// one left in some config nobody uses any more.
const DETECTORS: Array<{ file: string; read: (text: string) => number[] }> = [
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
  ports: number[]
  source: string | null
}

// A config file with a dozen published ports is describing infrastructure, not a dev
// server; stopping at six keeps a runaway compose file from filling the ports page.
const MAX_DETECTED = 6

export function detectDevPorts(projectPath: string): PortDetection {
  if (!projectPath || !existsSync(projectPath)) return { ports: [], source: null }
  for (const detector of DETECTORS) {
    const file = join(projectPath, ...detector.file.split('/'))
    if (!existsSync(file)) continue
    const text = readHead(file)
    if (text === null) continue
    const ports = detector.read(text)
    if (ports.length > 0) return { ports: ports.slice(0, MAX_DETECTED), source: detector.file }
  }
  return { ports: [], source: null }
}

// ---- Claims, conflicts, suggestions ----

// Project names indexed by the port they claim. Built from `project_ports`, so a project
// holding four ports appears under all four.
function claimantsByPort(): Map<number, string[]> {
  const names = new Map<number, string>(listProjects().map((project) => [project.id, project.name]))
  const byPort = new Map<number, string[]>()
  for (const claim of listAllPorts()) {
    const name = names.get(claim.projectId)
    if (name === undefined) continue
    byPort.set(claim.port, [...(byPort.get(claim.port) ?? []), name])
  }
  return byPort
}

export function projectsClaiming(port: number, exceptProjectId?: number): string[] {
  const names = new Map<number, string>(listProjects().map((project) => [project.id, project.name]))
  return listAllPorts()
    .filter((claim) => claim.port === port && claim.projectId !== exceptProjectId)
    .map((claim) => names.get(claim.projectId) ?? `#${claim.projectId}`)
}

// Free ports, ascending. Excludes anything listening, anything a project already claims,
// and the reserved set — then confirms each candidate is genuinely bindable before offering
// it, since the OS can hold a port without listening on it.
//
// What it skipped is returned alongside the answer. "Is this list only looking at what's
// listening?" is the first thing anyone asks of a free-port list, and the only convincing
// reply is the arithmetic.
export async function suggestPorts(count = 3): Promise<PortSuggestion> {
  const wanted = Math.min(Math.max(Math.trunc(count) || 3, 1), 20)
  const listening = new Set(await readListeningPorts())
  const claimed = claimantsByPort()
  const result: PortSuggestion = {
    ports: [],
    skipped: { claimed: [], listening: [], reserved: [] }
  }
  for (let port = SUGGEST_FROM; port <= SUGGEST_TO && result.ports.length < wanted; port++) {
    if (RESERVED_PORTS.has(port)) {
      result.skipped.reserved.push(port)
      continue
    }
    if (claimed.has(port)) {
      result.skipped.claimed.push(port)
      continue
    }
    if (listening.has(port) || !(await isPortAvailable(port))) {
      result.skipped.listening.push(port)
      continue
    }
    result.ports.push(port)
  }
  return result
}

export async function checkPort(port: number, forProjectId?: number): Promise<PortCheck> {
  const valid = sanePort(port)
  if (valid === null) {
    return {
      port: Number.isFinite(Number(port)) ? Number(port) : 0,
      available: false,
      listening: false,
      claimedBy: null,
      reserved: false,
      reason: `A dev port must be a whole number between ${MIN_PORT} and ${MAX_PORT}.`
    }
  }

  const listening = (await readListeningPorts()).includes(valid)
  const claimants = claimantsByPort().get(valid) ?? []
  const claimedBy = claimants.length > 0 ? claimants.join(', ') : null
  const others = forProjectId === undefined ? claimants : projectsClaiming(valid, forProjectId)
  const reserved = RESERVED_PORTS.has(valid)

  if (reserved) {
    return {
      port: valid,
      available: false,
      listening,
      claimedBy,
      reserved,
      reason: `Port ${valid} belongs to Launchpad itself — pick another.`
    }
  }

  if (others.length > 0) {
    return {
      port: valid,
      available: false,
      listening,
      claimedBy,
      reserved,
      reason: `Port ${valid} is already claimed by ${quoteList(others)} — pick another.`
    }
  }

  if (listening) {
    return {
      port: valid,
      available: false,
      listening,
      claimedBy,
      reserved,
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
      reserved,
      reason: `Port ${valid} cannot be bound — the OS or another process is holding it.`
    }
  }

  return {
    port: valid,
    available: true,
    listening,
    claimedBy,
    reserved,
    reason: claimedBy
      ? `Port ${valid} is free, and this project already claims it.`
      : `Port ${valid} is free and unclaimed.`
  }
}

function quoteList(names: string[]): string {
  return names.map((name) => `"${name}"`).join(', ')
}

// ---- Overview ----

// Archived projects are hidden unless they claim a port, in which case they still have to
// show up — an invisible claim is exactly the sort of conflict this page exists to explain.
export async function buildPortOverview(): Promise<PortOverview> {
  const projects = listProjects()
  const byId = new Map(projects.map((project) => [project.id, project]))
  const listening = await readListeningPorts()
  const listeningSet = new Set(listening)
  const byPort = claimantsByPort()

  const claims: PortClaimRow[] = listAllPorts()
    .filter((claim) => byId.has(claim.projectId))
    .map((claim) => {
      const project = byId.get(claim.projectId)!
      return {
        ...claim,
        projectName: project.name,
        url: `http://localhost:${claim.port}`,
        listening: listeningSet.has(claim.port),
        reserved: RESERVED_PORTS.has(claim.port),
        conflictsWith: (byPort.get(claim.port) ?? []).filter((name) => name !== project.name)
      }
    })
    .sort((a, b) => a.port - b.port || a.projectName.localeCompare(b.projectName))

  const unclaimed = projects
    .filter((project) => project.status !== 'archived' && project.ports.length === 0)
    .map((project) => ({ projectId: project.id, name: project.name }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { claims, unclaimed, listening, suggested: (await suggestPorts(3)).ports }
}

// ---- Writes ----

export interface ClaimOptions {
  label?: string
  source?: string
  // Take a port another project already claims. Never overrides a reserved port: those are
  // taken by something outside Launchpad, so forcing one produces a claim that cannot work.
  force?: boolean
}

// The one gate every write goes through. Claiming used to be advisory — `checkPort` knew a
// port was reserved or taken, the caller printed the warning, and the claim was written
// anyway. That is how three projects ended up holding 3000.
function assertClaimable(project: Project, port: number, force: boolean): void {
  if (RESERVED_PORTS.has(port)) {
    throw new PortError(
      `Port ${port} belongs to Launchpad itself — pick another (launchpad ports free).`
    )
  }
  const others = projectsClaiming(port, project.id)
  if (others.length > 0 && !force) {
    throw new PortError(
      `Port ${port} is already claimed by ${quoteList(others)}. ` +
        `Run \`launchpad ports free\` for one that isn't, or pass --force if they really do share it.`,
      409
    )
  }
}

function requireProject(projectId: number): Project {
  const project = getProject(projectId)
  if (!project) throw new PortError('Project not found', 404)
  return project
}

function requirePort(port: unknown): number {
  const valid = sanePort(port)
  if (valid === null) {
    throw new PortError(
      `A dev port must be a whole number between ${MIN_PORT} and ${MAX_PORT} — got "${String(port)}".`
    )
  }
  return valid
}

// Add one port to a project's claims, leaving its other claims alone.
export async function claimPort(
  projectId: number,
  port: unknown,
  options: ClaimOptions = {}
): Promise<PortClaimResult> {
  const project = requireProject(projectId)
  const valid = requirePort(port)
  assertClaimable(project, valid, options.force === true)

  const claim = upsertPort({
    projectId,
    port: valid,
    label: options.label,
    source: options.source ?? 'manual'
  })

  // Worth saying, not worth refusing over: it may well be this project's own dev server
  // already running, and Launchpad has no way to tell whose socket it is.
  const others = projectsClaiming(valid, projectId)
  const listening = (await readListeningPorts(true)).includes(valid)
  const warning =
    others.length > 0
      ? `${quoteList(others)} also claims ${valid} — one of you has to move.`
      : listening
        ? `Something is already listening on ${valid}. If that isn't this project, pick another port.`
        : null

  return { project: getProject(projectId)!, claim, warning }
}

export function releasePort(projectId: number, port: unknown): Project {
  const project = requireProject(projectId)
  const valid = requirePort(port)
  if (!deletePort(projectId, valid)) {
    throw new PortError(`"${project.name}" does not claim port ${valid}.`, 404)
  }
  return getProject(projectId)!
}

export function releaseAllPorts(projectId: number): Project {
  requireProject(projectId)
  deleteAllPorts(projectId)
  return getProject(projectId)!
}

// Replace a project's whole set of claims with a single port — the old one-port-per-project
// behaviour, kept because `launchpad set port <n>` still means exactly that.
export async function setProjectPort(
  projectId: number,
  port: number | null,
  options: ClaimOptions = {}
): Promise<PortClaimResult | { project: Project; claim: null; warning: null }> {
  const project = requireProject(projectId)
  if (port === null) {
    deleteAllPorts(projectId)
    return { project: getProject(projectId)!, claim: null, warning: null }
  }
  const valid = requirePort(port)
  assertClaimable(project, valid, options.force === true)
  // Validated before anything is dropped, so a refused claim leaves the project as it was.
  deleteAllPorts(projectId)
  return claimPort(projectId, valid, options)
}

export function setPortOrder(projectId: number, ports: number[]): Project {
  requireProject(projectId)
  reorderPorts(projectId, ports)
  return getProject(projectId)!
}

export function setPortLabel(projectId: number, port: unknown, label: string): PortClaim {
  const project = requireProject(projectId)
  const valid = requirePort(port)
  const existing = findClaim(projectId, valid)
  if (!existing) throw new PortError(`"${project.name}" does not claim port ${valid}.`, 404)
  return upsertPort({ projectId, port: valid, label, source: existing.source })
}

// Read the project's own config and claim everything it declares that is actually
// claimable. A port the config names but Launchpad refuses (reserved, or held by another
// project) is reported rather than stored — silently recording it is what put three
// projects on 3000, each of them "detected" from its own launch.json.
export async function detectAndStorePorts(projectId: number): Promise<PortDetectResult> {
  const project = requireProject(projectId)
  if (!project.pathExists) {
    throw new PortError(`"${project.name}"'s folder is missing: ${project.path}`)
  }

  const detection = detectDevPorts(project.path)
  const claimed: PortClaim[] = []
  const skipped: PortDetectResult['skipped'] = []

  for (const port of detection.ports) {
    const source = detection.source ?? 'detected'
    try {
      assertClaimable(project, port, false)
      claimed.push(upsertPort({ projectId, port, source }))
    } catch (error) {
      skipped.push({
        port,
        source,
        reason: error instanceof PortError ? error.message : String(error)
      })
    }
  }

  return { project: getProject(projectId)!, claimed, skipped }
}
