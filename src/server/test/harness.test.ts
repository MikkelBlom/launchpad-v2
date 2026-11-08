import { TEST_DATA_DIR } from './tempDataDir.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getDbPath } from '../config.ts'
import { getDb } from '../db/database.ts'

test('tests run against a temp database, never the live one', () => {
  assert.ok(getDbPath().startsWith(TEST_DATA_DIR))
  const row = getDb().prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string }
  assert.ok(Number(row.value) >= 6)
})
