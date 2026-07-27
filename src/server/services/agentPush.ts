import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDataDir } from '../config.ts'
import { getDb, nowIso } from '../db/database.ts'
import { getProject, updateProject, type UpdateProjectInput } from '../repo/projects.ts'
import { createNote, listNotes, updateNote } from '../repo/notes.ts'
import { createIdea, listIdeas, updateIdea } from '../repo/ideas.ts'
import { createTask, listTasks, updateTask } from '../repo/tasks.ts'
import { addTagToProject, getOrCreateTag, removeTagFromProject } from '../repo/tags.ts'
import { setItemTags } from '../repo/itemTags.ts'
import { recordChange } from '../repo/changes.ts'
import { exportAll } from './backup.ts'
import type {
  Idea,
  IdeaStatus,
  Note,
  Priority,
  ProjectStatus,
  Provenance,
  PushChange,
  PushPlan,
  PushResult,
  Task,
  TaskStatus
} from '../../shared/types.ts'

const PRIORITIES: Priority[] = ['high', 'medium', 'low']
const TASK_STATUSES: TaskStatus[] = ['todo', 'doing', 'done']
const IDEA_STATUSES: IdeaStatus[] = ['open', 'promoted', 'archived']
const PROJECT_STATUSES: ProjectStatus[] = ['active', 'idea', 'on-hold', 'done', 'archived']

// Items are matched on a normalized title so re-running the same plan updates rather than
// duplicates. Agents retry; without this a second run doubles every task.
function key(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ')
}

function fallbackTitle(item: { title?: string; body?: string }): string {
  const title = (item.title ?? '').trim()
  if (title) return title
  return (item.body ?? '').trim().slice(0, 80)
}

class PlanError extends Error {}

function checkEnum<T extends string>(value: unknown, allowed: T[], field: string): T | undefined {
  if (value === undefined || value === null) return undefined
  if (!allowed.includes(value as T)) {
    throw new PlanError(`Invalid ${field} "${String(value)}" — expected one of: ${allowed.join(', ')}`)
  }
  return value as T
}

function writePreBackup(): string | null {
  try {
    const dir = join(getDataDir(), 'backups')
    mkdirSync(dir, { recursive: true })
    const stamp = nowIso().replace(/[:.]/g, '-')
    const file = join(dir, `pre-push-${stamp}.json`)
    writeFileSync(file, JSON.stringify(exportAll(nowIso())), 'utf-8')
    return file
  } catch {
    return null
  }
}

interface Existing<T> {
  byId: Map<number, T>
  byKey: Map<string, T>
  archivedKeys: Set<string>
}

function index<T extends { id: number; title: string; body: string }>(
  live: T[],
  archived: T[]
): Existing<T> {
  const byId = new Map<number, T>()
  const byKey = new Map<string, T>()
  for (const item of live) {
    byId.set(item.id, item)
    const k = key(fallbackTitle(item))
    if (k && !byKey.has(k)) byKey.set(k, item)
  }
  const archivedKeys = new Set<string>()
  for (const item of archived) {
    byId.set(item.id, item)
    const k = key(fallbackTitle(item))
    if (k) archivedKeys.add(k)
  }
  return { byId, byKey, archivedKeys }
}

/**
 * Apply an agent-authored plan to a project.
 *
 * Merge-only by design: it creates and updates, never deletes or archives. A field absent
 * from the plan is left alone, so a partial plan can't wipe existing content.
 *
 * `dryRun` runs the identical code path inside a transaction that is rolled back, so the
 * preview can never drift from what a real apply would do.
 */
