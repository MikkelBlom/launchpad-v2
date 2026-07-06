import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { simpleGit } from 'simple-git'
import { normalizePath } from '../config.ts'
import type { GitInfo } from '../../shared/types.ts'
import {
  createProject,
  getProjectByPath,
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

// Marker file -> stack tag. First hit per tag wins.
const STACK_MARKERS: Array<{ tag: string; test: (entries: Set<string>) => boolean }> = [
  { tag: 'node', test: (e) => e.has('package.json') },
  { tag: 'python', test: (e) => e.has('requirements.txt') || e.has('pyproject.toml') || e.has('setup.py') },
  { tag: 'rust', test: (e) => e.has('cargo.toml') },
  { tag: 'go', test: (e) => e.has('go.mod') },
  { tag: 'dotnet', test: (e) => [...e].some((n) => n.endsWith('.csproj') || n.endsWith('.sln')) },
  { tag: 'java', test: (e) => e.has('pom.xml') || e.has('build.gradle') },
  { tag: 'ruby', test: (e) => e.has('gemfile') },
  { tag: 'php', test: (e) => e.has('composer.json') },
  { tag: 'docker', test: (e) => e.has('dockerfile') },
  { tag: 'web', test: (e) => e.has('index.html') }
]

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

function looksLikeProject(dir: string): boolean {
  const entries = lowerEntrySet(dir)
  if (entries.has('.git') || entries.has('ai-instructions')) return true
  return STACK_MARKERS.some((m) => m.test(entries))
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

export interface DiscoveryResult {
  added: string[]
  scanned: number
}

// Walk each configured root up to `maxDepth` deep, registering any new project
// folders found. Does not descend into a folder once it is recognised as a project.
export async function discoverProjects(maxDepth = 2): Promise<DiscoveryResult> {
  const roots = getSettings().projectRoots
  const added: string[] = []

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.toLowerCase())) continue
      const full = join(dir, entry)
      let isDir = false
      try {
        isDir = statSync(full).isDirectory()
      } catch {
        continue
      }
      if (!isDir) continue
      if (looksLikeProject(full)) {
        const normalized = normalizePath(full)
        if (!getProjectByPath(normalized)) {
          createProject({ name: basename(full), path: normalized })
          added.push(normalized)
        }
        // Do not descend into a recognised project.
        continue
      }
      walk(full, depth + 1)
    }
  }

  for (const root of roots) {
    if (existsSync(root)) walk(root, 1)
  }

  await scanAll()
  return { added, scanned: listProjects().length }
}
