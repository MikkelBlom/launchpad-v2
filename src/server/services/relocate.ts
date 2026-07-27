import { existsSync, readdirSync, renameSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { normalizePath } from '../config.ts'
import { getProject, getProjectByPath, updateProject } from '../repo/projects.ts'
import { getSettings } from '../repo/settings.ts'
import { readGitInfo, scanProject } from './scanner.ts'
import type { Project, RelocateCandidate } from '../../shared/types.ts'

// A project's display name and its folder on disk are separate columns on purpose: renaming
// in Launchpad never touches the filesystem. This service covers the other direction — the
// folder moved or was renamed outside Launchpad, or the user wants Launchpad to do the
// rename so the path and the folder can never drift apart.
export class RelocateError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'RelocateError'
    this.status = status
  }
}

// Mirrors the scanner's skip list — kept local so this service does not depend on the
// scanner's internals (only its exported `readGitInfo`).
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  'dist',
  'build',
  'out',
  '.next',
  '.venv',
  'venv',
  '__pycache__',
  '.idea',
  '.vscode',
  'target',
  'bin',
  'obj',
  '.cache'
])

const MAX_CANDIDATE_DIRS = 500
const MAX_GIT_READS = 80
const GIT_CONCURRENCY = 8
const MAX_RESULTS = 20

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

// Reduce a git remote (ssh or https) to `host/owner/repo` so two clones of the same repo
// compare equal regardless of transport.
function remoteIdentity(remote: string | null): string | null {
  const raw = (remote ?? '').trim()
  if (!raw) return null
  let value = raw
  const ssh = value.match(/^[^@\s]+@([^:]+):(.+)$/)
  if (ssh) value = `https://${ssh[1]}/${ssh[2]}`
  value = value
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
  return value.toLowerCase() || null
}

function bigrams(value: string): string[] {
  const grams: string[] = []
  for (let i = 0; i < value.length - 1; i += 1) grams.push(value.slice(i, i + 2))
  return grams
}

// Dice coefficient over character bigrams — cheap, deterministic, no dependency.
function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const left = bigrams(a)
  const right = bigrams(b)
  if (left.length === 0 || right.length === 0) return 0
  const pool = [...right]
  let hits = 0
  for (const gram of left) {
    const index = pool.indexOf(gram)
    if (index >= 0) {
      pool.splice(index, 1)
      hits += 1
    }
  }
  return (2 * hits) / (left.length + right.length)
}

async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

// Every directory under the configured roots that could plausibly be a project folder.
// Does not descend into a folder that is itself a git repo.
function collectDirectories(): string[] {
  const settings = getSettings()
  const maxDepth = settings.scanDepth > 0 ? settings.scanDepth : 2
  const excludeSet = new Set(settings.excludeDirs.map((d) => d.toLowerCase()))
  const found: string[] = []

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth || found.length >= MAX_CANDIDATE_DIRS) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= MAX_CANDIDATE_DIRS) return
      const lower = entry.toLowerCase()
      if (SKIP_DIRS.has(lower) || excludeSet.has(lower)) continue
      const full = join(dir, entry)
      try {
        if (!statSync(full).isDirectory()) continue
      } catch {
        continue
      }
      found.push(normalizePath(full))
      // A git repo is a leaf as far as relocation goes.
      if (existsSync(join(full, '.git'))) continue
      walk(full, depth + 1)
    }
  }

  for (const root of settings.projectRoots) {
    if (existsSync(root)) walk(root, 1)
  }
  return found
}

