// Hygiene: a read-only report of what is lying around in a project that could be cleaned up —
// uncommitted work, unpushed commits, stale worktrees, merged branches, and big folders a tool
// can regenerate. Every finding carries a *suggested* command as text. Nothing here ever runs
// one, deletes a file, or writes to a repo: git is invoked with GIT_OPTIONAL_LOCKS=0 so even
// `git status` does not refresh the index behind the user's back.
//
// Everything is async and bounded (git timeouts, a directory-visit cap, a per-folder sizing
// budget), because the all-projects scan runs inside the same process that serves the UI.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { lstat, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { platform } from 'node:process'
import { normalizePath } from '../config.ts'
import { listProjects } from '../repo/projects.ts'
import type { HygieneFinding, HygieneOverview, Project, ProjectHygiene } from '../../shared/types.ts'

// Windows paths that differ only in case are the same folder.
const pathKey = (p: string): string => (platform === 'win32' ? normalizePath(p).toLowerCase() : normalizePath(p))

// A worktree whose last commit is older than this (and every other "is this old" question
// here) counts as stale. One constant so the definition lives in one place.
export const STALE_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

const GIT_TIMEOUT_MS = 15_000
const MAX_STATUS_STATS = 200 // changed files we stat to find the oldest edit
const MAX_LISTED = 5 // sample items (subjects, files) carried on a finding
// Regenerable folders are looked for at the project root and this many levels below it —
// enough for packages/<name>/node_modules in a monorepo.
const FOLDER_SEARCH_DEPTH = 3
const MAX_DIRS_VISITED = 3000 // directories listed while *looking* for folders (not sizing)
const MIN_REPORT_BYTES = 1024 * 1024 // a 40 KB __pycache__ is not worth a row

export interface SizeBudget {
  maxEntries: number // files + directories visited while sizing one folder
  maxMs: number // wall-clock time spent sizing one folder
}
export const DEFAULT_SIZE_BUDGET: SizeBudget = { maxEntries: 200_000, maxMs: 5_000 }

const SKIP_WHILE_SEARCHING = new Set(['.git', '.hg', '.svn', '.idea', '.vscode', '.vs'])

// Unambiguous: nobody commits these by hand.
const ALWAYS_REGENERABLE = new Set([
  'node_modules',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.angular',
  '.turbo',
  '.parcel-cache',
  '.vite',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.gradle'
])
// Ambiguous names: plenty of repos keep real source in a `build/` or `out/`. These only count
// when a build manifest sits next to them and git does not track anything inside.
const BUILD_OUTPUT = new Set(['dist', 'build', 'out', 'target', 'bin', 'obj', 'coverage', '.cache'])
const VENV_NAMES = new Set(['.venv', 'venv', 'env'])
const MANIFEST = /^(package\.json|cargo\.toml|pom\.xml|build\.gradle(\.kts)?|pyproject\.toml|setup\.py|go\.mod|.*\.(csproj|fsproj|vbproj|sln|slnx))$/i

// ---------------------------------------------------------------- git

interface GitError extends Error {
  timedOut?: boolean
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotePath=false', ...args],
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
      },
      (error, stdout) => {
        if (error) {
          const e = error as GitError & { killed?: boolean; signal?: string | null }
          e.timedOut = Boolean(e.killed && e.signal)
          reject(e)
          return
        }
        resolvePromise(stdout)
      }
    )
  })
}

async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await runGit(cwd, args)
  } catch {
    return null
  }
}

const lines = (text: string | null): string[] =>
  (text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

const plural = (n: number, word: string, many = `${word}s`): string => `${n} ${n === 1 ? word : many}`

function quote(p: string): string {
  return /[\s'"`$&()]/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p
}

function ageText(iso: string | null): string {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS)
  if (days <= 0) return 'today'
  return `${plural(days, 'day')} old`
}

// ---------------------------------------------------------------- uncommitted

// `status --porcelain=v1 -z`: `XY path\0`, renames/copies add `\0orig`.
export function parsePorcelain(out: string): Array<{ code: string; path: string }> {
  const tokens = out.split('\0')
  const entries: Array<{ code: string; path: string }> = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.length < 4) continue
    const code = t.slice(0, 2)
    entries.push({ code, path: t.slice(3) })
    if (code[0] === 'R' || code[0] === 'C') i++
  }
  return entries
}

