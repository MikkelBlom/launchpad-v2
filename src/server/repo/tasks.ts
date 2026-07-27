import { getDb, nowIso } from '../db/database.ts'
import type { Priority, Task, TaskStatus } from '../../shared/types.ts'

interface TaskRow {
  id: number
  project_id: number
  title: string
  status: string
  priority: string
  sort: number
  due_date: string | null
  created_at: string
  updated_at: string
  done_at: string | null
}

function mapRow(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status as TaskStatus,
    priority: row.priority as Priority,
    sort: row.sort,
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    doneAt: row.done_at
  }
}

export function listTasks(projectId: number): Task[] {
  const rows = getDb()
    .prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY sort ASC, created_at ASC')
    .all(projectId) as unknown as TaskRow[]
  return rows.map(mapRow)
}

export function createTask(
  projectId: number,
  title: string,
  priority: Priority,
  status: TaskStatus = 'todo'
): Task {
  const now = nowIso()
  const maxSort = getDb()
    .prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM tasks WHERE project_id = ?')
    .get(projectId) as { m: number }
  const info = getDb()
    .prepare(
      'INSERT INTO tasks (project_id, title, status, priority, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(projectId, title, status, priority, maxSort.m + 1, now, now)
  return mapRow(
    getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(Number(info.lastInsertRowid)) as unknown as TaskRow
  )
}

export interface UpdateTaskInput {
  title?: string
  status?: TaskStatus
  priority?: Priority
  sort?: number
  dueDate?: string | null
}

export function updateTask(id: number, patch: UpdateTaskInput): Task | null {
  const fields: string[] = []
  const values: unknown[] = []
  if (patch.title !== undefined) {
    fields.push('title = ?')
    values.push(patch.title)
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
  values.push(id)
  getDb()
    .prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`)
    .run(...(values as never[]))
  const row = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as unknown as TaskRow | undefined
  return row ? mapRow(row) : null
}

// Swap sort order with the adjacent task in the project's ordered list.
export function moveTask(id: number, direction: 'up' | 'down'): void {
  const task = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as unknown as TaskRow | undefined
  if (!task) return
  const neighbor = getDb()
    .prepare(
      direction === 'up'
        ? 'SELECT * FROM tasks WHERE project_id = ? AND sort < ? ORDER BY sort DESC LIMIT 1'
        : 'SELECT * FROM tasks WHERE project_id = ? AND sort > ? ORDER BY sort ASC LIMIT 1'
    )
    .get(task.project_id, task.sort) as unknown as TaskRow | undefined
  if (!neighbor) return
  getDb().prepare('UPDATE tasks SET sort = ? WHERE id = ?').run(neighbor.sort, task.id)
  getDb().prepare('UPDATE tasks SET sort = ? WHERE id = ?').run(task.sort, neighbor.id)
}

export function deleteTask(id: number): void {
  getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id)
}
