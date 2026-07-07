import { DatabaseSync } from 'node:sqlite'
import { getDbPath } from '../config.ts'
import { runMigrations } from './schema.ts'

let instance: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (!instance) {
    instance = new DatabaseSync(getDbPath())
    // Rollback-journal mode (not WAL): every commit is written straight to the main db
    // file and fsync'd, so data survives the hard process kill the Electron shell uses on
    // quit. WAL's uncheckpointed-log complexity isn't worth it for a single-user app.
    instance.exec('PRAGMA journal_mode = DELETE;')
    instance.exec('PRAGMA synchronous = FULL;')
    instance.exec('PRAGMA foreign_keys = ON;')
    runMigrations(instance)
  }
  return instance
}

export function closeDb(): void {
  if (instance) {
    try {
      instance.close()
    } catch {
      /* already closed */
    }
    instance = null
  }
}

export function nowIso(): string {
  return new Date().toISOString()
}

// node:sqlite returns 1/0 for booleans and null-prototype rows; these helpers
// keep the repository layer readable.
export function toBool(value: unknown): boolean {
  return value === 1 || value === true || value === '1'
}

export function fromBool(value: boolean): number {
  return value ? 1 : 0
}
