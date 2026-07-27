import { fromBool, getDb, nowIso, toBool } from '../db/database.ts'
import { clearItemTags, tagsForItem, tagsForProjectItems } from './itemTags.ts'
import type { Note, Provenance, Tag, WriteSource } from '../../shared/types.ts'

const UI: Provenance = { source: 'ui', actor: '' }

interface NoteRow {
  id: number
  project_id: number
  title: string
  body: string
  pinned: number
  archived_at: string | null
  source: string
  updated_by: string
  created_at: string
  updated_at: string
}

function mapRow(row: NoteRow, tags: Tag[] = []): Note {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    body: row.body,
    pinned: toBool(row.pinned),
    archivedAt: row.archived_at,
    source: row.source as WriteSource,
    updatedBy: row.updated_by,
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export interface ListNotesOptions {
  includeArchived?: boolean
}

export function listNotes(projectId: number, options: ListNotesOptions = {}): Note[] {
  const clause = options.includeArchived ? '' : 'AND archived_at IS NULL'
  const rows = getDb()
    .prepare(
      `SELECT * FROM notes WHERE project_id = ? ${clause} ORDER BY pinned DESC, updated_at DESC`
    )
    .all(projectId) as unknown as NoteRow[]
  const tagMap = tagsForProjectItems('note', projectId)
  return rows.map((row) => mapRow(row, tagMap.get(row.id) ?? []))
}

export function getNote(id: number): Note | null {
  const row = getDb().prepare('SELECT * FROM notes WHERE id = ?').get(id) as unknown as
    | NoteRow
    | undefined
  return row ? mapRow(row, tagsForItem('note', row.id)) : null
}

export function createNote(
  projectId: number,
  title: string,
  body: string,
  provenance: Provenance = UI
): Note {
  const now = nowIso()
  const info = getDb()
    .prepare(
      `INSERT INTO notes (project_id, title, body, source, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(projectId, title, body, provenance.source, provenance.actor, now, now)
  return getNote(Number(info.lastInsertRowid))!
}

export interface UpdateNoteInput {
  title?: string
  body?: string
  pinned?: boolean
}

export function updateNote(
  id: number,
  patch: UpdateNoteInput,
  provenance: Provenance = UI
): Note | null {
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
  fields.push('source = ?')
  values.push(provenance.source)
  fields.push('updated_by = ?')
  values.push(provenance.actor)
  values.push(id)
  getDb()
    .prepare(`UPDATE notes SET ${fields.join(', ')} WHERE id = ?`)
    .run(...(values as never[]))
  return getNote(id)
}

export function archiveNote(id: number, archived: boolean, provenance: Provenance = UI): Note | null {
  getDb()
    .prepare('UPDATE notes SET archived_at = ?, updated_at = ?, source = ?, updated_by = ? WHERE id = ?')
    .run(archived ? nowIso() : null, nowIso(), provenance.source, provenance.actor, id)
  return getNote(id)
}

export function deleteNote(id: number): void {
  clearItemTags('note', id)
  getDb().prepare('DELETE FROM notes WHERE id = ?').run(id)
}