async function uncommittedFinding(root: string): Promise<HygieneFinding | null> {
  const out = await runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=normal'])
  const entries = parsePorcelain(out)
  if (entries.length === 0) return null
  const untracked = entries.filter((e) => e.code === '??').length

  // The age is the oldest edit still sitting uncommitted. Deleted files have no mtime, and a
  // huge dirty tree is sampled rather than stat'ed in full.
  let oldest = Infinity
  const sample = entries.slice(0, MAX_STATUS_STATS)
  await Promise.all(
    sample.map(async (e) => {
      try {
        const s = await lstat(join(root, e.path))
        if (s.mtimeMs < oldest) oldest = s.mtimeMs
      } catch {
        /* deleted */
      }
    })
  )
  const since = Number.isFinite(oldest) ? new Date(oldest).toISOString() : null
  const tracked = entries.length - untracked
  const parts = [tracked ? `${tracked} changed` : '', untracked ? `${untracked} untracked` : ''].filter(Boolean)
  return {
    kind: 'uncommitted',
    title: `${plural(entries.length, 'uncommitted file')}${since ? `, oldest edit ${ageText(since)}` : ''}`,
    detail: `${parts.join(', ')}${entries.length > MAX_STATUS_STATS ? ` (age sampled from the first ${MAX_STATUS_STATS})` : ''}`,
    command: 'git add -A; git commit -m "<message>"',
    bytes: null,
    bytesExact: true,
    path: null,
    items: entries.slice(0, MAX_LISTED).map((e) => e.path),
    since
  }
}

// ---------------------------------------------------------------- unpushed

