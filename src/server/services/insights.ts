import { getDb } from '../db/database.ts'
import { listProjects } from '../repo/projects.ts'
import type {
  ActivityItem,
  DashboardStats,
  GitActivity,
  ProjectStatus,
  SearchHit
} from '../../shared/types.ts'

export function getStats(): DashboardStats {
  const projects = listProjects()
  const byActivity: Record<GitActivity, number> = {
    fresh: 0,
    recent: 0,
    stalled: 0,
    dormant: 0,
    unknown: 0
  }
  const byStatus: Record<ProjectStatus, number> = {
    active: 0,
    idea: 0,
    'on-hold': 0,
    done: 0,
    archived: 0
  }
  let dirty = 0
  let stalledActive = 0
  let openTasks = 0
  let active = 0

  for (const p of projects) {
    byActivity[p.activity]++
    byStatus[p.status]++
    openTasks += p.counts.openTasks
    if (p.git.dirty) dirty++
    if (p.status === 'active') {
      active++
      if (p.activity === 'stalled' || p.activity === 'dormant') stalledActive++
    }
  }

  return {
    total: projects.length,
    active,
    dirty,
    stalledActive,
    openTasks,
    byActivity,
    byStatus
  }
}

function projectNameMap(): Map<number, string> {
  const rows = getDb().prepare('SELECT id, name FROM projects').all() as unknown as Array<{
    id: number
    name: string
  }>
  return new Map(rows.map((r) => [r.id, r.name]))
}

// A "what did I touch" feed derived from existing timestamps + git — no event log needed.
export function getActivity(limit = 40): ActivityItem[] {
  const names = projectNameMap()
  const items: ActivityItem[] = []

  const push = (kind: ActivityItem['kind'], pid: number, text: string, at: string | null) => {
    if (!at) return
    const name = names.get(pid)
    if (!name) return
    items.push({ kind, projectId: pid, projectName: name, text, at })
  }

  const tasks = getDb()
    .prepare('SELECT project_id, title, updated_at FROM tasks ORDER BY updated_at DESC LIMIT ?')
    .all(limit) as unknown as Array<{ project_id: number; title: string; updated_at: string }>
  for (const t of tasks) push('task', t.project_id, t.title, t.updated_at)

  const notes = getDb()
    .prepare('SELECT project_id, title, body, updated_at FROM notes ORDER BY updated_at DESC LIMIT ?')
    .all(limit) as unknown as Array<{ project_id: number; title: string; body: string; updated_at: string }>
  for (const n of notes) push('note', n.project_id, n.title || n.body.slice(0, 60), n.updated_at)

  const ideas = getDb()
    .prepare('SELECT project_id, title, updated_at FROM ideas ORDER BY updated_at DESC LIMIT ?')
    .all(limit) as unknown as Array<{ project_id: number; title: string; updated_at: string }>
  for (const i of ideas) push('idea', i.project_id, i.title, i.updated_at)

  const commits = getDb()
    .prepare(
      `SELECT id, git_last_commit_message AS msg, git_last_commit_at AS at
       FROM projects WHERE git_last_commit_at IS NOT NULL
       ORDER BY git_last_commit_at DESC LIMIT ?`
    )
    .all(limit) as unknown as Array<{ id: number; msg: string | null; at: string }>
  for (const c of commits) push('commit', c.id, c.msg ?? 'commit', c.at)

  return items
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit)
}

export function search(query: string): SearchHit[] {
  const q = query.trim()
  if (!q) return []
  const like = `%${q}%`
  const names = projectNameMap()
  const hits: SearchHit[] = []

  const projects = getDb()
    .prepare('SELECT id, name, description FROM projects WHERE name LIKE ? OR description LIKE ? LIMIT 20')
    .all(like, like) as unknown as Array<{ id: number; name: string; description: string }>
  for (const p of projects) {
    hits.push({ type: 'project', projectId: p.id, projectName: p.name, id: p.id, title: p.name, snippet: p.description.slice(0, 100) })
  }

  const tasks = getDb()
    .prepare('SELECT id, project_id, title FROM tasks WHERE title LIKE ? LIMIT 20')
    .all(like) as unknown as Array<{ id: number; project_id: number; title: string }>
  for (const t of tasks) {
    const name = names.get(t.project_id)
    if (name) hits.push({ type: 'task', projectId: t.project_id, projectName: name, id: t.id, title: t.title, snippet: '' })
  }

  const ideas = getDb()
    .prepare('SELECT id, project_id, title, body FROM ideas WHERE title LIKE ? OR body LIKE ? LIMIT 20')
    .all(like, like) as unknown as Array<{ id: number; project_id: number; title: string; body: string }>
  for (const i of ideas) {
    const name = names.get(i.project_id)
    if (name) hits.push({ type: 'idea', projectId: i.project_id, projectName: name, id: i.id, title: i.title, snippet: i.body.slice(0, 100) })
  }

  const notes = getDb()
    .prepare('SELECT id, project_id, title, body FROM notes WHERE title LIKE ? OR body LIKE ? LIMIT 20')
    .all(like, like) as unknown as Array<{ id: number; project_id: number; title: string; body: string }>
  for (const n of notes) {
    const name = names.get(n.project_id)
    if (name) hits.push({ type: 'note', projectId: n.project_id, projectName: name, id: n.id, title: n.title || 'Note', snippet: n.body.slice(0, 100) })
  }

  return hits
}
