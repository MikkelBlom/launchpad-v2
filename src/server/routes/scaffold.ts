import type { FastifyInstance } from 'fastify'
import { scaffoldProject, type ScaffoldInput } from '../services/scaffolder.ts'

export async function scaffoldRoutes(app: FastifyInstance): Promise<void> {
  app.post('/scaffold', async (req, reply) => {
    try {
      const result = await scaffoldProject(req.body as ScaffoldInput)
      return reply.code(201).send(result)
    } catch (error) {
      return reply.code(400).send({
        error: String(error instanceof Error ? error.message : error)
      })
    }
  })
}
