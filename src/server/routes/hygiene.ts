import type { FastifyInstance } from 'fastify'
import { getProject } from '../repo/projects.ts'
import { getHygieneOverview, getProjectHygiene } from '../services/hygiene.ts'

// Read-only. Nothing here runs a cleanup command; the findings only carry them as text.
export async function hygieneRoutes(app: FastifyInstance): Promise<void> {
  // Cached results immediately, plus a background refresh of anything stale. Poll while
  // `scanning` is true.
  app.get('/hygiene', async (req) => getHygieneOverview((req.query as { refresh?: string }).refresh === 'true'))

  // Scans on demand (cached for a few minutes); `?refresh=true` forces a fresh scan.
  app.get('/projects/:id/hygiene', async (req, reply) => {
    const project = getProject(Number((req.params as { id: string }).id))
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    return getProjectHygiene(project, (req.query as { refresh?: string }).refresh === 'true')
  })
}
