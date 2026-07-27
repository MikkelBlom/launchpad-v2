import { getDb } from '../db/database.ts'
import { deleteProject } from '../repo/projects.ts'
import type { DuplicateGroup } from '../../shared/types.ts'

interface Row {
  id: number
  name: string
  path: string
}

function isAncestor(ancestorPath: string, childPath: string): boolean {
  const a = ancestorPath.toLowerCase().replace(/[\\/]+$/, '')
  const c = childPath.toLowerCase()
  return c.startsWith(`${a}\\`) || c.startsWith(`${a}/`)
}

// Find projects that are registered inside another registered project's folder —
// the scan/import overlap that produces e.g. both "Solely" and "Solely/solely-app".
export function findDuplicates(): DuplicateGroup[] {
  const rows = getDb().prepare('SELECT id, name, path FROM projects').all() as unknown as Row[]
  const groups = new Map<number, DuplicateGroup>()

  for (const child of rows) {
    // Closest ancestor (longest matching path) becomes the keeper.
    let keeper: Row | null = null
    for (const candidate of rows) {
      if (candidate.id === child.id) continue
      if (isAncestor(candidate.path, child.path)) {
        if (!keeper || candidate.path.length > keeper.path.length) keeper = candidate
      }
    }
    if (!keeper) continue
    const group = groups.get(keeper.id) ?? {
      keeper: { id: keeper.id, name: keeper.name, path: keeper.path },
      nested: []
    }
    group.nested.push({ id: child.id, name: child.name, path: child.path })
    groups.set(keeper.id, group)
  }

  return Array.from(groups.values())
}

// Move a nested project's content into the keeper, then delete the nested registration.
export function mergeProjects(keeperId: number, nestedIds: number[]): { merged: number } {
  const db = getDb()
  db.exec('BEGIN')
  try {
    for (const nestedId of nestedIds) {
      if (nestedId === keeperId) continue
      for (const table of ['notes', 'ideas', 'tasks', 'launch_profiles']) {
        db.prepare(`UPDATE ${table} SET project_id = ? WHERE project_id = ?`).run(keeperId, nestedId)
      }
      db.prepare(
        'INSERT OR IGNORE INTO project_tags (project_id, tag_id) SELECT ?, tag_id FROM project_tags WHERE project_id = ?'
      ).run(keeperId, nestedId)
      db.prepare('DELETE FROM project_tags WHERE project_id = ?').run(nestedId)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  // Delete outside the manual transaction (deleteProject issues its own statement).
  let merged = 0
  for (const nestedId of nestedIds) {
    if (nestedId === keeperId) continue
    deleteProject(nestedId)
    merged++
  }
  return { merged }
}
