import { fromBool, getDb, nowIso, toBool } from '../db/database.ts'
import type { Capture, CaptureKind } from '../../shared/types.ts'

interface CaptureRow {
  id: number
  project_id: number | null
  kind: string
  text: string
  url: string
  processed: number
  created_at: string
}

function mapRow(row: CaptureRow): Capture {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind as CaptureKind,
    text: row.text,
    url: row.url,
    processed: toBool(row.processed),
    createdAt: row.created_at
  }
}

export function listCaptures(includeProcessed = false): Capture[] {
  const sql = includeProcessed
    ? 'SELECT * FROM captures ORDER BY created_at DESC'
    : 'SELECT * FROM captures WHERE processed = 0 ORDER BY created_at DESC'
  return (getDb().prepare(sql).all() as unknown as CaptureRow[]).map(mapRow)
}

export interface CreateCaptureInput {
  projectId?: number | null
  kind?: CaptureKind
  text: string
  url?: string
}

export function createCapture(input: CreateCaptureInput): Capture {
  const info = getDb()
    .prepare(
      'INSERT INTO captures (project_id, kind, text, url, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(input.projectId ?? null, input.kind ?? 'note', input.text, input.url ?? '', nowIso())
  return mapRow(
    getDb()
      .prepare('SELECT * FROM captures WHERE id = ?')
      .get(Number(info.lastInsertRowid)) as unknown as CaptureRow
  )
}

export function setCaptureProcessed(id: number, processed: boolean): void {
  getDb().prepare('UPDATE captures SET processed = ? WHERE id = ?').run(fromBool(processed), id)
}

export function deleteCapture(id: number): void {
  getDb().prepare('DELETE FROM captures WHERE id = ?').run(id)
}
