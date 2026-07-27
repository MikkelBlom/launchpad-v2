import { getDb, nowIso } from '../db/database.ts'
import type { ChangeEntry, Provenance, WriteSource } from '../../shared/types.ts'

interface ChangeRow {
  id: number
  at: string
  source: string
  actor: string
  project_id: number | null
  entity_type: string
  entity_id: number | null
  action: string
  summary: string
}

function mapRow(row: ChangeRow): ChangeEntry {
  return {
    id: row.id,
    at: row.at,
    source: row.source as WriteSource,
    actor: row.actor,
    projectId: row.project_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    summary: row.summary
  }
}

export interface RecordChangeInput {
  provenance: Provenance
  projectId: number | null
  entityType: string
  entityId: number | null
  action: string
  summary?: string
}

// Best-effort audit trail: a failure here must never break the write it describes.
export function recordChange(input: RecordChangeInput): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO changes (at, source, actor, project_id, entity_type, entity_id, action, summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        nowIso(),
        input.provenance.source,
        input.provenance.actor,
        input.projectId,
        input.entityType,
        input.entityId,
        input.action,
        (input.summary ?? '').slice(0, 300)
      )
  } catch {
    /* the change log is a convenience, not a correctness requirement */
  }
}

export interface ListChangesInput {
  limit?: number
  projectId?: number
  source?: WriteSource
}

export function listChanges(input: ListChangesInput = {}): ChangeEntry[] {
  const where: string[] = []
  const values: unknown[] = []
  if (input.projectId !== undefined) {
    where.push('project_id = ?')
    values.push(input.projectId)
  }
  if (input.source !== undefined) {
    where.push('source = ?')
    values.push(input.source)
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  values.push(Math.min(Math.max(input.limit ?? 50, 1), 500))
  const rows = getDb()
    .prepare(`SELECT * FROM changes ${clause} ORDER BY id DESC LIMIT ?`)
    .all(...(values as never[])) as unknown as ChangeRow[]
  return rows.map(mapRow)
}
