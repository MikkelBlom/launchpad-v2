import { existsSync } from 'node:fs'
import { fromBool, getDb, nowIso, toBool } from '../db/database.ts'
import { tagsByProject, tagsForProject } from './tags.ts'
import type { GitActivity, GitInfo, Project, ProjectStatus, Tag } from '../../shared/types.ts'

interface ProjectRow {
  id: number
  name: string
  path: string
  description: string
  status: string
  is_favorite: number
  color: string | null
  stack: string
  git_has: number
  git_branch: string | null
  git_last_commit_at: string | null
  git_last_commit_message: string | null
  git_last_commit_hash: string | null
  git_dirty: number
  git_ahead: number
  git_behind: number
  git_remote_url: string | null
  last_scanned_at: string | null
  last_opened_at: string | null
  created_at: string
  live_url: string | null
  vercel_project_id: string | null
  note_count: number
  idea_count: number
  open_task_count: number
}

const DAY_MS = 24 * 60 * 60 * 1000

export function computeActivity(hasGit: boolean, lastCommitAt: string | null): GitActivity {
  if (!hasGit || !lastCommitAt) return 'unknown'
  const ageMs = Date.now() - new Date(lastCommitAt).getTime()
  if (!Number.isFinite(ageMs)) return 'unknown'
  const days = ageMs / DAY_MS
  if (days < 3) return 'fresh'
  if (days < 14) return 'recent'
  if (days < 60) return 'stalled'
  return 'dormant'
}

function parseStack(raw: string): string[] {
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) ? value.map(String) : []
  } catch {
    return []
  }
}

function mapRow(row: ProjectRow, tags: Tag[] = []): Project {
  const git: GitInfo = {
    hasGit: toBool(row.git_has),
    branch: row.git_branch,
    lastCommitAt: row.git_last_commit_at,
    lastCommitMessage: row.git_last_commit_message,
    lastCommitHash: row.git_last_commit_hash,
    dirty: toBool(row.git_dirty),
    ahead: row.git_ahead,
    behind: row.git_behind,
    remoteUrl: row.git_remote_url
  }
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    description: row.description,
    status: row.status as ProjectStatus,
    isFavorite: toBool(row.is_favorite),
    color: row.color,
    stack: parseStack(row.stack),
    git,
    activity: computeActivity(git.hasGit, git.lastCommitAt),
    lastScannedAt: row.last_scanned_at,
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
    counts: {
      notes: row.note_count,
      ideas: row.idea_count,
      openTasks: row.open_task_count
    },
    tags,
    liveUrl: row.live_url,
    vercelProjectId: row.vercel_project_id,
    pathExists: existsSync(row.path)
  }
}

// Counts mirror what the UI shows by default: archived items don't exist as far as the
// dashboard is concerned.
const SELECT = `
  SELECT p.*,
    (SELECT COUNT(*) FROM notes n WHERE n.project_id = p.id AND n.archived_at IS NULL) AS note_count,
    (SELECT COUNT(*) FROM ideas i WHERE i.project_id = p.id AND i.status = 'open') AS idea_count,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done' AND t.archived_at IS NULL) AS open_task_count
  FROM projects p
`

export function listProjects(): Project[] {
  const rows = getDb()
    .prepare(`${SELECT} ORDER BY p.is_favorite DESC, p.git_last_commit_at DESC, p.name ASC`)
    .all() as unknown as ProjectRow[]
  const tagMap = tagsByProject()
  return rows.map((row) => mapRow(row, tagMap.get(row.id) ?? []))
}

export function getProject(id: number): Project | null {
  const row = getDb().prepare(`${SELECT} WHERE p.id = ?`).get(id) as unknown as ProjectRow | undefined
  return row ? mapRow(row, tagsForProject(row.id)) : null
}

export function getProjectByPath(path: string): Project | null {
  const row = getDb().prepare(`${SELECT} WHERE p.path = ?`).get(path) as unknown as ProjectRow | undefined
  return row ? mapRow(row, tagsForProject(row.id)) : null
}

export interface CreateProjectInput {
  name: string
  path: string
  description?: string
  status?: ProjectStatus
}

export function createProject(input: CreateProjectInput): Project {
  const now = nowIso()
  const info = getDb()
    .prepare(
      `INSERT INTO projects (name, path, description, status, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      input.name,
      input.path,
      input.description ?? '',
      input.status ?? 'active',
      now
    )
  return getProject(Number(info.lastInsertRowid))!
}

export interface UpdateProjectInput {
  name?: string
  description?: string
  status?: ProjectStatus
  isFavorite?: boolean
  color?: string | null
  path?: string
  liveUrl?: string | null
  vercelProjectId?: string | null
}

export function updateProject(id: number, patch: UpdateProjectInput): Project | null {
  const fields: string[] = []
  const values: unknown[] = []
  if (patch.name !== undefined) {
    fields.push('name = ?')
    values.push(patch.name)
  }
  if (patch.description !== undefined) {
    fields.push('description = ?')
    values.push(patch.description)
  }
  if (patch.status !== undefined) {
    fields.push('status = ?')
    values.push(patch.status)
  }
  if (patch.isFavorite !== undefined) {
    fields.push('is_favorite = ?')
    values.push(fromBool(patch.isFavorite))
  }
  if (patch.color !== undefined) {
    fields.push('color = ?')
    values.push(patch.color)
  }
  if (patch.path !== undefined) {
    fields.push('path = ?')
    values.push(patch.path)
  }
  if (patch.liveUrl !== undefined) {
    fields.push('live_url = ?')
    values.push(patch.liveUrl)
  }
  if (patch.vercelProjectId !== undefined) {
    fields.push('vercel_project_id = ?')
    values.push(patch.vercelProjectId)
  }
  if (fields.length > 0) {
    values.push(id)
    getDb()
      .prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`)
      .run(...(values as never[]))
  }
  return getProject(id)
}

export function deleteProject(id: number): void {
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id)
}

export function touchOpened(id: number): void {
  getDb().prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?').run(nowIso(), id)
}

export function setScanResult(id: number, git: GitInfo, stack: string[]): void {
  getDb()
    .prepare(
      `UPDATE projects SET
        stack = ?, git_has = ?, git_branch = ?, git_last_commit_at = ?,
        git_last_commit_message = ?, git_last_commit_hash = ?, git_dirty = ?,
        git_ahead = ?, git_behind = ?, git_remote_url = ?, last_scanned_at = ?
       WHERE id = ?`
    )
    .run(
      JSON.stringify(stack),
      fromBool(git.hasGit),
      git.branch,
      git.lastCommitAt,
      git.lastCommitMessage,
      git.lastCommitHash,
      fromBool(git.dirty),
      git.ahead,
      git.behind,
      git.remoteUrl,
      nowIso(),
      id
    )
}