// Folders under the configured roots that plausibly are this project, best first.
export async function findRelocateCandidates(projectId: number): Promise<RelocateCandidate[]> {
  const project = getProject(projectId)
  if (!project) throw new RelocateError('Project not found', 404)

  const oldBase = basename(project.path)
  const oldBaseKey = normalizeName(oldBase)
  const nameKey = normalizeName(project.name)
  const wantedRemote = remoteIdentity(project.git.remoteUrl)

  const directories = collectDirectories().filter((dir) => {
    if (dir === normalizePath(project.path)) return false
    const owner = getProjectByPath(dir)
    // Already registered to a different project — relocating here would be rejected anyway.
    return !owner || owner.id === projectId
  })

  // Reading git is the strongest signal but the most expensive, so it is bounded.
  const gitDirs = wantedRemote
    ? directories.filter((dir) => existsSync(join(dir, '.git'))).slice(0, MAX_GIT_READS)
    : []
  const remotes = new Map<string, string | null>()
  if (gitDirs.length > 0) {
    const infos = await mapWithLimit(gitDirs, GIT_CONCURRENCY, (dir) => readGitInfo(dir))
    gitDirs.forEach((dir, index) => remotes.set(dir, remoteIdentity(infos[index].remoteUrl)))
  }

  const candidates: RelocateCandidate[] = []
  for (const dir of directories) {
    const dirName = basename(dir)
    const dirKey = normalizeName(dirName)
    const reasons: string[] = []
    let score = 0

    if (wantedRemote && remotes.get(dir) === wantedRemote) {
      score += 100
      reasons.push('same git remote')
    }
    if (dirKey && dirKey === oldBaseKey) {
      score += 55
      reasons.push(`folder is still called "${oldBase}"`)
    } else {
      const best = Math.max(similarity(dirKey, oldBaseKey), similarity(dirKey, nameKey))
      if (best >= 0.5) {
        score += Math.round(best * 40)
        reasons.push(`name looks like "${project.name}"`)
      }
    }

    if (score > 0) {
      candidates.push({ path: dir, name: dirName, score, reason: reasons.join(' · ') })
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  return candidates.slice(0, MAX_RESULTS)
}

// "I renamed/moved it myself, here is where it went."
export async function relocateProject(projectId: number, rawPath: string): Promise<Project> {
  const project = getProject(projectId)
  if (!project) throw new RelocateError('Project not found', 404)

  const trimmed = (rawPath ?? '').trim()
  if (!trimmed) throw new RelocateError('A folder path is required.')

  const path = normalizePath(trimmed)
  if (!existsSync(path)) throw new RelocateError(`Nothing exists at ${path}.`)
  try {
    if (!statSync(path).isDirectory()) throw new RelocateError(`${path} is a file, not a folder.`)
  } catch (error) {
    if (error instanceof RelocateError) throw error
    throw new RelocateError(`Could not read ${path}.`)
  }

  const owner = getProjectByPath(path)
  if (owner && owner.id !== projectId) {
    throw new RelocateError(`"${owner.name}" is already registered at that path.`, 409)
  }

  const updated = updateProject(projectId, { path })
  if (!updated) throw new RelocateError('Project not found', 404)
  await scanProject(projectId, path, updated.description)
  return getProject(projectId) ?? updated
}

// Windows filename rules — everything here would either fail at the syscall or silently
// produce a folder the user cannot open.
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/
const RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
])

function assertValidFolderName(folderName: string): string {
  const name = (folderName ?? '').trim()
  if (!name) throw new RelocateError('A folder name is required.')
  if (name === '.' || name === '..') throw new RelocateError('That is not a usable folder name.')
  if (INVALID_CHARS.test(name)) {
    throw new RelocateError(
      'A folder name cannot contain \\ / : * ? " < > | — this renames the folder in place, it does not move it.'
    )
  }
  if (name.endsWith('.') || name.endsWith(' ')) {
    throw new RelocateError('Windows will not accept a folder name ending in a dot or a space.')
  }
  if (RESERVED_NAMES.has(name.toLowerCase())) {
    throw new RelocateError(`"${name}" is a reserved Windows device name.`)
  }
  if (name.length > 100) throw new RelocateError('That folder name is too long.')
  return name
}

// The safe version of what the user was worried about: rename the directory on disk AND the
// stored path in one operation, so the two can never drift apart.
export async function renameProjectFolder(projectId: number, folderName: string): Promise<Project> {
  const project = getProject(projectId)
  if (!project) throw new RelocateError('Project not found', 404)

  const name = assertValidFolderName(folderName)
  const from = normalizePath(project.path)
  if (!existsSync(from)) {
    throw new RelocateError(
      `The folder ${from} no longer exists, so there is nothing to rename. Point Launchpad at its new location first.`
    )
  }
  const to = normalizePath(join(dirname(from), name))
  if (to === from) throw new RelocateError('That is already the folder name.')
  if (existsSync(to)) throw new RelocateError(`A folder named "${name}" already exists next to it.`, 409)

  const owner = getProjectByPath(to)
  if (owner && owner.id !== projectId) {
    throw new RelocateError(`"${owner.name}" is already registered at that path.`, 409)
  }

  try {
    renameSync(from, to)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      throw new RelocateError(
        `Windows refused to rename the folder because something has it open — this is almost always an editor, a terminal sitting in that folder, or a running dev server. Close those and try again. (${code})`,
        423
      )
    }
    throw new RelocateError(
      `Could not rename the folder: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  let updated: Project | null
  try {
    updated = updateProject(projectId, { path: to })
  } catch (error) {
    // Never leave the row pointing at a folder that no longer exists.
    try {
      renameSync(to, from)
    } catch {
      /* the rename-back failed too; the error below is the useful one */
    }
    throw new RelocateError(
      `Renamed the folder but could not update Launchpad, so it was rolled back: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (!updated) throw new RelocateError('Project not found', 404)

  await scanProject(projectId, to, updated.description)
  return getProject(projectId) ?? updated
}
