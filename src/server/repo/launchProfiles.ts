import { getDb } from '../db/database.ts'
import type { LaunchKind, LaunchProfile } from '../../shared/types.ts'

interface LaunchRow {
  id: number
  project_id: number
  name: string
  kind: string
  value: string
  cwd: string
  sort: number
}

function mapRow(row: LaunchRow): LaunchProfile {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    kind: row.kind as LaunchKind,
    value: row.value,
    cwd: row.cwd,
    sort: row.sort
  }
}

export function listLaunchProfiles(projectId: number): LaunchProfile[] {
  return (
    getDb()
      .prepare('SELECT * FROM launch_profiles WHERE project_id = ? ORDER BY sort ASC, id ASC')
      .all(projectId) as unknown as LaunchRow[]
  ).map(mapRow)
}

export function getLaunchProfile(id: number): LaunchProfile | null {
  const row = getDb().prepare('SELECT * FROM launch_profiles WHERE id = ?').get(id) as
    | LaunchRow
    | undefined
  return row ? mapRow(row) : null
}

export interface CreateLaunchInput {
  projectId: number
  name: string
  kind: LaunchKind
  value: string
  cwd?: string
}

export function createLaunchProfile(input: CreateLaunchInput): LaunchProfile {
  const maxSort = getDb()
    .prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM launch_profiles WHERE project_id = ?')
    .get(input.projectId) as { m: number }
  const info = getDb()
    .prepare(
      'INSERT INTO launch_profiles (project_id, name, kind, value, cwd, sort) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(input.projectId, input.name, input.kind, input.value, input.cwd ?? '', maxSort.m + 1)
  return getLaunchProfile(Number(info.lastInsertRowid))!
}

export interface UpdateLaunchInput {
  name?: string
  kind?: LaunchKind
  value?: string
  cwd?: string
  sort?: number
}

export function updateLaunchProfile(id: number, patch: UpdateLaunchInput): LaunchProfile | null {
  const fields: string[] = []
  const values: unknown[] = []
  for (const key of ['name', 'kind', 'value', 'cwd', 'sort'] as const) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = ?`)
      values.push(patch[key])
    }
  }
  if (fields.length > 0) {
    values.push(id)
    getDb()
      .prepare(`UPDATE launch_profiles SET ${fields.join(', ')} WHERE id = ?`)
      .run(...(values as never[]))
  }
  return getLaunchProfile(id)
}

export function deleteLaunchProfile(id: number): void {
  getDb().prepare('DELETE FROM launch_profiles WHERE id = ?').run(id)
}
