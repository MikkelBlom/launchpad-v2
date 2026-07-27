import { basename } from 'node:path'
import { getProject, updateProject } from '../repo/projects.ts'
import { getSettings } from '../repo/settings.ts'
import type { Project, VercelProject } from '../../shared/types.ts'

// Everything in here is optional: Launchpad works fine with no Vercel token at all.
// Every failure path produces a sentence the user can act on rather than a raw fetch error.
export class VercelError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'VercelError'
    this.status = status
  }
}

const API_BASE = 'https://api.vercel.com'
const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_PAGES = 5

// One cache for the whole process: detecting across 30 projects must not mean 30 API calls.
// Keyed by token+team so changing either in Settings invalidates it immediately.
let cache: { key: string; at: number; projects: VercelProject[] } | null = null

// ---- Raw API shapes (only the fields we actually read) ----
interface RawLink {
  type?: string
  org?: string
  repo?: string
  owner?: string
  slug?: string
  projectNamespace?: string
  projectName?: string
}

interface RawDeployment {
  url?: string
  alias?: string[]
  createdAt?: number
}

interface RawProject {
  id?: string
  name?: string
  framework?: string | null
  updatedAt?: number
  link?: RawLink | null
  alias?: Array<{ domain?: string } | string>
  targets?: { production?: RawDeployment | null } | null
  latestDeployments?: RawDeployment[]
}

