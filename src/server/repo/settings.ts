import { getDb } from '../db/database.ts'
import type { AppSettings } from '../../shared/types.ts'

const DEFAULTS: AppSettings = {
  projectRoots: [],
  defaultEditor: 'code',
  githubUser: '',
  scanOnStartup: true,
  scanDepth: 2,
  excludeDirs: [],
  defaultSort: 'activity',
  groupByStatus: false,
  vercelToken: '',
  vercelTeamId: '',
  startAtLogin: true
}

function readRaw(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value
}

function writeRaw(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, value)
}

export function getSettings(): AppSettings {
  const result: AppSettings = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS) as Array<keyof AppSettings>) {
    const raw = readRaw(key)
    if (raw !== undefined) {
      try {
        ;(result as unknown as Record<string, unknown>)[key] = JSON.parse(raw)
      } catch {
        // keep default on parse failure
      }
    }
  }
  return result
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  for (const [key, value] of Object.entries(patch)) {
    if (key in DEFAULTS) {
      writeRaw(key, JSON.stringify(value))
    }
  }
  return getSettings()
}
