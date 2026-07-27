import { getDb, nowIso } from '../db/database.ts'
import { clearItemTags, tagsForItem, tagsForProjectItems } from './itemTags.ts'
import type { Idea, IdeaStatus, Priority, Provenance, Tag, WriteSource } from '../../shared/types.ts'

const UI: Provenance = { source: 'ui', actor: '' }

interface IdeaRow {
  id: number
  project_id: number
  title: string
  body: string
  priority: string
  status: string
  source: string
  updated_by: string
  created_at: string
  updated_at: string
}

function mapRow(row: IdeaRow, tags: Tag[] = []): Idea {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    body: row.body,
    priority: row.priority as Priority,
    status: row.status as IdeaStatus,
    source: row.source as WriteSource,
    updatedBy: row.updated_by,
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

// Ideas archive through their status rather than a timestamp column — the `archived`
// status predates the agent surface and the UI already filters on it.
export interface ListIdeasOptions {
  includeArchived?: boolean
}

export function listIdeas(projectId: number, options: ListIdeasOptions = {}): Idea[] {
  const clause = options.includeArchived ? '' : "AND status != 'archived'"
  const rows = getDb()
    .prepare(`SELECT * FROM ideas WHERE project_id = ? ${clause} ORDER BY updated_at DESC`)
    .all(projectId) as unknown as IdeaRow[]
  const tagMap = tagsForProjectItems('idea', projectId)
  return rows.map((row) => mapRow(row, tagMap.get(row.id) ?? []))
}

export function getIdea(id: number): Idea | null {
  const row = getDb().prepare('SELECT * FROM ideas WHERE id = ?').get(id) as unknown as
    | IdeaRow
    | undefined
  return row ? mapRow(row, tagsForItem('idea', row.id)) : null
}

export function createIdea(
  projectId: number,
  title: string,
  body: string,
  priority: Priority,
  provenance: Provenance = UI
): Idea {
  const now = nowIso()
  const info = getDb()
    .prepare(
      `INSERT INTO ideas (project_id, title, body, priority, source, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(projectId, title, body, priority, provenance.source, provenance.actor, now, now)
  return getIdea(Number(info.lastInsertRowid))!
}

export interface UpdateIdeaInput {
  title?: string
  body?: string
  priority?: Priority
  status?: IdeaStatus
}

export function updateIdea(
  id: number,
  patch: UpdateIdeaInput,
  provenance: Provenance = UI
): Idea | null {
  const fields: string[] = []
  const values: unknown[] = []
  for (const key of ['title', 'body', 'priority', 'status'] as const) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = ?`)
      values.push(patch[key])
    }
  }
  fields.push('updated_at = ?')
  values.push(nowIso())
  fields.push('source = ?')
  values.push(provenance.source)
  fields.push('updated_by = ?')
  values.push(provenance.actor)
  values.push(id)
  getDb()
    .prepare(`UPDATE ideas SET ${fields.join(', ')} WHERE id = ?`)
    .run(...(values as never[]))
  return getIdea(id)
}

export function deleteIdea(id: number): void {
  clearItemTags('idea', id)
  getDb().prepare('DELETE FROM ideas WHERE id = ?').run(id)
}