// Only http(s) URLs ever reach the shell-based opener, and quotes/newlines are rejected so a
// stored URL can never break out of the `start "" "<url>"` command line.
export function normalizeLiveUrl(value: string | null): string | null {
  const raw = (value ?? '').trim()
  if (!raw) return null
  if (/["\r\n]/.test(raw)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const parsed = new URL(withScheme)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

// Reduce a git remote (ssh or https, with or without .git) to `owner/repo`, lowercased —
// the form Vercel reports for a linked repository.
export function normalizeRepoPath(remote: string | null): string | null {
  const raw = (remote ?? '').trim()
  if (!raw) return null
  let value = raw
  const ssh = value.match(/^[^@\s]+@([^:]+):(.+)$/)
  if (ssh) value = `https://${ssh[1]}/${ssh[2]}`
  value = value
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
  const parts = value.split('/').filter(Boolean)
  if (parts.length < 3) return null
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`.toLowerCase()
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function linkedRepo(link: RawLink | null | undefined): string | null {
  if (!link) return null
  const owner = link.org ?? link.owner ?? link.projectNamespace
  const repo = link.repo ?? link.slug ?? link.projectName
  if (!owner || !repo) return null
  return `${owner}/${repo}`.toLowerCase()
}

// Collect every hostname Vercel tells us about, cheapest signal first.
function hostCandidates(raw: RawProject): string[] {
  const hosts: string[] = []
  const push = (value: unknown): void => {
    if (typeof value !== 'string') return
    const host = value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
    if (host && !/\s/.test(host)) hosts.push(host)
  }
  const fromDeployment = (deployment?: RawDeployment | null): void => {
    if (!deployment) return
    for (const alias of deployment.alias ?? []) push(alias)
    push(deployment.url)
  }
  fromDeployment(raw.targets?.production)
  for (const entry of raw.alias ?? []) push(typeof entry === 'string' ? entry : entry?.domain)
  for (const deployment of raw.latestDeployments ?? []) fromDeployment(deployment)
  return [...new Set(hosts)]
}

// Prefer a custom domain, then the shortest *.vercel.app (which is the clean production
// alias — preview aliases carry a branch/hash segment and are always longer).
function rankHost(host: string): number {
  const length = host.length / 1000
  if (host.endsWith('.vercel.sh')) return 3 + length
  if (host.endsWith('.vercel.app')) return 1 + length
  return length
}

function pickUrl(raw: RawProject): string | null {
  const hosts = hostCandidates(raw).sort((a, b) => rankHost(a) - rankHost(b))
  const best = hosts[0] ?? (raw.name ? `${raw.name}.vercel.app` : null)
  return best ? `https://${best}` : null
}

function mapProject(raw: RawProject): VercelProject | null {
  if (!raw?.id || !raw?.name) return null
  return {
    id: raw.id,
    name: raw.name,
    url: pickUrl(raw),
    framework: raw.framework ?? null,
    gitRepo: linkedRepo(raw.link),
    updatedAt:
      typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
        ? new Date(raw.updatedAt).toISOString()
        : null
  }
}

async function fetchPage(token: string, teamId: string, until?: number): Promise<{ projects: RawProject[]; next: number | null }> {
  const query = new URLSearchParams({ limit: '100' })
  if (teamId) query.set('teamId', teamId)
  if (until) query.set('until', String(until))

  let response: Response
  try {
    response = await fetch(`${API_BASE}/v9/projects?${query.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
  } catch (error) {
    throw new VercelError(
      `Could not reach the Vercel API (${error instanceof Error ? error.message : String(error)}). Check your internet connection.`,
      502
    )
  }

  if (response.status === 401 || response.status === 403) {
    throw new VercelError(
      'Vercel rejected the token. Check the personal access token in Settings — it may be wrong, expired, or missing access to the team.',
      401
    )
  }
  if (!response.ok) {
    let detail = ''
    try {
      const body = (await response.json()) as { error?: { message?: string } }
      detail = body?.error?.message ? ` — ${body.error.message}` : ''
    } catch {
      /* body was not JSON */
    }
    throw new VercelError(`Vercel API returned ${response.status}${detail}.`, 502)
  }

  const body = (await response.json()) as {
    projects?: RawProject[]
    pagination?: { next?: number | null }
  }
  return { projects: body.projects ?? [], next: body.pagination?.next ?? null }
}

// The user's Vercel projects, cached for a few minutes.
export async function listVercelProjects(force = false): Promise<VercelProject[]> {
  const settings = getSettings()
  const token = settings.vercelToken.trim()
  const teamId = settings.vercelTeamId.trim()
  if (!token) {
    throw new VercelError(
      'No Vercel token configured. Add a personal access token in Settings to connect your Vercel account (vercel.com → Account Settings → Tokens).'
    )
  }

  const key = `${token}::${teamId}`
  if (!force && cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.projects
  }

  const collected: VercelProject[] = []
  let until: number | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { projects, next } = await fetchPage(token, teamId, until)
    for (const raw of projects) {
      const mapped = mapProject(raw)
      if (mapped) collected.push(mapped)
    }
    if (!next) break
    until = next
  }

  cache = { key, at: Date.now(), projects: collected }
  return collected
}

export function clearVercelCache(): void {
  cache = null
}

// How strongly a Vercel project looks like this Launchpad project. The linked git repo is
// the only signal that survives the user renaming things, so it outranks everything else.
function scoreMatch(project: Project, candidate: VercelProject): { score: number; reason: string } {
  const projectRepo = normalizeRepoPath(project.git.remoteUrl)
  if (projectRepo && candidate.gitRepo) {
    if (projectRepo === candidate.gitRepo) return { score: 100, reason: 'same git repository' }
    const projectName = projectRepo.split('/')[1]
    const candidateName = candidate.gitRepo.split('/')[1]
    if (projectName && projectName === candidateName) {
      return { score: 70, reason: 'same repository name' }
    }
  }
  const wanted = normalizeName(candidate.name)
  if (!wanted) return { score: 0, reason: '' }
  if (wanted === normalizeName(project.name)) return { score: 60, reason: 'same project name' }
  if (wanted === normalizeName(basename(project.path))) return { score: 55, reason: 'same folder name' }
  const local = normalizeName(project.name)
  if (wanted.length >= 4 && local.length >= 4 && (wanted.includes(local) || local.includes(wanted))) {
    return { score: 30, reason: 'similar name' }
  }
  return { score: 0, reason: '' }
}

const MATCH_THRESHOLD = 30

export function matchVercelProject(project: Project, candidates: VercelProject[]): VercelProject | null {
  let best: VercelProject | null = null
  let bestScore = 0
  for (const candidate of candidates) {
    const { score } = scoreMatch(project, candidate)
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return bestScore >= MATCH_THRESHOLD ? best : null
}

export interface DetectResult {
  matched: VercelProject | null
  project: Project
}

// Try to work out which Vercel project this is and remember the answer. A live URL the user
// typed in by hand is never overwritten — detection only fills an empty one.
export async function detectVercelProject(projectId: number): Promise<DetectResult> {
  const project = getProject(projectId)
  if (!project) throw new VercelError('Project not found', 404)

  const candidates = await listVercelProjects()
  const matched = matchVercelProject(project, candidates)
  if (!matched) return { matched: null, project }

  const patch: { vercelProjectId: string; liveUrl?: string } = { vercelProjectId: matched.id }
  if (!project.liveUrl && matched.url) patch.liveUrl = matched.url
  const updated = updateProject(projectId, patch)
  return { matched, project: updated ?? project }
}

// Explicit link (or unlink when `vercelProjectId` is null). Linking is a deliberate act, so
// it does replace the live URL with the one Vercel reports.
export async function linkVercelProject(
  projectId: number,
  vercelProjectId: string | null
): Promise<Project> {
  const project = getProject(projectId)
  if (!project) throw new VercelError('Project not found', 404)

  if (!vercelProjectId) {
    return updateProject(projectId, { vercelProjectId: null }) ?? project
  }

  const candidates = await listVercelProjects()
  const target = candidates.find((candidate) => candidate.id === vercelProjectId)
  if (!target) {
    throw new VercelError('That Vercel project is no longer in your account.', 404)
  }
  return (
    updateProject(projectId, {
      vercelProjectId: target.id,
      liveUrl: target.url ?? project.liveUrl
    }) ?? project
  )
}
