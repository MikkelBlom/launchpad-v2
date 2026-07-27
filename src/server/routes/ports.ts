import type { FastifyInstance, FastifyReply } from 'fastify'
import { recordChange } from '../repo/changes.ts'
import { getProject, touchOpened } from '../repo/projects.ts'
import { openUrl } from '../services/launcher.ts'
import {
  buildPortOverview,
  checkPort,
  detectAndStorePort,
  devUrl,
  PortError,
  setProjectPort,
  suggestPorts
} from '../services/ports.ts'
import { provenanceFrom } from '../services/provenance.ts'

function fail(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof PortError) return reply.code(error.status).send({ error: error.message })
  return reply.code(500).send({ error: String(error instanceof Error ? error.message : error) })
}

export async function portRoutes(app: FastifyInstance): Promise<void> {
  // Every project's claimed port, what is listening on this machine, and what is free.
  app.get('/ports', async () => buildPortOverview())

  // "Can I use 7431?" — the question an agent asks before configuring a dev server.
  app.get('/ports/check', async (req, reply) => {
    const raw = (req.query as { port?: string }).port
    const port = Number(raw)
    if (raw === undefined || !Number.isFinite(port)) {
      return reply.code(400).send({ error: 'A ?port=<number> query parameter is required' })
    }
    return checkPort(port)
  })

  app.get('/ports/suggest', async (req) => {
    const count = Number((req.query as { count?: string }).count)
    return { ports: await suggestPorts(Number.isFinite(count) ? count : 3) }
  })

  // Claim a port for a project by hand. `{ port: null }` releases it.
  app.post('/projects/:id/port', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const body = (req.body ?? {}) as { port?: number | null }
    if (body.port === undefined) {
      return reply.code(400).send({ error: 'A "port" field is required (send null to clear it)' })
    }
    try {
      // The raw value is handed straight to the service so a rejection can quote what the
      // caller actually sent rather than the NaN it turns into.
      const project = setProjectPort(id, body.port)
      recordChange({
        provenance: provenanceFrom(req),
        projectId: id,
        entityType: 'project',
        entityId: id,
        action: 'updated',
        summary: project.devPort === null ? 'dev port cleared' : `dev port set to ${project.devPort}`
      })
      return project
    } catch (error) {
      return fail(reply, error)
    }
  })

  // Read the project's own config files and store whatever port they declare.
  app.post('/projects/:id/detect-port', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    try {
      const result = detectAndStorePort(id)
      if (result.port !== null) {
        recordChange({
          provenance: provenanceFrom(req),
          projectId: id,
          entityType: 'project',
          entityId: id,
          action: 'updated',
          summary: `dev port detected as ${result.port} (${result.source})`
        })
      }
      return result
    } catch (error) {
      return fail(reply, error)
    }
  })

  // Open http://localhost:<port> in the default browser — the whole point of the feature.
  app.post('/projects/:id/open-dev', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const project = getProject(id)
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    const url = devUrl(project.devPort)
    if (!url) {
      return reply
        .code(400)
        .send({ error: `No dev port is set for "${project.name}" — detect or claim one first` })
    }
    openUrl(url)
    touchOpened(id)
    return { ok: true }
  })
}
