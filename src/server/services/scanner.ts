import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { simpleGit } from 'simple-git'
import { normalizePath } from '../config.ts'
import { seedDefaultLaunchProfiles } from './launcher.ts'
import type { DiscoveryResult, GitInfo } from '../../shared/types.ts'
import {
  createProject,
  listProjects,
  setScanResult,
  updateProject
} from '../repo/projects.ts'
import { getSettings } from '../repo/settings.ts'

const EMPTY_GIT: GitInfo = {
  hasGit: false,
  branch: null,
  lastCommitAt: null,
  lastCommitMessage: null,
  lastCommitHash: null,
  dirty: false,
  ahead: 0,
  behind: 0,
  remoteUrl: null
}

// Directories that never contain a "project root" worth surfacing.
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

// A Visual Studio solution or project file, including the newer .slnx format that the
// old `.sln`-only check missed (which is why e.g. a folder holding only Foo.slnx was
// invisible to discovery).
const SOLUTION_FILE = /\.(sln|slnx|csproj|vbproj|fsproj|esproj|pyproj)$/

// Marker file -> stack tag. First hit per tag wins.
const STACK_MARKERS: Array<{ tag: string; test: (entries: Set<string>) => boolean }> = [
  { tag: 'node', test: (e) => e.has('package.json') },
  { tag: 'python', test: (e) => e.has('requirements.txt') || e.has('pyproject.toml') || e.has('setup.py') },
  { tag: 'rust', test: (e) => e.has('cargo.toml') },
  { tag: 'go', test: (e) => e.has('go.mod') },
  { tag: 'dotnet', test: (e) => [...e].some((n) => SOLUTION_FILE.test(n)) },
  { tag: 'java', test: (e) => e.has('pom.xml') || e.has('build.gradle') },
  { tag: 'ruby', test: (e) => e.has('gemfile') },
  { tag: 'php', test: (e) => e.has('composer.json') },
  { tag: 'docker', test: (e) => e.has('dockerfile') },
  // Game engines keep no manifest file at the top, just their own folder layout — without
  // these a Unity/Godot/Unreal project is invisible to discovery unless it has a repo.
  { tag: 'unity', test: (e) => e.has('assets') && e.has('projectsettings') },
  { tag: 'godot', test: (e) => e.has('project.godot') },
  { tag: 'unreal', test: (e) => [...e].some((n) => n.endsWith('.uproject')) },
  { tag: 'web', test: (e) => e.has('index.html') }
]

// Documents that only ever sit at the top of something someone considers a project.
const PROJECT_DOCS = new Set(['readme.md', 'readme.markdown', 'readme.txt', 'readme', 'claude.md', 'agents.md'])

const SOURCE_FILE =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|cs|java|go|rs|rb|php|c|cc|cpp|h|hpp|swift|kt|lua|sh|ps1|sql|vue|svelte|html|css|scss)$/

// Folder names that are almost always a part of a project rather than a project. The soft
// rules below are skipped for these so that scanning a repo never registers its own guts.
const NON_PROJECT_NAMES = new Set([
  'src', 'source', 'lib', 'libs', 'app', 'apps', 'packages', 'components', 'pages', 'public',
  'assets', 'images', 'img', 'styles', 'css', 'scripts', 'tools', 'test', 'tests', '__tests__',
  'docs', 'doc', 'documentation', 'examples', 'samples', 'server', 'client', 'web', 'api',
  'core', 'utils', 'util', 'helpers', 'models', 'views', 'controllers', 'services', 'config',
  'data', 'temp', 'tmp', 'backup', 'backups', 'archive', 'old', 'downloads', 'desktop'
])

const MIN_SOURCE_FILES = 4

function lowerEntrySet(dir: string): Set<string> {
  try {
    return new Set(readdirSync(dir).map((n) => n.toLowerCase()))
  } catch {
    return new Set()
  }
}

export function detectStack(projectPath: string): string[] {
  const entries = lowerEntrySet(projectPath)
  const tags: string[] = []
  for (const marker of STACK_MARKERS) {
    if (marker.test(entries)) tags.push(marker.tag)
  }
  return tags
}

// Is this folder a project?
//
// Hard signals (always accepted): a `.git` folder, an `ai-instructions` folder, or a stack
// manifest (package.json, pyproject.toml, a .sln/.slnx/.csproj, ...).
//
// Soft signals (accepted unless the folder is named like part of a bigger project — see
// NON_PROJECT_NAMES): a README/CLAUDE.md/AGENTS.md at the top, or at least
// MIN_SOURCE_FILES loose source files at the top. These exist because plenty of real
// projects are just a folder of code with no repo and no manifest, and the old
// marker-only rule made them permanently invisible to "Scan for projects".
export function looksLikeProject(dir: string, name = basename(dir)): boolean {
  const entries = lowerEntrySet(dir)
  if (entries.size === 0) return false
  if (entries.has('.git') || entries.has('ai-instructions')) return true
  if (STACK_MARKERS.some((m) => m.test(entries))) return true

  if (NON_PROJECT_NAMES.has(name.toLowerCase())) return false
  if ([...entries].some((n) => PROJECT_DOCS.has(n))) return true

  let sourceFiles = 0
  for (const entry of entries) {
    if (SOURCE_FILE.test(entry)) sourceFiles++
  }
  return sourceFiles >= MIN_SOURCE_FILES
}

