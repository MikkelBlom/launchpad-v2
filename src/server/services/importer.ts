import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { normalizePath } from '../config.ts'
import { createProject, getProjectByPath } from '../repo/projects.ts'
import { getSettings } from '../repo/settings.ts'
import { scanProject } from './scanner.ts'
import { seedDefaultLaunchProfiles } from './launcher.ts'
import type { ProjectStatus } from '../../shared/types.ts'

interface OldProject {
  name: string
  path: string
  description?: string
  status?: string
  isFavorite?: boolean
}

export interface ImportResult {
  registrySource: string
  imported: Array<{ name: string; path: string }>
  relocated: Array<{ name: string; from: string; to: string }>
  skipped: Array<{ name: string; reason: string }>
  notFound: Array<{ name: string; path: string }>
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
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

function normalizeStatus(value: unknown): ProjectStatus {
  if (value === 'active' || value === 'idea' || value === 'on-hold' || value === 'done' || value === 'archived') {
    return value
  }
  return 'active'
}

function locateOldRegistry(explicitPath?: string): { projects: OldProject[]; source: string } {
  const candidates: string[] = []
  if (explicitPath) candidates.push(explicitPath)
  const appdata = process.env.APPDATA
  if (appdata) {
    candidates.push(join(appdata, 'Launchpad', 'config.json'))
    candidates.push(join(appdata, 'launchpad', 'config.json'))
  }

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf-8'))
      if (Array.isArray(parsed?.projects) && parsed.projects.length > 0) {
        return { projects: parsed.projects as OldProject[], source: candidate }
      }
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    'Could not find the old Launchpad registry (config.json in %APPDATA%\\Launchpad or %APPDATA%\\launchpad).'
  )
}

// Depth-limited search for a directory whose name matches (case-insensitive).
function findFolderByName(base: string, name: string, maxDepth: number): string | null {
  const target = name.trim().toLowerCase()
  const stack: Array<{ dir: string; depth: number }> = [{ dir: base, depth: 0 }]
  while (stack.length) {
    const { dir, depth } = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.toLowerCase())) continue
      const full = join(dir, entry)
      try {
        if (!statSync(full).isDirectory()) continue
      } catch {
        continue
      }
      if (entry.toLowerCase() === target) return full
      if (depth + 1 < maxDepth) stack.push({ dir: full, depth: depth + 1 })
    }
  }
  return null
}

// Resolve where an old project actually lives now:
// 1. its recorded path, if it still exists;
// 2. the same path with any OneDrive segment removed (user no longer uses OneDrive);
// 3. a folder with the same name found under the configured roots / Desktop.
function resolvePath(oldPath: string, name: string, searchBases: string[]): string | null {
  if (existsSync(oldPath)) return normalizePath(oldPath)

  const stripped = oldPath.replace(/OneDrive[\\/]+/i, '')
  if (stripped !== oldPath && existsSync(stripped)) return normalizePath(stripped)

  for (const base of searchBases) {
    if (!existsSync(base)) continue
    const found = findFolderByName(base, name, 3)
    if (found) return normalizePath(found)
  }
  return null
}

export async function importOldLaunchpad(explicitRegistryPath?: string): Promise<ImportResult> {
  const { projects, source } = locateOldRegistry(explicitRegistryPath)

  const searchBases = Array.from(
    new Set([...getSettings().projectRoots, join(homedir(), 'Desktop')])
  )

  const result: ImportResult = {
    registrySource: source,
    imported: [],
    relocated: [],
    skipped: [],
    notFound: []
  }

  for (const old of projects) {
    if (!old?.name || !old?.path) continue

    const existedAtOldPath = existsSync(old.path)
    const resolved = resolvePath(old.path, old.name, searchBases)

    if (!resolved) {
      result.notFound.push({ name: old.name, path: old.path })
      continue
    }

    if (getProjectByPath(resolved)) {
      result.skipped.push({ name: old.name, reason: 'already registered' })
      continue
    }

    const created = createProject({
      name: old.name,
      path: resolved,
      description: old.description ?? '',
      status: normalizeStatus(old.status)
    })
    await scanProject(created.id, resolved, created.description)
    seedDefaultLaunchProfiles(created.id)

    if (existedAtOldPath) {
      result.imported.push({ name: old.name, path: resolved })
    } else {
      result.relocated.push({ name: old.name, from: old.path, to: resolved })
    }
  }

  return result
}
