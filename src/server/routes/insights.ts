import type { FastifyInstance } from 'fastify'
import { getActivity, getStats, search } from '../services/insights.ts'
import { recentCommits } from '../services/gitHistory.ts'
import { findDuplicates, mergeProjects } from '../services/duplicates.ts'
import { getProject } from '../repo/projects.ts'

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

  app.get('/duplicates', async () => findDuplicates())

  app.post('/merge', async (req, reply) => {
    const body = req.body as { keeperId?: number; nestedIds?: number[] }
    if (!body?.keeperId || !Array.isArray(body.nestedIds)) {
      return reply.code(400).send({ error: 'keeperId and nestedIds are required' })
    }
    return mergeProjects(body.keeperId, body.nestedIds)
  })
}
