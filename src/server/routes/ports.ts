import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { recordChange } from '../repo/changes.ts'
import { getProject, touchOpened } from '../repo/projects.ts'
import { openUrl } from '../services/launcher.ts'
import {
  buildPortOverview,
  checkPort,
  claimPort,
  detectAndStorePorts,
  devUrl,
  PortError,
  releaseAllPorts,
  releasePort,
  setPortLabel,
  setPortOrder,
  setProjectPort,
  suggestPorts
} from '../services/ports.ts'
import { provenanceFrom } from '../services/provenance.ts'

function fail(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof PortError) return reply.code(error.status).send({ error: error.message })
  return reply.code(500).send({ error: String(error instanceof Error ? error.message : error) })
}

function idOf(req: FastifyRequest): number {
  return Number((req.params as { id: string }).id)
}

function note(req: FastifyRequest, projectId: number, summary: string): void {
  recordChange({
    provenance: provenanceFrom(req),
    projectId,
    entityType: 'project',
    entityId: projectId,
    action: 'updated',
    summary
  })
}

export async function portRoutes(app: FastifyInstance): Promise<void> {
  // Every claim in Launchpad, what is listening on this machine, and what is free.
  app.get('/ports', async () => buildPortOverview())

  // "Can I use 7431?" — the question an agent asks before configuring a dev server.
  // `projectId` excludes that project's own claims, so re-checking a port you already hold
  // doesn't report you as your own conflict.
  app.get('/ports/check', async (req, reply) => {
    const query = req.query as { port?: string; projectId?: string }
    const port = Number(query.port)
    if (query.port === undefined || !Number.isFinite(port)) {
      return reply.code(400).send({ error: 'A ?port=<number> query parameter is required' })
    }
    const projectId = Number(query.projectId)
    return checkPort(port, Number.isFinite(projectId) ? projectId : undefined)
  })

  app.get('/ports/suggest', async (req) => {
    const count = Number((req.query as { count?: string }).count)
    return suggestPorts(Number.isFinite(count) ? count : 3)
  })

  // ---- A project's claims ----

  app.get('/projects/:id/ports', async (req, reply) => {
    const project = getProject(idOf(req))
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    return project.ports
  })

  // Claim one more port, leaving the project's other claims alone. Refuses a reserved port
  // outright and a port another project holds unless `force` is set.
  app.post('/projects/:id/ports', async (req, reply) => {
    const id = idOf(req)
    const body = (req.body ?? {}) as {
      port?: unknown
      label?: string
      source?: string
      force?: boolean
    }
    if (body.port === undefined || body.port === null) {
      return reply.code(400).send({ error: 'A "port" field is required' })
    }
    try {
      const result = await claimPort(id, body.port, {
        label: body.label,
        source: body.source,
        force: body.force === true
      })
      note(req, id, `claimed port ${result.claim.port}${result.claim.label ? ` (${result.claim.label})` : ''}`)
      return result
    } catch (error) {
      return fail(reply, error)
    }
  })

  // Rename what runs on a port ("web", "api") without touching the claim itself.
  app.patch('/projects/:id/ports/:port', async (req, reply) => {
    const id = idOf(req)
    const port = Number((req.params as { port: string }).port)
    const label = (req.body as { label?: string } | undefined)?.label
    if (typeof label !== 'string') {
      return reply.code(400).send({ error: 'A "label" field is required' })
    }
    try {
      const claim = setPortLabel(id, port, label)
      note(req, id, `labelled port ${claim.port} "${claim.label}"`)
      return claim
    } catch (error) {
      return fail(reply, error)
    }
  })

  app.delete('/projects/:id/ports/:port', async (req, reply) => {
    const id = idOf(req)
    const port = Number((req.params as { port: string }).port)
    try {
      const project = releasePort(id, port)
      note(req, id, `released port ${port}`)
      return project
    } catch (error) {
      return fail(reply, error)
    }
  })

  // Which claim is the primary one — the port "open localhost" and the agent block use.
  app.post('/projects/:id/ports/order', async (req, reply) => {
    const id = idOf(req)
    const ports = (req.body as { ports?: number[] } | undefined)?.ports
    if (!Array.isArray(ports)) {
      return reply.code(400).send({ error: 'A "ports" array is required' })
    }
    try {
      return setPortOrder(id, ports.map(Number).filter(Number.isFinite))
    } catch (error) {
      return fail(reply, error)
    }
  })

  // Replace the whole set with one port — what `launchpad set port <n>` has always meant.
  // `{ port: null }` releases everything.
  app.post('/projects/:id/port', async (req, reply) => {
    const id = idOf(req)
    const body = (req.body ?? {}) as { port?: number | null; label?: string; force?: boolean }
    if (body.port === undefined) {
      return reply.code(400).send({ error: 'A "port" field is required (send null to clear it)' })
    }
    try {
      // The raw value is handed straight to the service so a rejection can quote what the
      // caller actually sent rather than the NaN it turns into.
      const result = await setProjectPort(id, body.port, {
        label: body.label,
        force: body.force === true
      })
      note(req, id, result.claim === null ? 'dev ports cleared' : `dev port set to ${result.claim.port}`)
      return result
    } catch (error) {
      return fail(reply, error)
    }
  })

  app.delete('/projects/:id/ports', async (req, reply) => {
    const id = idOf(req)
    try {
      const project = releaseAllPorts(id)
      note(req, id, 'dev ports cleared')
      return project
    } catch (error) {
      return fail(reply, error)
    }
  })

  // Read the project's own config files and claim every port they declare.
  app.post('/projects/:id/detect-port', async (req, reply) => {
    const id = idOf(req)
    try {
      const result = await detectAndStorePorts(id)
      if (result.claimed.length > 0) {
        note(
          req,
          id,
          `dev ports detected: ${result.claimed.map((claim) => claim.port).join(', ')} (${result.claimed[0].source})`
        )
      }
      return result
    } catch (error) {
      return fail(reply, error)
    }
  })

  // Open http://localhost:<port> in the default browser — the whole point of the feature.
  // Defaults to the primary claim; `?port=` opens one of the others.
  app.post('/projects/:id/open-dev', async (req, reply) => {
    const id = idOf(req)
    const project = getProject(id)
    if (!project) return reply.code(404).send({ error: 'Project not found' })

    const wanted = Number((req.query as { port?: string }).port)
    const claim = Number.isFinite(wanted)
      ? project.ports.find((p) => p.port === wanted)
      : project.ports[0]
    if (!claim) {
      return reply.code(400).send({
        error: Number.isFinite(wanted)
          ? `"${project.name}" does not claim port ${wanted}`
          : `No dev port is set for "${project.name}" — detect or claim one first`
      })
    }
    openUrl(devUrl(claim.port)!)
    touchOpened(id)
    return { ok: true, url: devUrl(claim.port) }
  })
}
