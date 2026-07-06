import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Canonicalise a filesystem path so stored project paths and incoming CLI cwd values
// compare equal regardless of separator style or relative segments.
export function normalizePath(p: string): string {
  return resolve(p)
}

// Default localhost port. 3000/3001/5000 are taken on this machine, so we use 7420.
export const DEFAULT_PORT = 7420

export function getDataDir(): string {
  const override = process.env.LAUNCHPAD_DATA_DIR
  const base = override ?? process.env.APPDATA ?? join(homedir(), '.config')
  const dir = override ?? join(base, 'launchpad-v2')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getDbPath(): string {
  return join(getDataDir(), 'launchpad.sqlite')
}

export function getPort(): number {
  const fromEnv = process.env.LAUNCHPAD_PORT
  if (fromEnv && Number.isFinite(Number(fromEnv))) {
    return Number(fromEnv)
  }
  return DEFAULT_PORT
}

// Location of the built web assets (dist/web), served in production by Fastify.
export function getWebDistDir(): string {
  return fileURLToPath(new URL('../../dist/web', import.meta.url))
}
