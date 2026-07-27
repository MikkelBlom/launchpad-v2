import type { FastifyInstance } from 'fastify'
import {
  addTagToProject,
  deleteTag,
  getOrCreateTag,
  listTags,
  removeTagFromProject,
  updateTag
} from '../repo/tags.ts'
import { getProject } from '../repo/projects.ts'
import { recordChange } from '../repo/changes.ts'
import { provenanceFrom } from '../services/provenance.ts'

export async function tagRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tags', async () => listTags())

  app.post('/tags', async (req, reply) => {
    const body = req.body as { name?: string; color?: string }
    if (!body?.name?.trim()) return reply.code(400).send({ error: 'name is required' })
    return reply.code(201).send(getOrCreateTag(body.name, body.color ?? '#78716c'))
  })

  app.patch('/tags/:id', async (req) => {
    updateTag(
      Number((req.params as { id: string }).id),
      req.body as { name?: string; color?: string }
    )
    return { ok: true }
  })

  app.delete('/tags/:id', async (req) => {
    deleteTag(Number((req.params as { id: string }).id))
    return { ok: true }
  })

  // Attach a tag to a project (by tagId, or by name — created if missing).
  app.post('/projects/:id/tags', async (req, reply) => {
    const projectId = Number((req.params as { id: string }).id)
    if (!getProject(projectId)) return reply.code(404).send({ error: 'Project not found' })
    const body = req.body as { tagId?: number; name?: string; color?: string }
    let tagId = body.tagId
    if (!tagId && body.name?.trim()) {
      tagId = getOrCreateTag(body.name, body.color ?? '#78716c').id
    }
    if (!tagId) return reply.code(400).send({ error: 'tagId or name is required' })
    addTagToProject(projectId, tagId)
    const updated = getProject(projectId)
    recordChange({
      provenance: provenanceFrom(req),
      projectId,
      entityType: 'project',
      entityId: projectId,
      action: 'tagged',
      summary: (updated?.tags ?? []).map((t) => t.name).join(', ')
    })
    return updated
  })

  app.delete('/projects/:id/tags/:tagId', async (req) => {
    const projectId = Number((req.params as { id: string; tagId: string }).id)
    const tagId = Number((req.params as { id: string; tagId: string }).tagId)
    removeTagFromProject(projectId, tagId)
    const updated = getProject(projectId)
    recordChange({
      provenance: provenanceFrom(req),
      projectId,
      entityType: 'project',
      entityId: projectId,
      action: 'tagged',
      summary: (updated?.tags ?? []).map((t) => t.name).join(', ') || '(none)'
    })
    return updated
  })
}
