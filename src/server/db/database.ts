import { DatabaseSync } from 'node:sqlite'
import { getDbPath } from '../config.ts'
import { runMigrations } from './schema.ts'

let instance: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (!instance) {
    instance = new DatabaseSync(getDbPath())
    instance.exec('PRAGMA journal_mode = WAL;')
    instance.exec('PRAGMA foreign_keys = ON;')
    runMigrations(instance)
  }
  return instance
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
