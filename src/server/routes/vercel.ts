import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  detectVercelProject,
  linkVercelProject,
  listVercelProjects,
  VercelError
} from '../services/vercel.ts'

// Vercel is entirely optional. Every handler turns a VercelError into a plain
// `{ error }` the UI can show verbatim — including the "no token configured" case.
function fail(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof VercelError) return reply.code(error.status).send({ error: error.message })
  return reply.code(500).send({ error: String(error instanceof Error ? error.message : error) })
}

export async function vercelRoutes(app: FastifyInstance): Promise<void> {
  // The user's Vercel projects (cached for a few minutes in the service).
  app.get('/vercel/projects', async (req, reply) => {
    const refresh = String((req.query as { refresh?: string }).refresh ?? '') === 'true'
    try {
      return await listVercelProjects(refresh)
    } catch (error) {
      return fail(reply, error)
    }
  })

  // Work out which Vercel project this is, mostly from the git remote.
  app.post('/projects/:id/vercel/detect', async (req, reply) => {
    try {
      return await detectVercelProject(Number((req.params as { id: string }).id))
    } catch (error) {
      return fail(reply, error)
    }
  })

  // Link explicitly, or unlink by sending `{ vercelProjectId: null }`.
  app.post('/projects/:id/vercel/link', async (req, reply) => {
    const vercelProjectId = (req.body as { vercelProjectId?: string | null } | undefined)
      ?.vercelProjectId
    try {
      return await linkVercelProject(
        Number((req.params as { id: string }).id),
        vercelProjectId ?? null
      )
    } catch (error) {
      return fail(reply, error)
    }
  })
}
