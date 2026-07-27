import { getDb } from '../db/database.ts'

// Full-database JSON backup/restore. Lets the user snapshot everything to a file and
// bring it back — no external tooling, no binary sqlite handling.

const TABLES = [
  'settings',
  'tags',
  'projects',
  'project_tags',
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
  return { version: 3, exportedAt, tables }
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
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
  return { restored }
}