export function applyPush(
  projectId: number,
  plan: PushPlan,
  provenance: Provenance,
  options: { dryRun?: boolean } = {}
): PushResult {
  const project = getProject(projectId)
  if (!project) throw new PlanError(`No project with id ${projectId}`)

  const dryRun = options.dryRun === true
  const changes: PushChange[] = []
  const warnings: string[] = []
  const backupPath = dryRun ? null : writePreBackup()

  const db = getDb()
  db.exec('BEGIN')
  try {
    // ---- Project-level fields ----
    if (plan.project) {
      const fields: string[] = []
      const patch: UpdateProjectInput = {}
      if (plan.project.description !== undefined && plan.project.description !== project.description) {
        patch.description = plan.project.description
        fields.push('description')
      }
      const status = checkEnum(plan.project.status, PROJECT_STATUSES, 'project status')
      if (status !== undefined && status !== project.status) {
        patch.status = status
        fields.push('status')
      }
      if (fields.length > 0) updateProject(projectId, patch)

      if (plan.project.tags) {
        const wanted = new Map<number, string>()
        for (const raw of plan.project.tags) {
          const name = String(raw ?? '').trim()
          if (!name) continue
          const tag = getOrCreateTag(name)
          wanted.set(tag.id, tag.name)
        }
        const current = new Set(project.tags.map((t) => t.id))
        let tagsChanged = false
        for (const id of wanted.keys()) {
          if (!current.has(id)) {
            addTagToProject(projectId, id)
            tagsChanged = true
          }
        }
        for (const id of current) {
          if (!wanted.has(id)) {
            removeTagFromProject(projectId, id)
            tagsChanged = true
          }
        }
        if (tagsChanged) fields.push('tags')
      }

      changes.push({
        type: 'project',
        action: fields.length > 0 ? 'updated' : 'unchanged',
        id: projectId,
        title: project.name,
        fields
      })
    }

    // ---- Tasks ----
    if (plan.tasks?.length) {
      const existing = index<Task>(
        listTasks(projectId),
        listTasks(projectId, { includeArchived: true }).filter((t) => t.archivedAt !== null)
      )
      for (const raw of plan.tasks) {
        const title = fallbackTitle(raw)
        if (!title) {
          warnings.push('Skipped a task with no title')
          continue
        }
        const priority = checkEnum(raw.priority, PRIORITIES, 'task priority')
        const status = checkEnum(raw.status, TASK_STATUSES, 'task status')
        const match = raw.id !== undefined ? existing.byId.get(raw.id) : existing.byKey.get(key(title))

        if (raw.id !== undefined && !match) {
          warnings.push(`Task #${raw.id} not found in this project — skipped`)
          continue
        }

        if (match) {
          const fields: string[] = []
          const patch: Record<string, unknown> = {}
          if (raw.title !== undefined && raw.title !== match.title) {
            patch.title = raw.title
            fields.push('title')
          }
          if (raw.body !== undefined && raw.body !== match.body) {
            patch.body = raw.body
            fields.push('body')
          }
          if (priority !== undefined && priority !== match.priority) {
            patch.priority = priority
            fields.push('priority')
          }
          if (status !== undefined && status !== match.status) {
            patch.status = status
            fields.push('status')
          }
          if (raw.dueDate !== undefined && raw.dueDate !== match.dueDate) {
            patch.dueDate = raw.dueDate
            fields.push('dueDate')
          }
          if (fields.length > 0) updateTask(match.id, patch, provenance)
          if (raw.tags && setItemTags('task', match.id, raw.tags)) fields.push('tags')
          changes.push({
            type: 'task',
            action: fields.length > 0 ? 'updated' : 'unchanged',
            id: match.id,
            title: match.title,
            fields
          })
          continue
        }

        if (existing.archivedKeys.has(key(title))) {
          warnings.push(
            `Task "${title}" matches an archived task — not recreated. Unarchive it if you meant that.`
          )
          continue
        }

        const created = createTask(
          projectId,
          { title, body: raw.body ?? '', priority: priority ?? 'medium', status, dueDate: raw.dueDate ?? null },
          provenance
        )
        if (raw.tags?.length) setItemTags('task', created.id, raw.tags)
        existing.byKey.set(key(title), created)
        changes.push({ type: 'task', action: 'created', id: created.id, title, fields: [] })
      }
    }

    // ---- Ideas ----
    if (plan.ideas?.length) {
      const existing = index<Idea>(
        listIdeas(projectId),
        listIdeas(projectId, { includeArchived: true }).filter((i) => i.status === 'archived')
      )
      for (const raw of plan.ideas) {
        const title = fallbackTitle(raw)
        if (!title) {
          warnings.push('Skipped an idea with no title')
          continue
        }
        const priority = checkEnum(raw.priority, PRIORITIES, 'idea priority')
        const status = checkEnum(raw.status, IDEA_STATUSES, 'idea status')
        const match = raw.id !== undefined ? existing.byId.get(raw.id) : existing.byKey.get(key(title))

        if (raw.id !== undefined && !match) {
          warnings.push(`Idea #${raw.id} not found in this project — skipped`)
          continue
        }

        if (match) {
          const fields: string[] = []
          const patch: Record<string, unknown> = {}
          if (raw.title !== undefined && raw.title !== match.title) {
            patch.title = raw.title
            fields.push('title')
          }
          if (raw.body !== undefined && raw.body !== match.body) {
            patch.body = raw.body
            fields.push('body')
          }
          if (priority !== undefined && priority !== match.priority) {
            patch.priority = priority
            fields.push('priority')
          }
          if (status !== undefined && status !== match.status) {
            patch.status = status
            fields.push('status')
          }
          if (fields.length > 0) updateIdea(match.id, patch, provenance)
          if (raw.tags && setItemTags('idea', match.id, raw.tags)) fields.push('tags')
          changes.push({
            type: 'idea',
            action: fields.length > 0 ? 'updated' : 'unchanged',
            id: match.id,
            title: match.title,
            fields
          })
          continue
        }

        if (existing.archivedKeys.has(key(title))) {
          warnings.push(`Idea "${title}" matches an archived idea — not recreated.`)
          continue
        }

        const created = createIdea(
          projectId,
          title,
          raw.body ?? '',
          priority ?? 'medium',
          provenance
        )
        if (status && status !== 'open') updateIdea(created.id, { status }, provenance)
        if (raw.tags?.length) setItemTags('idea', created.id, raw.tags)
        existing.byKey.set(key(title), created)
        changes.push({ type: 'idea', action: 'created', id: created.id, title, fields: [] })
      }
    }

    // ---- Notes ----
    if (plan.notes?.length) {
      const existing = index<Note>(
        listNotes(projectId),
        listNotes(projectId, { includeArchived: true }).filter((n) => n.archivedAt !== null)
      )
      for (const raw of plan.notes) {
        const title = fallbackTitle(raw)
        if (!title) {
          warnings.push('Skipped a note with no title or body')
          continue
        }
        const match = raw.id !== undefined ? existing.byId.get(raw.id) : existing.byKey.get(key(title))

        if (raw.id !== undefined && !match) {
          warnings.push(`Note #${raw.id} not found in this project — skipped`)
          continue
        }

        if (match) {
          const fields: string[] = []
          const patch: Record<string, unknown> = {}
          if (raw.title !== undefined && raw.title !== match.title) {
            patch.title = raw.title
            fields.push('title')
          }
          if (raw.body !== undefined && raw.body !== match.body) {
            patch.body = raw.body
            fields.push('body')
          }
          if (raw.pinned !== undefined && raw.pinned !== match.pinned) {
            patch.pinned = raw.pinned
            fields.push('pinned')
          }
          if (fields.length > 0) updateNote(match.id, patch, provenance)
          if (raw.tags && setItemTags('note', match.id, raw.tags)) fields.push('tags')
          changes.push({
            type: 'note',
            action: fields.length > 0 ? 'updated' : 'unchanged',
            id: match.id,
            title: match.title || match.body.slice(0, 60),
            fields
          })
          continue
        }

        if (existing.archivedKeys.has(key(title))) {
          warnings.push(`Note "${title}" matches an archived note — not recreated.`)
          continue
        }

        const created = createNote(projectId, raw.title ?? '', raw.body ?? '', provenance)
        if (raw.pinned) updateNote(created.id, { pinned: true }, provenance)
        if (raw.tags?.length) setItemTags('note', created.id, raw.tags)
        existing.byKey.set(key(title), created)
        changes.push({ type: 'note', action: 'created', id: created.id, title, fields: [] })
      }
    }

    const created = changes.filter((c) => c.action === 'created').length
    const updated = changes.filter((c) => c.action === 'updated').length

    if (!dryRun) {
      recordChange({
        provenance,
        projectId,
        entityType: 'project',
        entityId: projectId,
        action: 'push',
        summary: `${created} created, ${updated} updated`
      })
    }

    db.exec(dryRun ? 'ROLLBACK' : 'COMMIT')

    return {
      dryRun,
      projectId,
      projectName: project.name,
      created,
      updated,
      unchanged: changes.filter((c) => c.action === 'unchanged').length,
      changes,
      warnings,
      backupPath
    }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export { PlanError }
