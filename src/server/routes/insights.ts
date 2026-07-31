import type { FastifyInstance } from 'fastify'
import { getActivity, getStats, search } from '../services/insights.ts'
import { projectDiff, recentCommits } from '../services/gitHistory.ts'
import { findDuplicates, mergeProjects } from '../services/duplicates.ts'
import { getProject } from '../repo/projects.ts'
import { recordChange } from '../repo/changes.ts'
import { provenanceFrom } from '../services/provenance.ts'

export async function insightRoutes(app: FastifyInstance): Promise<void> {
  app.get('/stats', async () => getStats())

  app.get('/activity', async (req) => {
    const limit = Number((req.query as { limit?: string }).limit) || 40
    return getActivity(limit)
  })

  app.get('/search', async (req) => {
    const q = (req.query as { q?: string }).q ?? ''
    return search(q)
  })

  app.get('/projects/:id/commits', async (req, reply) => {
    const project = getProject(Number((req.params as { id: string }).id))
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    return recentCommits(project.path, 25)
  })

  app.get('/projects/:id/diff', async (req, reply) => {
    const project = getProject(Number((req.params as { id: string }).id))
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    return projectDiff(project.path, (req.query as { staged?: string }).staged === 'true')
  })

  app.get('/duplicates', async () => findDuplicates())

  // `mergeIds` is the accurate name now that duplicates aren't only nested ones; `nestedIds`
  // stays accepted so an older UI build keeps working.
  app.post('/merge', async (req, reply) => {
    const body = req.body as { keeperId?: number; mergeIds?: number[]; nestedIds?: number[] }
    const mergeIds = body?.mergeIds ?? body?.nestedIds
    if (!body?.keeperId || !Array.isArray(mergeIds)) {
      return reply.code(400).send({ error: 'keeperId and mergeIds are required' })
    }
    const keeper = getProject(body.keeperId)
    if (!keeper) {
      return reply.code(404).send({ error: 'Keeper project not found' })
    }
    const result = mergeProjects(body.keeperId, mergeIds)
    // A merge deletes registrations. Log which ones, or the change history has a silent hole
    // exactly where someone will later be looking for a project that has stopped existing.
    for (const gone of result.removed) {
      recordChange({
        provenance: provenanceFrom(req),
        projectId: keeper.id,
        entityType: 'project',
        entityId: gone.id,
        action: 'deleted',
        summary: `merged "${gone.name}" (#${gone.id}, ${gone.path}) into "${keeper.name}" (#${keeper.id})`
      })
    }
    return result
  })
}
