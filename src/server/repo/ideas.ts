import { getDb, nowIso } from '../db/database.ts'
import type { Idea, IdeaStatus, Priority } from '../../shared/types.ts'

interface IdeaRow {
  id: number
  project_id: number
  title: string
  body: string
  priority: string
  status: string
  created_at: string
  updated_at: string
}

function mapRow(row: IdeaRow): Idea {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    body: row.body,
    priority: row.priority as Priority,
    status: row.status as IdeaStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listIdeas(projectId: number): Idea[] {
  const rows = getDb()
    .prepare('SELECT * FROM ideas WHERE project_id = ? ORDER BY updated_at DESC')
    .all(projectId) as unknown as IdeaRow[]
  return rows.map(mapRow)
}

export function createIdea(
  projectId: number,
  title: string,
  body: string,
  priority: Priority
): Idea {
  const now = nowIso()
  const info = getDb()
    .prepare(
      'INSERT INTO ideas (project_id, title, body, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(projectId, title, body, priority, now, now)
  return mapRow(
    getDb().prepare('SELECT * FROM ideas WHERE id = ?').get(Number(info.lastInsertRowid)) as unknown as IdeaRow
  )
}

export interface UpdateIdeaInput {
  title?: string
  body?: string
  priority?: Priority
  status?: IdeaStatus
}

export function updateIdea(id: number, patch: UpdateIdeaInput): Idea | null {
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
  values.push(id)
  getDb()
    .prepare(`UPDATE ideas SET ${fields.join(', ')} WHERE id = ?`)
    .run(...(values as never[]))
  const row = getDb().prepare('SELECT * FROM ideas WHERE id = ?').get(id) as unknown as IdeaRow | undefined
  return row ? mapRow(row) : null
}

export function deleteIdea(id: number): void {
  getDb().prepare('DELETE FROM ideas WHERE id = ?').run(id)
}
