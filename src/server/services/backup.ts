import { getDb } from '../db/database.ts'

// Full-database JSON backup/restore. Lets the user snapshot everything to a file and
// bring it back — no external tooling, no binary sqlite handling.

const TABLES = [
  'settings',
  'tags',
  'projects',
  'project_tags',
  'project_ports',
  'notes',
  'ideas',
  'tasks',
  'item_tags',
  'changes',
  'launch_profiles',
  'captures'
] as const

export interface BackupData {
  version: number
  exportedAt: string
  tables: Record<string, Array<Record<string, unknown>>>
}

export function exportAll(exportedAt: string): BackupData {
  const db = getDb()
  const tables: Record<string, Array<Record<string, unknown>>> = {}
  for (const table of TABLES) {
    tables[table] = db.prepare(`SELECT * FROM ${table}`).all() as unknown as Array<
      Record<string, unknown>
    >
  }
  // 4 — includes `project_ports`. Anything older carries a project's single port in the
  // legacy `projects.dev_port` columns instead; see importAll.
  return { version: 4, exportedAt, tables }
}

export function importAll(data: BackupData): { restored: Record<string, number> } {
  const db = getDb()
  if (!data?.tables) throw new Error('Invalid backup: missing tables')

  const restored: Record<string, number> = {}
  db.exec('PRAGMA foreign_keys = OFF')
  db.exec('BEGIN')
  try {
    // Clear in reverse dependency order.
    for (const table of [...TABLES].reverse()) {
      db.prepare(`DELETE FROM ${table}`).run()
    }
    // Insert in dependency order.
    for (const table of TABLES) {
      const rows = data.tables[table] ?? []
      restored[table] = rows.length
      for (const row of rows) {
        const cols = Object.keys(row)
        if (cols.length === 0) continue
        const placeholders = cols.map(() => '?').join(', ')
        db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`).run(
          ...(cols.map((c) => row[c]) as never[])
        )
      }
    }
    // A backup older than version 4 has no `project_ports` — it carries each project's
    // single port in the legacy columns instead. Without this the restore would look
    // successful and quietly leave every project portless. Gated on the backup's version,
    // not on the table being empty: a current backup of a database where every port was
    // deliberately released is also empty, and must stay that way.
    if ((data.version ?? 0) < 4) {
      const seeded = db
        .prepare(
          `INSERT INTO project_ports (project_id, port, label, source, sort, created_at)
           SELECT id, dev_port, '', COALESCE(NULLIF(dev_port_source, ''), 'manual'), 0, created_at
           FROM projects
           WHERE dev_port IS NOT NULL`
        )
        .run()
      restored.project_ports = Number(seeded.changes)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
  return { restored }
}
