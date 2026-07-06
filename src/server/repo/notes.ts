import { fromBool, getDb, nowIso, toBool } from '../db/database.ts'
import type { Note } from '../../shared/types.ts'

interface NoteRow {
  id: number
  project_id: number
  title: string
  body: string
  pinned: number
  created_at: string
  updated_at: string
}

function mapRow(row: NoteRow): Note {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    body: row.body,
    pinned: toBool(row.pinned),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listNotes(projectId: number): Note[] {
  const rows = getDb()
    .prepare('SELECT * FROM notes WHERE project_id = ? ORDER BY pinned DESC, updated_at DESC')
    .all(projectId) as unknown as NoteRow[]
  return rows.map(mapRow)
}

export function createNote(projectId: number, title: string, body: string): Note {
  const now = nowIso()
  const info = getDb()
    .prepare(
      'INSERT INTO notes (project_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(projectId, title, body, now, now)
  return mapRow(
    getDb().prepare('SELECT * FROM notes WHERE id = ?').get(Number(info.lastInsertRowid)) as unknown as NoteRow
  )
}

export interface UpdateNoteInput {
  title?: string
  body?: string
  pinned?: boolean
}

export function updateNote(id: number, patch: UpdateNoteInput): Note | null {
  const fields: string[] = []
  const values: unknown[] = []
  if (patch.title !== undefined) {
    fields.push('title = ?')
    values.push(patch.title)
  }
  if (patch.body !== undefined) {
    fields.push('body = ?')
    values.push(patch.body)
  }
  if (patch.pinned !== undefined) {
    fields.push('pinned = ?')
    values.push(fromBool(patch.pinned))
  }
  fields.push('updated_at = ?')
  values.push(nowIso())
  values.push(id)
  getDb()
    .prepare(`UPDATE notes SET ${fields.join(', ')} WHERE id = ?`)
    .run(...(values as never[]))
  const row = getDb().prepare('SELECT * FROM notes WHERE id = ?').get(id) as unknown as NoteRow | undefined
  return row ? mapRow(row) : null
}

export function deleteNote(id: number): void {
  getDb().prepare('DELETE FROM notes WHERE id = ?').run(id)
}