export async function readGitInfo(projectPath: string): Promise<GitInfo> {
  if (!existsSync(join(projectPath, '.git'))) return { ...EMPTY_GIT }
  try {
    const git = simpleGit(projectPath)
    const status = await git.status()
    let lastCommitAt: string | null = null
    let lastCommitMessage: string | null = null
    let lastCommitHash: string | null = null
    try {
      const log = await git.log({ maxCount: 1 })
      if (log.latest) {
        const parsed = new Date(log.latest.date)
        lastCommitAt = Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
        lastCommitMessage = log.latest.message
        lastCommitHash = log.latest.hash
      }
    } catch {
      // repo with no commits yet
    }
    let remoteUrl: string | null = null
    try {
      const remotes = await git.getRemotes(true)
      const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0]
      remoteUrl = origin?.refs?.fetch ?? null
    } catch {
      // no remotes
    }
    return {
      hasGit: true,
      branch: status.current ?? null,
      lastCommitAt,
      lastCommitMessage,
      lastCommitHash,
      dirty: !status.isClean(),
      ahead: status.ahead ?? 0,
      behind: status.behind ?? 0,
      remoteUrl
    }
  } catch {
    return { ...EMPTY_GIT }
  }
}

export function readReadmeDescription(projectPath: string): string {
  let readmeName: string | undefined
  try {
    readmeName = readdirSync(projectPath).find((n) => n.toLowerCase() === 'readme.md')
  } catch {
    return ''
  }
  if (!readmeName) return ''
  let content = ''
  try {
    content = readFileSync(join(projectPath, readmeName), 'utf-8')
  } catch {
    return ''
  }
  const lines = content.split('\n')
  const paragraph: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      if (paragraph.length > 0) break
      continue
    }
    if (line.startsWith('#') || line.startsWith('![') || line.startsWith('<') || /^[-=]{3,}$/.test(line)) {
      continue
    }
    paragraph.push(line)
  }
  const text = paragraph
    .join(' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`>]/g, '')
    .trim()
  return text.length > 280 ? `${text.slice(0, 277)}...` : text
}

// Scan a single already-registered project and persist git + stack. Seeds the
// description from the README only when the user hasn't written one.
export async function scanProject(id: number, projectPath: string, currentDescription: string): Promise<void> {
  const [git, stack] = [await readGitInfo(projectPath), detectStack(projectPath)]
  setScanResult(id, git, stack)
  if (!currentDescription.trim()) {
    const description = readReadmeDescription(projectPath)
    if (description) updateProject(id, { description })
  }
}

export async function scanAll(): Promise<void> {
  for (const project of listProjects()) {
    if (existsSync(project.path)) {
      await scanProject(project.id, project.path, project.description)
    }
  }
}

type RootReport = DiscoveryResult['roots'][number]

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// Turn the counters into the one sentence the UI shows verbatim. A scan that finds
// nothing new must still say *why* — "no projects found" with no reason is what made this
// button look broken.
function describe(result: Omit<DiscoveryResult, 'message'>): string {
  if (result.roots.length === 0) return 'No project roots configured — add one in Settings.'

  const missing = result.roots.filter((r) => !r.exists)
  if (missing.length === result.roots.length) {
    return missing.length === 1
      ? `Root does not exist: ${missing[0].path}`
      : `None of the ${missing.length} configured roots exist: ${missing.map((r) => r.path).join(', ')}`
  }

  const live = result.roots.length - missing.length
  const parts: string[] = []
  if (result.scanned === 0) {
    parts.push(
      `Scanned ${plural(live, 'root')}, found no project folders — nothing there has a .git folder, ` +
        'a manifest (package.json, .sln, pyproject.toml, ...), or a README. Try raising the scan depth.'
    )
  } else {
    const names = result.added.map((p) => basename(p))
    const addedText =
      result.added.length > 0 && names.length <= 6
        ? `added ${result.added.length} (${names.join(', ')}).`
        : `added ${result.added.length}.`
    parts.push(
      `Scanned ${plural(live, 'root')}, found ${plural(result.scanned, 'project folder')}, ` +
        `${result.skippedExisting} already registered, ${addedText}`
    )
  }
  if (missing.length > 0) {
    const verb = missing.length === 1 ? 'does' : 'do'
    parts.push(`${plural(missing.length, 'root')} ${verb} not exist: ${missing.map((r) => r.path).join(', ')}`)
  }
  // Named, not just counted: the folder someone is looking for is the whole reason they
  // pressed Scan, and "1 folder was skipped" would send them hunting for which.
  const empty = result.skipped.filter((s) => s.kind === 'empty')
  const unrecognised = result.skipped.filter((s) => s.kind !== 'empty')
  // An empty folder under a project root is a project someone started making, so it leads —
  // it is the one entry here that comes with something to do about it.
  if (empty.length > 0) {
    const names = empty.map((s) => basename(s.path))
    parts.push(
      `${plural(empty.length, 'empty folder')} waiting to be initialised: ${names.join(', ')}.`
    )
  }
  if (unrecognised.length > 0) {
    const names = unrecognised.map((s) => basename(s.path))
    parts.push(
      names.length <= 4
        ? `Skipped ${names.join(', ')} — not a project folder.`
        : `Skipped ${unrecognised.length} folders that don't look like projects.`
    )
  }
  return parts.join(' ')
}

