import { getDb, nowIso } from '../db/database.ts'
import type { PortClaim } from '../../shared/types.ts'

// Data access for `project_ports` — the localhost ports each project claims. Whether a
// claim is *allowed* is decided in services/ports.ts; this file only stores what it is told.

interface PortRow {
  id: number
  project_id: number
  port: number
  label: string
  source: string
  sort: number
}

function mapRow(row: PortRow): PortClaim {
  return {
    id: row.id,
    projectId: row.project_id,
    port: row.port,
    label: row.label,
    source: row.source,
    sort: row.sort
  }
}

// Ordered the way the UI reads them: the project's own ordering first, then by port so a
// project whose claims were all made in one go still lists them predictably.
const ORDER = 'ORDER BY sort ASC, port ASC'

export function listAllPorts(): PortClaim[] {
  return (getDb().prepare(`SELECT * FROM project_ports ${ORDER}`).all() as unknown as PortRow[]).map(
    mapRow
  )
}

// Every project's claims in one query — mapRow runs on every project list, so this must not
// become one statement per project.
export function portsByProject(): Map<number, PortClaim[]> {
  const byProject = new Map<number, PortClaim[]>()
  for (const claim of listAllPorts()) {
    byProject.set(claim.projectId, [...(byProject.get(claim.projectId) ?? []), claim])
  }
  return byProject
}

export function portsForProject(projectId: number): PortClaim[] {
  return (
    getDb()
      .prepare(`SELECT * FROM project_ports WHERE project_id = ? ${ORDER}`)
      .all(projectId) as unknown as PortRow[]
  ).map(mapRow)
}

// Everyone claiming a port, in one lookup for the whole database.
export function claimsByPort(): Map<number, PortClaim[]> {
  const byPort = new Map<number, PortClaim[]>()
  for (const claim of listAllPorts()) {
    byPort.set(claim.port, [...(byPort.get(claim.port) ?? []), claim])
  }
  return byPort
}

export function findClaim(projectId: number, port: number): PortClaim | null {
  const row = getDb()
    .prepare('SELECT * FROM project_ports WHERE project_id = ? AND port = ?')
    .get(projectId, port) as unknown as PortRow | undefined
  return row ? mapRow(row) : null
}

export interface UpsertPortInput {
  projectId: number
  port: number
  label?: string
  source?: string
}

// Claiming the same port twice is a no-op that refreshes the label and source rather than an
// error — an agent re-running its setup should be able to say the same thing twice.
export function upsertPort(input: UpsertPortInput): PortClaim {
  const db = getDb()
  const existing = findClaim(input.projectId, input.port)
  if (existing) {
    db.prepare('UPDATE project_ports SET label = ?, source = ? WHERE id = ?').run(
      input.label ?? existing.label,
      input.source ?? existing.source,
      existing.id
    )
    return findClaim(input.projectId, input.port)!
  }
  const next =
    (
      db
        .prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM project_ports WHERE project_id = ?')
        .get(input.projectId) as unknown as { next: number }
    ).next ?? 0
  db.prepare(
    `INSERT INTO project_ports (project_id, port, label, source, sort, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(input.projectId, input.port, input.label ?? '', input.source ?? 'manual', next, nowIso())
  return findClaim(input.projectId, input.port)!
}

export function deletePort(projectId: number, port: number): boolean {
  const info = getDb()
    .prepare('DELETE FROM project_ports WHERE project_id = ? AND port = ?')
    .run(projectId, port)
  return Number(info.changes) > 0
}

export function deleteAllPorts(projectId: number): number {
  return Number(getDb().prepare('DELETE FROM project_ports WHERE project_id = ?').run(projectId).changes)
}

// Reorder a project's claims. Ports not named keep their relative order after the named ones,
// so a caller that only wants to promote one port doesn't have to send the whole list.
export function reorderPorts(projectId: number, ports: number[]): PortClaim[] {
  const db = getDb()
  const current = portsForProject(projectId)
  const wanted = ports.filter((port) => current.some((claim) => claim.port === port))
  const rest = current.filter((claim) => !wanted.includes(claim.port)).map((claim) => claim.port)
  const update = db.prepare('UPDATE project_ports SET sort = ? WHERE project_id = ? AND port = ?')
  ;[...wanted, ...rest].forEach((port, index) => update.run(index, projectId, port))
  return portsForProject(projectId)
}