async function unpushedFindings(root: string, branch: string | null): Promise<HygieneFinding[]> {
  if (!branch) return [] // detached HEAD: nothing to push from
  const upstream = (await tryGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']))?.trim()
  if (upstream) {
    const count = Number((await tryGit(root, ['rev-list', '--count', '@{u}..HEAD']))?.trim()) || 0
    if (count === 0) return []
    const subjects = lines(await tryGit(root, ['log', `-n${MAX_LISTED}`, '--format=%s', '@{u}..HEAD']))
    return [
      {
        kind: 'unpushed',
        title: `${plural(count, 'commit')} ahead of ${upstream}`,
        detail: null,
        command: 'git push',
        bytes: null,
        bytesExact: true,
        path: null,
        items: subjects,
        since: null
      }
    ]
  }

  const remotes = lines(await tryGit(root, ['remote']))
  // Commits reachable from HEAD that no remote-tracking ref has: work that exists only here.
  const countArgs = remotes.length > 0 ? ['HEAD', '--not', '--remotes'] : ['HEAD']
  const count = Number((await tryGit(root, ['rev-list', '--count', ...countArgs]))?.trim()) || 0
  if (count === 0) return []
  const subjects = lines(await tryGit(root, ['log', `-n${MAX_LISTED}`, '--format=%s', ...countArgs]))
  if (remotes.length === 0) {
    return [
      {
        kind: 'no-remote',
        title: `No remote — ${plural(count, 'commit')} ${count === 1 ? 'exists' : 'exist'} only on this disk`,
        detail: 'This repository has no remote configured, so nothing in it is backed up.',
        command: 'git remote add origin <url>; git push -u origin ' + quote(branch),
        bytes: null,
        bytesExact: true,
        path: null,
        items: subjects,
        since: null
      }
    ]
  }
  const remote = remotes.includes('origin') ? 'origin' : remotes[0]
  return [
    {
      kind: 'unpushed',
      title: `Branch ${branch} has no upstream — ${plural(count, 'commit')} not on any remote`,
      detail: null,
      command: `git push -u ${remote} ${quote(branch)}`,
      bytes: null,
      bytesExact: true,
      path: null,
      items: subjects,
      since: null
    }
  ]
}

// ---------------------------------------------------------------- branches + worktrees

// origin/HEAD when the remote says, else a local main/master, else whatever is checked out.
async function defaultBranch(root: string, current: string | null): Promise<string | null> {
  const local = new Set(lines(await tryGit(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])))
  const originHead = (await tryGit(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']))?.trim()
  if (originHead) {
    const name = originHead.replace(/^origin\//, '')
    if (local.has(name)) return name
  }
  for (const name of ['main', 'master', 'trunk', 'develop']) if (local.has(name)) return name
  return current
}

export interface WorktreeEntry {
  path: string
  head: string | null
  branch: string | null
  bare: boolean
  detached: boolean
  locked: boolean
  prunable: boolean
}

export function parseWorktrees(out: string): WorktreeEntry[] {
  const result: WorktreeEntry[] = []
  for (const block of out.split(/\r?\n\r?\n/)) {
    const rows = lines(block)
    if (rows.length === 0) continue
    const entry: WorktreeEntry = {
      path: '',
      head: null,
      branch: null,
      bare: false,
      detached: false,
      locked: false,
      prunable: false
    }
    for (const row of rows) {
      const space = row.indexOf(' ')
      const key = space < 0 ? row : row.slice(0, space)
      const value = space < 0 ? '' : row.slice(space + 1)
      if (key === 'worktree') entry.path = value
      else if (key === 'HEAD') entry.head = value
      else if (key === 'branch') entry.branch = value.replace(/^refs\/heads\//, '')
      else if (key === 'bare') entry.bare = true
      else if (key === 'detached') entry.detached = true
      else if (key === 'locked') entry.locked = true
      else if (key === 'prunable') entry.prunable = true
    }
    if (entry.path) result.push(entry)
  }
  return result
}

async function branchAndWorktreeFindings(
  root: string,
  current: string | null
): Promise<{ findings: HygieneFinding[]; worktreeDirs: string[] }> {
  const findings: HygieneFinding[] = []
  const base = await defaultBranch(root, current)
  const merged = base
    ? new Set(lines(await tryGit(root, ['branch', '--merged', base, '--format=%(refname:short)'])))
    : new Set<string>()

  const worktrees = parseWorktrees((await tryGit(root, ['worktree', 'list', '--porcelain'])) ?? '')
  // The first entry is the main working tree; only linked worktrees can be stale.
  const linked = worktrees.slice(1).filter((w) => !w.bare)
  const checkedOut = new Set(worktrees.map((w) => w.branch).filter((b): b is string => Boolean(b)))
  const now = Date.now()

  for (const wt of linked) {
    const display = relativeOrAbsolute(root, wt.path)
    const missing = wt.prunable || !existsSync(wt.path)
    if (missing) {
      findings.push({
        kind: 'worktree',
        title: `Worktree ${display} is gone from disk`,
        detail: 'git still has it registered; pruning only removes the stale bookkeeping.',
        command: 'git worktree prune',
        bytes: null,
        bytesExact: true,
        path: display,
        items: wt.branch ? [wt.branch] : [],
        since: null
      })
      continue
    }
    const committedAt = wt.head ? Number((await tryGit(root, ['log', '-1', '--format=%ct', wt.head]))?.trim()) : NaN
    const since = Number.isFinite(committedAt) && committedAt > 0 ? new Date(committedAt * 1000).toISOString() : null
    const old = since !== null && now - committedAt * 1000 > STALE_DAYS * DAY_MS
    const isMerged = wt.branch !== null && wt.branch !== base && merged.has(wt.branch)
    if (!old && !isMerged) continue
    const reasons = [
      isMerged ? `branch ${wt.branch} is merged into ${base}` : '',
      old ? `last commit ${ageText(since)}` : ''
    ].filter(Boolean)
    const dirty = lines(await tryGit(wt.path, ['status', '--porcelain', '--untracked-files=normal'])).length
    findings.push({
      kind: 'worktree',
      title: `Stale worktree ${display}`,
      detail:
        reasons.join('; ') +
        (dirty ? ` — it has ${plural(dirty, 'uncommitted file')}, so \`git worktree remove\` will refuse until that is dealt with` : '') +
        (wt.locked ? ' — it is locked' : ''),
      command: `git worktree remove ${quote(wt.path)}`,
      bytes: null,
      bytesExact: true,
      path: display,
      items: wt.branch ? [wt.branch] : wt.detached ? ['(detached HEAD)'] : [],
      since
    })
  }

  // Branches checked out somewhere are left out: `git branch -d` refuses them, and a merged
  // worktree's branch is already reported with its worktree.
  const deletable = [...merged].filter((b) => b !== base && b !== current && !checkedOut.has(b)).sort()
  if (deletable.length > 0) {
    findings.push({
      kind: 'merged-branches',
      title: `${plural(deletable.length, 'local branch', 'local branches')} already merged into ${base}`,
      detail: '`git branch -d` only deletes a branch git agrees is fully merged.',
      command: `git branch -d ${deletable.map(quote).join(' ')}`,
      bytes: null,
      bytesExact: true,
      path: null,
      items: deletable.slice(0, 20),
      since: null
    })
  }
  return { findings, worktreeDirs: linked.map((w) => w.path) }
}

function relativeOrAbsolute(root: string, p: string): string {
  const rel = relative(root, resolve(p))
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : p
}

// ---------------------------------------------------------------- folder sizes

export interface FolderSize {
  bytes: number
  entries: number
  exact: boolean
}

// Sums file sizes under `dir` without following symlinks or junctions (pnpm's node_modules is
// made of junctions on Windows — following them would count the store, possibly forever).
// Stops at the budget and reports what it had, flagged inexact. Hard links (pnpm's store,
// again) are counted once per link, so a pnpm node_modules over-reports what deleting it frees.
export async function sizeFolder(dir: string, budget: SizeBudget = DEFAULT_SIZE_BUDGET): Promise<FolderSize> {
  const deadline = Date.now() + budget.maxMs
  let bytes = 0
  let entries = 0
  let active = 0
  let stopped = false
  const queue: string[] = [dir]
  const CONCURRENCY = 8
  const STAT_BATCH = 32

  const overBudget = (): boolean => entries >= budget.maxEntries || Date.now() >= deadline

  const sizeDir = async (current: string): Promise<void> => {
    let list
    try {
      list = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    const files: string[] = []
    for (const entry of list) {
      if (overBudget()) {
        stopped = true
        return
      }
      entries++
      if (entry.isSymbolicLink()) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) queue.push(full)
      else if (entry.isFile()) files.push(full)
    }
    for (let i = 0; i < files.length; i += STAT_BATCH) {
      const sizes = await Promise.all(
        files.slice(i, i + STAT_BATCH).map((f) =>
          lstat(f).then(
            (s) => s.size,
            () => 0
          )
        )
      )
      for (const s of sizes) bytes += s
    }
  }

  // Workers share one queue; one that finds it empty waits while others may still add to it.
  const worker = async (): Promise<void> => {
    for (;;) {
      if (overBudget()) {
        if (queue.length > 0 || active > 0) stopped = true
        return
      }
      const current = queue.pop()
      if (current === undefined) {
        if (active === 0) return
        await new Promise((r) => setImmediate(r))
        continue
      }
      active++
      try {
        await sizeDir(current)
      } finally {
        active--
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return { bytes, entries, exact: !stopped && queue.length === 0 }
}

interface Candidate {
  abs: string
  rel: string
  label: string
  ambiguous: boolean
}

// Breadth-first, never into .git, a found folder, a symlink/junction, a nested repository
// (worktrees under .claude/worktrees are scanned as their own thing), or another project.
async function findRegenerable(root: string, skip: Set<string>): Promise<Candidate[]> {
  const found: Candidate[] = []
  let frontier: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  let visited = 0
  while (frontier.length > 0 && visited < MAX_DIRS_VISITED) {
    const next: typeof frontier = []
    for (const { dir, depth } of frontier) {
      if (++visited > MAX_DIRS_VISITED) break
      let list
      try {
        list = await readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      const hasManifest = list.some((e) => e.isFile() && MANIFEST.test(e.name))
      for (const entry of list) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue
        const name = entry.name
        const full = join(dir, name)
        const lower = name.toLowerCase()
        if (SKIP_WHILE_SEARCHING.has(lower)) continue
        const rel = relative(root, full).split(sep).join('/')
        if (ALWAYS_REGENERABLE.has(lower)) {
          found.push({ abs: full, rel, label: name, ambiguous: false })
          continue
        }
        if (VENV_NAMES.has(lower)) {
          if (existsSync(join(full, 'pyvenv.cfg'))) {
            found.push({ abs: full, rel, label: `${name} (Python venv)`, ambiguous: false })
            continue
          }
        }
        if (BUILD_OUTPUT.has(lower) && hasManifest) {
          found.push({ abs: full, rel, label: name, ambiguous: true })
          continue
        }
        if (depth + 1 >= FOLDER_SEARCH_DEPTH) continue
        if (skip.has(pathKey(full))) continue
        if (existsSync(join(full, '.git'))) continue
        next.push({ dir: full, depth: depth + 1 })
      }
    }
    frontier = next
  }
  return found
}

function removeCommand(rel: string): string {
  return platform === 'win32' ? `Remove-Item -Recurse -Force ${quote(rel)}` : `rm -rf ${quote(rel)}`
}

async function regenerableFindings(
  root: string,
  hasGit: boolean,
  skip: Set<string>,
  budget: SizeBudget
): Promise<HygieneFinding[]> {
  const candidates = await findRegenerable(root, skip)
  const findings: HygieneFinding[] = []
  for (const c of candidates) {
    // `dist/` with tracked files in it is source, not output.
    if (c.ambiguous && hasGit) {
      const tracked = await tryGit(root, ['ls-files', '-z', '--', c.rel])
      if (tracked === null || tracked.length > 0) continue
    }
    const size = await sizeFolder(c.abs, budget)
    if (size.exact && size.bytes < MIN_REPORT_BYTES) continue
    findings.push({
      kind: 'regenerable',
      title: `${c.rel}${c.label !== c.rel.split('/').pop() ? ` — ${c.label}` : ''}`,
      detail: size.exact
        ? `${plural(size.entries, 'entry', 'entries')}; a reinstall or rebuild recreates it.`
        : `Sizing stopped after ${size.entries.toLocaleString()} entries — the real size is larger.`,
      command: removeCommand(c.rel),
      bytes: size.bytes,
      bytesExact: size.exact,
      path: c.rel,
      items: [],
      since: null
    })
  }
  return findings.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0))
}

// ---------------------------------------------------------------- one project

export interface ScanOptions {
  budget?: SizeBudget
  // Normalized paths of other registered projects — not descended into while looking for folders.
  skipPaths?: Set<string>
}

export async function scanHygiene(
  project: Pick<Project, 'id' | 'name' | 'path'>,
  options: ScanOptions = {}
): Promise<ProjectHygiene> {
  const started = Date.now()
  const root = project.path
  const result: ProjectHygiene = {
    projectId: project.id,
    name: project.name,
    path: root,
    scannedAt: new Date().toISOString(),
    durationMs: 0,
    hasGit: false,
    error: null,
    findings: [],
    reclaimableBytes: 0,
    reclaimableIsLowerBound: false
  }
  const errors: string[] = []
  try {
    if (!(await stat(root)).isDirectory()) throw new Error('not a folder')
  } catch {
    result.error = 'Project folder not found on disk'
    result.durationMs = Date.now() - started
    return result
  }

  const skip = new Set(options.skipPaths ?? [])
  skip.delete(pathKey(root))

  result.hasGit = existsSync(join(root, '.git'))
  if (result.hasGit) {
    const hasHead = (await tryGit(root, ['rev-parse', '--verify', '-q', 'HEAD'])) !== null
    const branch = (await tryGit(root, ['symbolic-ref', '--short', '-q', 'HEAD']))?.trim() || null
    try {
      const dirty = await uncommittedFinding(root)
      if (dirty) result.findings.push(dirty)
    } catch (e) {
      errors.push(`git status failed${(e as GitError).timedOut ? ' (timed out)' : ''}`)
    }
    if (hasHead) {
      result.findings.push(...(await unpushedFindings(root, branch)))
      const { findings, worktreeDirs } = await branchAndWorktreeFindings(root, branch)
      result.findings.push(...findings)
      for (const dir of worktreeDirs) skip.add(pathKey(dir))
    }
  }

  const folders = await regenerableFindings(root, result.hasGit, skip, options.budget ?? DEFAULT_SIZE_BUDGET)
  result.findings.push(...folders)
  result.reclaimableBytes = folders.reduce((n, f) => n + (f.bytes ?? 0), 0)
  result.reclaimableIsLowerBound = folders.some((f) => !f.bytesExact)
  result.error = errors.length ? errors.join('; ') : null
  result.durationMs = Date.now() - started
  return result
}

// ---------------------------------------------------------------- cache + all projects

// In memory only: a hygiene report is cheap to recompute and stale the moment someone runs
// `git push`, so it has no business in the database.
const CACHE_TTL_MS = 10 * 60 * 1000
const ALL_PROJECTS_CONCURRENCY = 3

const cache = new Map<number, ProjectHygiene>()
const inFlight = new Map<number, Promise<ProjectHygiene>>()
let fullScan: Promise<void> | null = null
let lastFullScanAt: string | null = null

function skipPathsFor(projects: Project[]): Set<string> {
  return new Set(projects.map((p) => pathKey(p.path)))
}

function scanCached(project: Project, skipPaths: Set<string>): Promise<ProjectHygiene> {
  const running = inFlight.get(project.id)
  if (running) return running
  const promise = scanHygiene(project, { skipPaths })
    .then((r) => {
      cache.set(project.id, r)
      return r
    })
    .finally(() => inFlight.delete(project.id))
  inFlight.set(project.id, promise)
  return promise
}

function isFresh(r: ProjectHygiene | undefined, path: string): r is ProjectHygiene {
  return Boolean(r && r.path === path && Date.now() - new Date(r.scannedAt).getTime() < CACHE_TTL_MS)
}

export async function getProjectHygiene(project: Project, refresh = false): Promise<ProjectHygiene> {
  const cached = cache.get(project.id)
  if (!refresh && isFresh(cached, project.path)) return cached
  return scanCached(project, skipPathsFor(listProjects()))
}

export function hygieneScore(a: ProjectHygiene, b: ProjectHygiene): number {
  return b.reclaimableBytes - a.reclaimableBytes || b.findings.length - a.findings.length || a.name.localeCompare(b.name)
}

async function refreshAll(projects: Project[], refresh: boolean): Promise<void> {
  const skipPaths = skipPathsFor(projects)
  const queue = projects.filter((p) => refresh || !isFresh(cache.get(p.id), p.path))
  const worker = async (): Promise<void> => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      try {
        await scanCached(p, skipPaths)
      } catch {
        /* scanHygiene records its own errors; a throw here is a bug we must not let stop the loop */
      }
    }
  }
  await Promise.all(Array.from({ length: ALL_PROJECTS_CONCURRENCY }, worker))
  lastFullScanAt = new Date().toISOString()
}

// Answers immediately from the cache and starts (at most one) background refresh when anything
// is missing or older than the TTL. The UI polls while `scanning` is true.
export function getHygieneOverview(refresh = false): HygieneOverview {
  const projects = listProjects().filter((p) => p.pathExists)
  const known = new Set(projects.map((p) => p.id))
  for (const id of cache.keys()) if (!known.has(id)) cache.delete(id)

  const needsWork = refresh || projects.some((p) => !isFresh(cache.get(p.id), p.path))
  if (needsWork && !fullScan) {
    fullScan = refreshAll(projects, refresh).finally(() => {
      fullScan = null
    })
  }
  const scanned = projects.map((p) => cache.get(p.id)).filter((r): r is ProjectHygiene => Boolean(r))
  return {
    scanning: fullScan !== null,
    pending: projects.length - scanned.length,
    lastFullScanAt,
    projects: scanned.sort(hygieneScore)
  }
}

// For tests: wait for the background refresh to finish.
export async function waitForHygieneScan(): Promise<void> {
  if (fullScan) await fullScan
}
