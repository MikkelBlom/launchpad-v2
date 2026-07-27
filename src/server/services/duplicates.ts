import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { getDb } from '../db/database.ts'
import { deleteProject } from '../repo/projects.ts'
import type { DuplicateGroup } from '../../shared/types.ts'

interface Row {
  id: number
  name: string
  path: string
  items: number
}

interface Entry extends Row {
  // Case-folded, separator-folded path with any trailing separator removed.
  key: string
  // Folder name and display name reduced to letters and digits.
  base: string
  slug: string
  exists: boolean
}

function pathKey(p: string): string {
  return p.replace(/[\\/]+/g, '\\').replace(/\\+$/, '').toLowerCase()
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function isAncestor(ancestorPath: string, childPath: string): boolean {
  const a = pathKey(ancestorPath)
  const c = pathKey(childPath)
  return c.startsWith(`${a}\\`)
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
    }
    prev = row
  }
  return prev[b.length]
}

// Deliberately conservative: two names count as "similar" only when one is the other plus
// a short tail ("solely" / "solely-app"), they share a stem of 5+ characters with short
// tails on both sides ("rover2" / "rover-game"), or they are within two edits of each
// other ("jeopardy" / "jeopardy2"). Anything looser starts collapsing genuinely different
// projects, so this rule is additionally gated on one of the two paths being gone.
function similarName(a: string, b: string): boolean {
  if (a.length < 4 || b.length < 4) return false
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (long.startsWith(short) && long.length - short.length <= 5) return true
  let stem = 0
  while (stem < short.length && short[stem] === long[stem]) stem++
  if (stem >= 5 && short.length - stem <= 5 && long.length - stem <= 5) return true
  return short.length >= 5 && levenshtein(a, b) <= 2
}

// Do these two registrations look like the same project? Returns null when they don't.
function relate(a: Entry, b: Entry): string | null {
  if (a.key === b.key) return 'duplicate path'
  if (isAncestor(a.path, b.path)) return `inside "${a.name}"`
  if (isAncestor(b.path, a.path)) return `contains "${a.name}"`
  if (a.base === b.base && a.base.length > 0) {
    if (a.exists !== b.exists) return 'same folder name; this path no longer exists'
    return a.exists ? 'same folder name, different location' : 'same folder name; neither path exists'
  }
  if (a.slug === b.slug && a.slug.length > 0) {
    return b.exists ? 'same project name' : 'same project name; this path no longer exists'
  }
  // Name-similarity alone is too weak to act on while both folders are still on disk —
  // two live folders are two live projects. A missing path is the stale-registration tell.
  if (a.exists && b.exists) return null
  if (similarName(a.slug, b.slug) || similarName(a.base, b.base)) {
    return b.exists ? 'similar name; the other path no longer exists' : 'similar name; this path no longer exists'
  }
  return null
}

function loadEntries(): Entry[] {
  const rows = getDb()
    .prepare(
      `SELECT p.id, p.name, p.path,
        (SELECT COUNT(*) FROM notes n WHERE n.project_id = p.id)
        + (SELECT COUNT(*) FROM ideas i WHERE i.project_id = p.id)
        + (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS items
       FROM projects p`
    )
    .all() as unknown as Row[]
  return rows.map((row) => ({
    ...row,
    key: pathKey(row.path),
    base: slugify(basename(row.path)),
    slug: slugify(row.name),
    exists: existsSync(row.path)
  }))
}

// Find registrations that are really the same project: one nested inside another, the same
// path stored twice under different casing, the same folder name in two places (typically a
// stale path from the old registry plus the real one), or near-identical names where one
// side's folder is gone. Related registrations are clustered, so a project caught by two
// rules still shows up once.
export function findDuplicates(): DuplicateGroup[] {
  const entries = loadEntries()
  const parent = new Map<number, number>(entries.map((e) => [e.id, e.id]))

  function find(id: number): number {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root)!
    let cursor = id
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!
      parent.set(cursor, root)
      cursor = next
    }
    return root
  }

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (!relate(entries[i], entries[j])) continue
      const a = find(entries[i].id)
      const b = find(entries[j].id)
      if (a !== b) parent.set(a, b)
    }
  }

  const clusters = new Map<number, Entry[]>()
  for (const entry of entries) {
    const root = find(entry.id)
    const cluster = clusters.get(root) ?? []
    cluster.push(entry)
    clusters.set(root, cluster)
  }

  const groups: DuplicateGroup[] = []
  for (const cluster of clusters.values()) {
    if (cluster.length < 2) continue
    const keeper = pickKeeper(cluster)
    groups.push({
      keeper: { id: keeper.id, name: keeper.name, path: keeper.path },
      nested: cluster
        .filter((e) => e.id !== keeper.id)
        .map((e) => ({
          id: e.id,
          name: e.name,
          path: e.path,
          reason: relate(keeper, e) ?? 'looks like the same project'
        }))
    })
  }
  return groups
}

