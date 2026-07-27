import type { FastifyInstance, FastifyRequest } from 'fastify'
import { archiveNote, createNote, deleteNote, getNote, listNotes, updateNote } from '../repo/notes.ts'
import { createIdea, deleteIdea, getIdea, listIdeas, updateIdea } from '../repo/ideas.ts'
import {
  archiveTask,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  moveTask,
  updateTask
} from '../repo/tasks.ts'
import { addTagToItem, removeTagFromItem, setItemTags } from '../repo/itemTags.ts'
import { getOrCreateTag } from '../repo/tags.ts'
import { recordChange } from '../repo/changes.ts'
import { provenanceFrom } from '../services/provenance.ts'
import type {
  Idea,
  IdeaStatus,
  ItemType,
  Note,
  Priority,
  Task,
  TaskStatus
} from '../../shared/types.ts'

const idOf = (req: FastifyRequest): number => Number((req.params as { id: string }).id)

const wantsArchived = (req: FastifyRequest): boolean =>
  String((req.query as { includeArchived?: string }).includeArchived ?? '') === 'true'

// Tag endpoints are identical in shape for tasks/ideas/notes, so they're registered from
// one place instead of being written out three times.
function registerItemTagRoutes(
  app: FastifyInstance,
  itemType: ItemType,
  segment: string,
  read: (id: number) => Task | Idea | Note | null
): void {
  const logTags = (req: FastifyRequest, item: Task | Idea | Note | null, id: number): void => {
    if (!item) return
    recordChange({
      provenance: provenanceFrom(req),
      projectId: item.projectId,
      entityType: itemType,
      entityId: id,
      action: 'tagged',
      summary: `${item.title || 'item'} → [${item.tags.map((t) => t.name).join(', ')}]`
    })
  }

  app.post(`/${segment}/:id/tags`, async (req, reply) => {
    const id = idOf(req)
    if (!read(id)) return reply.code(404).send({ error: `${itemType} not found` })
    const body = (req.body ?? {}) as { tagId?: number; name?: string; color?: string }
    const tagId = body.tagId ?? (body.name?.trim() ? getOrCreateTag(body.name, body.color).id : null)
    if (!tagId) return reply.code(400).send({ error: 'tagId or name is required' })
    addTagToItem(itemType, id, tagId)
    const updated = read(id)
    logTags(req, updated, id)
    return updated
  })

  // Replace the whole tag set in one call — what a batch push and `launchpad … tags` use.
  app.put(`/${segment}/:id/tags`, async (req, reply) => {
    const id = idOf(req)
    if (!read(id)) return reply.code(404).send({ error: `${itemType} not found` })
    const names = ((req.body ?? {}) as { names?: string[] }).names ?? []
    setItemTags(itemType, id, names)
    const updated = read(id)
    logTags(req, updated, id)
    return updated
  })

  app.delete(`/${segment}/:id/tags/:tagId`, async (req, reply) => {
    const id = idOf(req)
    if (!read(id)) return reply.code(404).send({ error: `${itemType} not found` })
    removeTagFromItem(itemType, id, Number((req.params as { tagId: string }).tagId))
    const updated = read(id)
    logTags(req, updated, id)
    return updated
  })
}