// Case- and separator-folded path, so a rescan recognises a folder Launchpad already
// knows about even when the two spellings differ (C:/x/y vs C:\X\Y\).
function pathKey(p: string): string {
  return p.replace(/[\\/]+/g, '\\').replace(/\\+$/, '').toLowerCase()
}

// Walk each configured root up to `maxDepth` deep, registering any new project folders
// found, and report what happened per root so the caller can explain a zero result.
//
// Rules worth knowing:
// - The root itself is tested first. A root that IS a project registers itself and is not
//   descended into (otherwise the soft rules would register its `src`/`server` folders).
// - A folder that is already registered counts as a project and is never descended into,
//   so a scan can't manufacture fresh nested duplicates underneath one.
// - Known paths are matched case-insensitively, so re-scanning can't create a second
//   registration that differs from the first only in casing.
export async function discoverProjects(): Promise<DiscoveryResult> {
  const settings = getSettings()
  const roots = settings.projectRoots
  const maxDepth = settings.scanDepth > 0 ? settings.scanDepth : 2
  const excludeSet = new Set(settings.excludeDirs.map((d) => d.toLowerCase()))

  const known = new Set(listProjects().map((p) => pathKey(p.path)))
  // Overlapping roots (one nested in another) would otherwise count the same folder twice.
  const seen = new Set<string>()
  const added: string[] = []
  const rootReports: RootReport[] = []
  const skipped: DiscoveryResult['skipped'] = []
  let scanned = 0
  let skippedExisting = 0

  // Only folders sitting directly under a root are worth reporting: those are the ones
  // someone creates and then expects to see. Everything deeper is the inside of a project.
  const MAX_SKIPPED = 25

  function whyNotAProject(dir: string): DiscoveryResult['skipped'][number] {
    const entries = lowerEntrySet(dir)
    if (entries.size === 0) {
      return { path: dir, kind: 'empty', reason: 'the folder is empty — nothing to detect yet' }
    }
    return {
      path: dir,
      kind: 'unrecognised',
      reason:
        'no .git, no manifest (package.json, .sln, pyproject.toml, …), no README, too few source files — and nothing inside it looks like a project either'
    }
  }

  function record(normalized: string, report: RootReport): void {
    const key = pathKey(normalized)
    if (seen.has(key)) return
    seen.add(key)
    scanned++
    report.candidates++
    if (known.has(key)) {
      skippedExisting++
      return
    }
    createProject({ name: basename(normalized), path: normalized })
    known.add(pathKey(normalized))
    added.push(normalized)
    report.added++
  }

  function walk(dir: string, depth: number, report: RootReport): void {
    if (depth > maxDepth) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const lower = entry.toLowerCase()
      if (SKIP_DIRS.has(lower) || excludeSet.has(lower)) continue
      const full = join(dir, entry)
      if (!isDirectory(full)) continue
      const normalized = normalizePath(full)
      if (known.has(pathKey(normalized)) || looksLikeProject(full, entry)) {
        record(normalized, report)
        // Do not descend into a recognised project.
        continue
      }
      // Walk first, then judge: a folder that is not itself a project but holds several
      // (`Unity Projects`, `Coding Pirates`) is a container, not something that was ignored.
      // Only a top-level folder that yielded nothing at all is worth reporting.
      const before = report.candidates
      walk(full, depth + 1, report)
      if (depth === 1 && report.candidates === before && skipped.length < MAX_SKIPPED) {
        skipped.push({ ...whyNotAProject(full), path: normalized })
      }
    }
  }

  for (const root of roots) {
    const report: RootReport = { path: root, exists: isDirectory(root), candidates: 0, added: 0 }
    rootReports.push(report)
    if (!report.exists) continue
    const normalizedRoot = normalizePath(root)
    if (known.has(pathKey(normalizedRoot)) || looksLikeProject(root)) {
      record(normalizedRoot, report)
      continue
    }
    walk(root, 1, report)
  }

  await scanAll()
  // Seed default launch profiles for any project that doesn't have them yet.
  for (const project of listProjects()) {
    seedDefaultLaunchProfiles(project.id)
  }

  const summary = { added, scanned, roots: rootReports, skippedExisting, skipped }
  return { ...summary, message: describe(summary) }
}
