import { getDb } from '../db/database.ts'
import type { Tag } from '../../shared/types.ts'

interface TagRow {
  id: number
  name: string
  color: string
}

export function listTags(): Tag[] {
  return getDb().prepare('SELECT * FROM tags ORDER BY name ASC').all() as unknown as Tag[]
}

export function getOrCreateTag(name: string, color = '#78716c'): Tag {
  const trimmed = name.trim()
  const existing = getDb()
    .prepare('SELECT * FROM tags WHERE name = ? COLLATE NOCASE')
    .get(trimmed) as TagRow | undefined
  if (existing) return existing
  const info = getDb().prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(trimmed, color)
  return { id: Number(info.lastInsertRowid), name: trimmed, color }
}

export function updateTag(id: number, patch: { name?: string; color?: string }): void {
  const fields: string[] = []
  const values: unknown[] = []
  if (patch.name !== undefined) {
    fields.push('name = ?')
    values.push(patch.name.trim())
  }
  if (patch.color !== undefined) {
    fields.push('color = ?')
    values.push(patch.color)
  }
  if (fields.length === 0) return
  values.push(id)
  getDb().prepare(`UPDATE tags SET ${fields.join(', ')} WHERE id = ?`).run(...(values as never[]))
}

export function deleteTag(id: number): void {
  getDb().prepare('DELETE FROM tags WHERE id = ?').run(id)
}

export function tagsForProject(projectId: number): Tag[] {
  return getDb()
    .prepare(
      `SELECT t.* FROM tags t
       JOIN project_tags pt ON pt.tag_id = t.id
       WHERE pt.project_id = ? ORDER BY t.name ASC`
    )
    .all(projectId) as unknown as Tag[]
}

// One query for all projects, grouped — avoids N+1 on the dashboard.
export function tagsByProject(): Map<number, Tag[]> {
  const rows = getDb()
    .prepare(
      `SELECT pt.project_id AS pid, t.id, t.name, t.color FROM project_tags pt
       JOIN tags t ON t.id = pt.tag_id ORDER BY t.name ASC`
    )
    .all() as unknown as Array<{ pid: number; id: number; name: string; color: string }>
  const map = new Map<number, Tag[]>()
  for (const row of rows) {
    const list = map.get(row.pid) ?? []
    list.push({ id: row.id, name: row.name, color: row.color })
    map.set(row.pid, list)
  }
  return map
}

export function addTagToProject(projectId: number, tagId: number): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)')
    .run(projectId, tagId)
}

export function removeTagFromProject(projectId: number, tagId: number): void {
  getDb()
    .prepare('DELETE FROM project_tags WHERE project_id = ? AND tag_id = ?')
    .run(projectId, tagId)
}
