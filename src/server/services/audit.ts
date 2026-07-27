import { existsSync } from 'node:fs'
import { getDb } from '../db/database.ts'
import { getProject, listProjects } from '../repo/projects.ts'
import type { AuditIssue, Project, ProjectAudit } from '../../shared/types.ts'

// How many live items of each kind carry no tags at all — the "things missing tags" an
// agent is asked to fill in.
function untaggedCount(projectId: number): number {
  const row = getDb()
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = ? AND t.archived_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM item_tags it WHERE it.item_type = 'task' AND it.item_id = t.id)) +
        (SELECT COUNT(*) FROM ideas i WHERE i.project_id = ? AND i.status != 'archived'
           AND NOT EXISTS (SELECT 1 FROM item_tags it WHERE it.item_type = 'idea' AND it.item_id = i.id)) +
        (SELECT COUNT(*) FROM notes n WHERE n.project_id = ? AND n.archived_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM item_tags it WHERE it.item_type = 'note' AND it.item_id = n.id))
       AS c`
    )
    .get(projectId, projectId, projectId) as { c: number }
  return row.c
}

function issuesFor(project: Project): AuditIssue[] {
  const issues: AuditIssue[] = []
  const skipContent = project.status === 'archived' || project.status === 'done'

  if (!existsSync(project.path)) {
    issues.push({ code: 'missing-path', detail: `Folder does not exist: ${project.path}` })
  }
  if (!project.description.trim()) {
    issues.push({ code: 'no-description', detail: 'No description — write one from the README/code' })
  }
  if (project.tags.length === 0) {
    issues.push({ code: 'no-tags', detail: 'No tags — classify by stack, domain, or client' })
  }
  if (!skipContent && project.counts.openTasks === 0) {
    issues.push({ code: 'no-tasks', detail: 'No open tasks — capture what is actually left to do' })
  }
  if (!skipContent && project.counts.notes === 0) {
    issues.push({ code: 'no-notes', detail: 'No notes — record context worth keeping' })
  }

  const untagged = untaggedCount(project.id)
  if (untagged > 0) {
    issues.push({ code: 'untagged-items', detail: `${untagged} item(s) with no tags` })
  }
  if (project.status === 'active' && (project.activity === 'stalled' || project.activity === 'dormant')) {
    issues.push({
      code: 'stalled',
      detail: `Marked active but ${project.activity} — confirm the status is still right`
    })
  }
  if (project.git.dirty) {
    issues.push({ code: 'uncommitted', detail: 'Uncommitted changes in the working tree' })
  }
  return issues
}

function toAudit(project: Project): ProjectAudit {
  return {
    projectId: project.id,
    name: project.name,
    path: project.path,
    status: project.status,
    issues: issuesFor(project)
  }
}

export function auditProject(projectId: number): ProjectAudit | null {
  const project = getProject(projectId)
  return project ? toAudit(project) : null
}

// Every project that still needs work, worst first — the agent's queue.
export function auditAll(): ProjectAudit[] {
  return listProjects()
    .map(toAudit)
    .filter((a) => a.issues.length > 0)
    .sort((a, b) => b.issues.length - a.issues.length)
}