export async function contentRoutes(app: FastifyInstance): Promise<void> {
  // ---- Notes ----
  app.get('/projects/:id/notes', async (req) =>
    listNotes(idOf(req), { includeArchived: wantsArchived(req) })
  )

  app.get('/notes/:id', async (req, reply) => {
    const note = getNote(idOf(req))
    if (!note) return reply.code(404).send({ error: 'Note not found' })
    return note
  })

  app.post('/projects/:id/notes', async (req, reply) => {
    const projectId = idOf(req)
    const body = (req.body ?? {}) as { title?: string; body?: string; tags?: string[] }
    const provenance = provenanceFrom(req)
    const note = createNote(projectId, body.title ?? '', body.body ?? '', provenance)
    if (body.tags?.length) setItemTags('note', note.id, body.tags)
    recordChange({
      provenance,
      projectId,
      entityType: 'note',
      entityId: note.id,
      action: 'created',
      summary: note.title || note.body.slice(0, 80)
    })
    return reply.code(201).send(getNote(note.id))
  })

  app.patch('/notes/:id', async (req, reply) => {
    const id = idOf(req)
    const provenance = provenanceFrom(req)
    const patch = (req.body ?? {}) as { title?: string; body?: string; pinned?: boolean; tags?: string[] }
    const note = updateNote(id, patch, provenance)
    if (!note) return reply.code(404).send({ error: 'Note not found' })
    if (patch.tags) setItemTags('note', id, patch.tags)
    recordChange({
      provenance,
      projectId: note.projectId,
      entityType: 'note',
      entityId: id,
      action: 'updated',
      summary: note.title || note.body.slice(0, 80)
    })
    return getNote(id)
  })

  app.post('/notes/:id/archive', async (req, reply) => {
    const id = idOf(req)
    const archived = ((req.body ?? {}) as { archived?: boolean }).archived !== false
    const provenance = provenanceFrom(req)
    const note = archiveNote(id, archived, provenance)
    if (!note) return reply.code(404).send({ error: 'Note not found' })
    recordChange({
      provenance,
      projectId: note.projectId,
      entityType: 'note',
      entityId: id,
      action: archived ? 'archived' : 'unarchived',
      summary: note.title || note.body.slice(0, 80)
    })
    return note
  })

  app.delete('/notes/:id', async (req) => {
    const id = idOf(req)
    const note = getNote(id)
    deleteNote(id)
    recordChange({
      provenance: provenanceFrom(req),
      projectId: note?.projectId ?? null,
      entityType: 'note',
      entityId: id,
      action: 'deleted',
      summary: note?.title ?? ''
    })
    return { ok: true }
  })

  registerItemTagRoutes(app, 'note', 'notes', getNote)

  // ---- Ideas ----
  app.get('/projects/:id/ideas', async (req) =>
    listIdeas(idOf(req), { includeArchived: wantsArchived(req) })
  )

  app.get('/ideas/:id', async (req, reply) => {
    const idea = getIdea(idOf(req))
    if (!idea) return reply.code(404).send({ error: 'Idea not found' })
    return idea
  })

  app.post('/projects/:id/ideas', async (req, reply) => {
    const projectId = idOf(req)
    const body = (req.body ?? {}) as {
      title?: string
      body?: string
      priority?: Priority
      tags?: string[]
    }
    const provenance = provenanceFrom(req)
    const idea = createIdea(
      projectId,
      body.title ?? '',
      body.body ?? '',
      body.priority ?? 'medium',
      provenance
    )
    if (body.tags?.length) setItemTags('idea', idea.id, body.tags)
    recordChange({
      provenance,
      projectId,
      entityType: 'idea',
      entityId: idea.id,
      action: 'created',
      summary: idea.title
    })
    return reply.code(201).send(getIdea(idea.id))
  })

  app.patch('/ideas/:id', async (req, reply) => {
    const id = idOf(req)
    const provenance = provenanceFrom(req)
    const patch = (req.body ?? {}) as {
      title?: string
      body?: string
      priority?: Priority
      status?: IdeaStatus
      tags?: string[]
    }
    const idea = updateIdea(id, patch, provenance)
    if (!idea) return reply.code(404).send({ error: 'Idea not found' })
    if (patch.tags) setItemTags('idea', id, patch.tags)
    recordChange({
      provenance,
      projectId: idea.projectId,
      entityType: 'idea',
      entityId: id,
      action: 'updated',
      summary: idea.title
    })
    return getIdea(id)
  })

  // Ideas archive through their status; this alias keeps the CLI uniform across kinds.
  app.post('/ideas/:id/archive', async (req, reply) => {
    const id = idOf(req)
    const archived = ((req.body ?? {}) as { archived?: boolean }).archived !== false
    const provenance = provenanceFrom(req)
    const idea = updateIdea(id, { status: archived ? 'archived' : 'open' }, provenance)
    if (!idea) return reply.code(404).send({ error: 'Idea not found' })
    recordChange({
      provenance,
      projectId: idea.projectId,
      entityType: 'idea',
      entityId: id,
      action: archived ? 'archived' : 'unarchived',
      summary: idea.title
    })
    return idea
  })

  app.delete('/ideas/:id', async (req) => {
    const id = idOf(req)
    const idea = getIdea(id)
    deleteIdea(id)
    recordChange({
      provenance: provenanceFrom(req),
      projectId: idea?.projectId ?? null,
      entityType: 'idea',
      entityId: id,
      action: 'deleted',
      summary: idea?.title ?? ''
    })
    return { ok: true }
  })

  // Promote an idea to a task, keeping the idea as a record (marked promoted).
  app.post('/ideas/:id/promote', async (req, reply) => {
    const id = idOf(req)
    const idea = getIdea(id)
    if (!idea) return reply.code(404).send({ error: 'Idea not found' })
    const provenance = provenanceFrom(req)
    const task = createTask(
      idea.projectId,
      { title: idea.title, body: idea.body, priority: idea.priority },
      provenance
    )
    if (idea.tags.length) setItemTags('task', task.id, idea.tags.map((t) => t.name))
    updateIdea(id, { status: 'promoted' }, provenance)
    recordChange({
      provenance,
      projectId: idea.projectId,
      entityType: 'task',
      entityId: task.id,
      action: 'promoted',
      summary: `from idea #${id}: ${idea.title}`
    })
    return reply.code(201).send(getTask(task.id))
  })

  registerItemTagRoutes(app, 'idea', 'ideas', getIdea)

  // ---- Tasks ----
  app.get('/projects/:id/tasks', async (req) =>
    listTasks(idOf(req), { includeArchived: wantsArchived(req) })
  )

  app.get('/tasks/:id', async (req, reply) => {
    const task = getTask(idOf(req))
    if (!task) return reply.code(404).send({ error: 'Task not found' })
    return task
  })

  app.post('/projects/:id/tasks', async (req, reply) => {
    const projectId = idOf(req)
    const body = (req.body ?? {}) as {
      title?: string
      body?: string
      priority?: Priority
      status?: TaskStatus
      dueDate?: string | null
      tags?: string[]
    }
    const provenance = provenanceFrom(req)
    const task = createTask(
      projectId,
      {
        title: body.title ?? '',
        body: body.body ?? '',
        priority: body.priority ?? 'medium',
        status: body.status,
        dueDate: body.dueDate ?? null
      },
      provenance
    )
    if (body.tags?.length) setItemTags('task', task.id, body.tags)
    recordChange({
      provenance,
      projectId,
      entityType: 'task',
      entityId: task.id,
      action: 'created',
      summary: task.title
    })
    return reply.code(201).send(getTask(task.id))
  })

  app.patch('/tasks/:id', async (req, reply) => {
    const id = idOf(req)
    const provenance = provenanceFrom(req)
    const patch = (req.body ?? {}) as {
      title?: string
      body?: string
      status?: TaskStatus
      priority?: Priority
      sort?: number
      dueDate?: string | null
      tags?: string[]
    }
    const task = updateTask(id, patch, provenance)
    if (!task) return reply.code(404).send({ error: 'Task not found' })
    if (patch.tags) setItemTags('task', id, patch.tags)
    recordChange({
      provenance,
      projectId: task.projectId,
      entityType: 'task',
      entityId: id,
      action: 'updated',
      summary: task.title
    })
    return getTask(id)
  })

  app.post('/tasks/:id/archive', async (req, reply) => {
    const id = idOf(req)
    const archived = ((req.body ?? {}) as { archived?: boolean }).archived !== false
    const provenance = provenanceFrom(req)
    const task = archiveTask(id, archived, provenance)
    if (!task) return reply.code(404).send({ error: 'Task not found' })
    recordChange({
      provenance,
      projectId: task.projectId,
      entityType: 'task',
      entityId: id,
      action: archived ? 'archived' : 'unarchived',
      summary: task.title
    })
    return task
  })

  app.post('/tasks/:id/move', async (req) => {
    const direction = ((req.body ?? {}) as { direction?: 'up' | 'down' }).direction === 'up' ? 'up' : 'down'
    moveTask(idOf(req), direction)
    return { ok: true }
  })

  app.delete('/tasks/:id', async (req) => {
    const id = idOf(req)
    const task = getTask(id)
    deleteTask(id)
    recordChange({
      provenance: provenanceFrom(req),
      projectId: task?.projectId ?? null,
      entityType: 'task',
      entityId: id,
      action: 'deleted',
      summary: task?.title ?? ''
    })
    return { ok: true }
  })

  registerItemTagRoutes(app, 'task', 'tasks', getTask)
}