// The registration worth keeping: one whose folder is actually there, then the one that
// contains the others (the scan/import nesting case), then the one carrying the most
// content, then the oldest.
function pickKeeper(cluster: Entry[]): Entry {
  const contains = new Map<number, number>()
  for (const entry of cluster) {
    contains.set(entry.id, cluster.filter((other) => isAncestor(entry.path, other.path)).length)
  }
  return [...cluster].sort((a, b) => {
    if (a.exists !== b.exists) return a.exists ? -1 : 1
    const byContains = contains.get(b.id)! - contains.get(a.id)!
    if (byContains !== 0) return byContains
    if (a.items !== b.items) return b.items - a.items
    return a.id - b.id
  })[0]
}

export interface MergeResult {
  merged: number
  keeperId: number
}

interface MergeRow {
  id: number
  path: string
  description: string
  color: string | null
  is_favorite: number
  live_url: string | null
  vercel_project_id: string | null
}

// Move every merge-away project's content into the keeper, then delete the registrations.
//
// Notes/ideas/tasks keep their own ids, so `item_tags` (keyed by item id, not project)
// follows them for free. `changes` has a plain `project_id` with no foreign key, so its
// rows have to be re-pointed by hand or the audit trail would dangle. `captures` would
// otherwise be orphaned by ON DELETE SET NULL.
export function mergeProjects(keeperId: number, mergeIds: number[]): MergeResult {
  const db = getDb()
  const ids = Array.from(new Set([keeperId, ...mergeIds]))
  const placeholders = ids.map(() => '?').join(', ')
  const rows = db
    .prepare(
      `SELECT id, path, description, color, is_favorite, live_url, vercel_project_id
       FROM projects WHERE id IN (${placeholders})`
    )
    .all(...(ids as never[])) as unknown as MergeRow[]

  const requested = rows.find((r) => r.id === keeperId)
  if (!requested) return { merged: 0, keeperId }

  // Never keep a registration whose folder is gone while a sibling's folder is still there.
  const keeper = existsSync(requested.path) ? requested : (rows.find((r) => existsSync(r.path)) ?? requested)
  const losers = rows.filter((r) => r.id !== keeper.id)
  if (losers.length === 0) return { merged: 0, keeperId: keeper.id }

  db.exec('BEGIN')
  try {
    for (const loser of losers) {
      for (const table of ['notes', 'ideas', 'tasks', 'captures', 'changes']) {
        db.prepare(`UPDATE ${table} SET project_id = ? WHERE project_id = ?`).run(keeper.id, loser.id)
      }
      // Launch profiles are mostly auto-seeded defaults, so only carry over the ones the
      // keeper doesn't already have — otherwise every merge doubles "Open in VS Code".
      db.prepare(
        `UPDATE launch_profiles SET project_id = ? WHERE project_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM launch_profiles k
             WHERE k.project_id = ? AND k.name = launch_profiles.name
               AND k.kind = launch_profiles.kind AND k.value = launch_profiles.value
           )`
      ).run(keeper.id, loser.id, keeper.id)
      db.prepare(
        'INSERT OR IGNORE INTO project_tags (project_id, tag_id) SELECT ?, tag_id FROM project_tags WHERE project_id = ?'
      ).run(keeper.id, loser.id)
      db.prepare('DELETE FROM project_tags WHERE project_id = ?').run(loser.id)

      // Fill in anything the keeper is missing rather than losing it with the row.
      if (!keeper.description.trim() && loser.description.trim()) {
        db.prepare('UPDATE projects SET description = ? WHERE id = ?').run(loser.description, keeper.id)
        keeper.description = loser.description
      }
      for (const column of ['color', 'live_url', 'vercel_project_id'] as const) {
        if (keeper[column] == null && loser[column] != null) {
          db.prepare(`UPDATE projects SET ${column} = ? WHERE id = ?`).run(loser[column], keeper.id)
          keeper[column] = loser[column]
        }
      }
      if (!keeper.is_favorite && loser.is_favorite) {
        db.prepare('UPDATE projects SET is_favorite = 1 WHERE id = ?').run(keeper.id)
        keeper.is_favorite = 1
      }
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  // Delete outside the manual transaction (deleteProject issues its own statement).
  let merged = 0
  for (const loser of losers) {
    deleteProject(loser.id)
    merged++
  }
  return { merged, keeperId: keeper.id }
}
