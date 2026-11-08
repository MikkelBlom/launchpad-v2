// Import this FIRST in every server test file (before anything that touches the database).
// It points LAUNCHPAD_DATA_DIR at a fresh temp folder, so a test can never open or migrate
// Mikkel's live database in %APPDATA%\launchpad-v2. ESM evaluates imports in order, so a
// side-effect import on the first line runs before getDb() is ever reached.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'launchpad-test-'))
process.env.LAUNCHPAD_DATA_DIR = TEST_DATA_DIR
