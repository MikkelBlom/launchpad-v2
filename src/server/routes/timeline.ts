import type { FastifyInstance } from 'fastify'
import { getTimeline } from '../services/timeline.ts'
import { WeekParseError } from '../../shared/isoWeek.ts'

export async function timelineRoutes(app: FastifyInstance): Promise<void> {
  // ?week=2026-W45 | this | last | 2026-11-04   ?mine=true   ?refresh=true
  app.get('/timeline', async (req, reply) => {
    const q = req.query as { week?: string; mine?: string; refresh?: string }
    try {
      return await getTimeline(q.week, { mine: q.mine === 'true', refresh: q.refresh === 'true' })
    } catch (e) {
      if (e instanceof WeekParseError) return reply.code(400).send({ error: e.message })
      throw e
    }
  })
}
