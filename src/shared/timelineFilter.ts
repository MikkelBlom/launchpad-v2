import type { Timeline } from './types.ts'

// Narrow a timeline to one author (by email, case-insensitive) and recompute every total, so
// the UI can filter without another round trip. Empty email = everyone.
export function filterTimelineByAuthor(t: Timeline, email: string): Timeline {
  const wanted = email.trim().toLowerCase()
  if (!wanted) return t
  const perProject = new Map<number, number[]>()
  const days = t.days.map((day, i) => {
    const projects = day.projects
      .map((p) => ({ ...p, commits: p.commits.filter((c) => c.authorEmail.toLowerCase() === wanted) }))
      .filter((p) => p.commits.length > 0)
    for (const p of projects) {
      const counts = perProject.get(p.projectId) ?? [0, 0, 0, 0, 0, 0, 0]
      counts[i] += p.commits.length
      perProject.set(p.projectId, counts)
    }
    return { ...day, projects, total: projects.reduce((n, p) => n + p.commits.length, 0) }
  })
  const projects = t.projects
    .filter((p) => perProject.has(p.projectId))
    .map((p) => {
      const perDay = perProject.get(p.projectId) as number[]
      return { ...p, perDay, total: perDay.reduce((a, b) => a + b, 0) }
    })
    .sort((a, b) => b.total - a.total || a.projectName.localeCompare(b.projectName))
  return { ...t, days, projects, total: days.reduce((n, d) => n + d.total, 0) }
}
