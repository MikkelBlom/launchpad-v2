import { getDb, nowIso } from '../db/database.ts'
import { clearItemTags, tagsForItem, tagsForProjectItems } from './itemTags.ts'
import type { Priority, Provenance, Tag, Task, TaskStatus, WriteSource } from '../../shared/types.ts'

const UI: Provenance = { source: 'ui', actor: '' }

interface TaskRow {
  id: number
  project_id: number
  title: string
  body: string
  status: string
  priority: string
  sort: number
  due_date: string | null
  archived_at: string | null
  source: string
  updated_by: string
  created_at: string
  updated_at: string
  done_at: string | null
}

function mapRow(row: TaskRow, tags: Tag[] = []): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    body: row.body,
    status: row.status as TaskStatus,
    priority: row.priority as Priority,
    sort: row.sort,
    dueDate: row.due_date,
    archivedAt: row.archived_at,
    source: row.source as WriteSource,
    updatedBy: row.updated_by,
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    doneAt: row.done_at
  }
}

export interface ListTasksOptions {
  includeArchived?: boolean
}

export function listTasks(projectId: number, options: ListTasksOptions = {}): Task[] {
  const clause = options.includeArchived ? '' : 'AND archived_at IS NULL'
  const rows = getDb()
    .prepare(
      `SELECT * FROM tasks WHERE project_id = ? ${clause} ORDER BY sort ASC, created_at ASC`
    )
    .all(projectId) as unknown as TaskRow[]
  const tagMap = tagsForProjectItems('task', projectId)
  return rows.map((row) => mapRow(row, tagMap.get(row.id) ?? []))
}

export function getTask(id: number): Task | null {
  const row = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as unknown as
    | TaskRow
    | undefined
  return row ? mapRow(row, tagsForItem('task', row.id)) : null
}

export interface CreateTaskInput {
  title: string
  body?: string
  priority?: Priority
  status?: TaskStatus
  dueDate?: string | null
}

export function createTask(
  projectId: number,
  input: CreateTaskInput,
  provenance: Provenance = UI
): Task {
  const now = nowIso()
  const maxSort = getDb()
    .prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM tasks WHERE project_id = ?')
    .get(projectId) as { m: number }
  const status = input.status ?? 'todo'
  const info = getDb()
    .prepare(
      `INSERT INTO tasks
         (project_id, title, body, status, priority, sort, due_date, source, updated_by, created_at, updated_at, done_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      projectId,
      input.title,
      input.body ?? '',
      status,
      input.priority ?? 'medium',
      maxSort.m + 1,
      input.dueDate ?? null,
      provenance.source,
      provenance.actor,
      now,
      now,
      status === 'done' ? now : null
    )
  return getTask(Number(info.lastInsertRowid))!
}

export interface UpdateTaskInput {
  title?: string
  body?: string
  status?: TaskStatus
  priority?: Priority
  sort?: number
  dueDate?: string | null
}

export function updateTask(
  id: number,
  patch: UpdateTaskInput,
  provenance: Provenance = UI
): Task | null {
  const fields: string[] = []
  const values: unknown[] = []
  if (patch.title !== undefined) {
    fields.push('title = ?')
    values.push(patch.title)
  }
  if (patch.body !== undefined) {
    fields.push('body = ?')
    values.push(patch.body)
  }
  if (patch.priority !== undefined) {
    fields.push('priority = ?')
    values.push(patch.priority)
  }
  if (patch.sort !== undefined) {
    fields.push('sort = ?')
    values.push(patch.sort)
  }
  if (patch.dueDate !== undefined) {
    fields.push('due_date = ?')
    values.push(patch.dueDate)
  }
  if (patch.status !== undefined) {
    fields.push('status = ?')
    values.push(patch.status)
    fields.push('done_at = ?')
    values.push(patch.status === 'done' ? nowIso() : null)
  }
  fields.push('updated_at = ?')
  values.push(nowIso())
  fields.push('source = ?')
  values.push(provenance.source)
  fields.push('updated_by = ?')
  values.push(provenance.actor)
  values.push(id)
  getDb()
    .prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`)
    .run(...(values as never[]))
  return getTask(id)
}

// Archiving is the agent-facing alternative to deletion: reversible and never loses data.
export function archiveTask(id: number, archived: boolean, provenance: Provenance = UI): Task | null {
  getDb()
    .prepare('UPDATE tasks SET archived_at = ?, updated_at = ?, source = ?, updated_by = ? WHERE id = ?')
    .run(archived ? nowIso() : null, nowIso(), provenance.source, provenance.actor, id)
  return getTask(id)
}

// Swap sort order with the adjacent task in the project's ordered list.
export function moveTask(id: number, direction: 'up' | 'down'): void {
  const task = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as unknown as TaskRow | undefined
  if (!task) return
  const neighbor = getDb()
    .prepare(
      direction === 'up'
        ? 'SELECT * FROM tasks WHERE project_id = ? AND archived_at IS NULL AND sort < ? ORDER BY sort DESC LIMIT 1'
        : 'SELECT * FROM tasks WHERE project_id = ? AND archived_at IS NULL AND sort > ? ORDER BY sort ASC LIMIT 1'
    )
    .get(task.project_id, task.sort) as unknown as TaskRow | undefined
  if (!neighbor) return
  getDb().prepare('UPDATE tasks SET sort = ? WHERE id = ?').run(neighbor.sort, task.id)
  getDb().prepare('UPDATE tasks SET sort = ? WHERE id = ?').run(task.sort, neighbor.id)
}

export function deleteTask(id: number): void {
  clearItemTags('task', id)
  getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id)
}
