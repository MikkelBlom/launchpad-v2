import type { FastifyInstance } from 'fastify'
import { createNote, deleteNote, listNotes, updateNote } from '../repo/notes.ts'
import { createIdea, deleteIdea, listIdeas, updateIdea } from '../repo/ideas.ts'
import { createTask, deleteTask, listTasks, updateTask } from '../repo/tasks.ts'
import type { Priority } from '../../shared/types.ts'

export async function contentRoutes(app: FastifyInstance): Promise<void> {
  // ---- Notes ----
  app.get('/projects/:id/notes', async (req) =>
    listNotes(Number((req.params as { id: string }).id))
  )

  app.post('/projects/:id/notes', async (req, reply) => {
    const body = req.body as { title?: string; body?: string }
    const note = createNote(
      Number((req.params as { id: string }).id),
      body.title ?? '',
      body.body ?? ''
    )
    return reply.code(201).send(note)
  })

  app.patch('/notes/:id', async (req, reply) => {
    const note = updateNote(
      Number((req.params as { id: string }).id),
      req.body as { title?: string; body?: string; pinned?: boolean }
    )
    if (!note) return reply.code(404).send({ error: 'Note not found' })
    return note
  })

  app.delete('/notes/:id', async (req) => {
    deleteNote(Number((req.params as { id: string }).id))
    return { ok: true }
  })

  // ---- Ideas ----
  app.get('/projects/:id/ideas', async (req) =>
    listIdeas(Number((req.params as { id: string }).id))
  )

  app.post('/projects/:id/ideas', async (req, reply) => {
    const body = req.body as { title?: string; body?: string; priority?: Priority }
    const idea = createIdea(
      Number((req.params as { id: string }).id),
      body.title ?? '',
      body.body ?? '',
      body.priority ?? 'medium'
    )
    return reply.code(201).send(idea)
  })

  app.patch('/ideas/:id', async (req, reply) => {
    const idea = updateIdea(
      Number((req.params as { id: string }).id),
      req.body as Record<string, never>
    )
    if (!idea) return reply.code(404).send({ error: 'Idea not found' })
    return idea
  })

  app.delete('/ideas/:id', async (req) => {
    deleteIdea(Number((req.params as { id: string }).id))
    return { ok: true }
  })

  // Promote an idea to a task, keeping the idea as a record (marked promoted).
  app.post('/ideas/:id/promote', async (req, reply) => {
    const ideaId = Number((req.params as { id: string }).id)
    const ideas = listIdeas(Number((req.body as { projectId: number }).projectId))
    const idea = ideas.find((i) => i.id === ideaId)
    if (!idea) return reply.code(404).send({ error: 'Idea not found' })
    const task = createTask(idea.projectId, idea.title, idea.priority)
    updateIdea(ideaId, { status: 'promoted' })
    return reply.code(201).send(task)
  })

  // ---- Tasks ----
  app.get('/projects/:id/tasks', async (req) =>
    listTasks(Number((req.params as { id: string }).id))
  )

  app.post('/projects/:id/tasks', async (req, reply) => {
    const body = req.body as { title?: string; priority?: Priority }
    const task = createTask(
      Number((req.params as { id: string }).id),
      body.title ?? '',
      body.priority ?? 'medium'
    )
    return reply.code(201).send(task)
  })

  app.patch('/tasks/:id', async (req, reply) => {
    const task = updateTask(
      Number((req.params as { id: string }).id),
      req.body as Record<string, never>
    )
    if (!task) return reply.code(404).send({ error: 'Task not found' })
    return task
  })

  app.delete('/tasks/:id', async (req) => {
    deleteTask(Number((req.params as { id: string }).id))
    return { ok: true }
  })
}
