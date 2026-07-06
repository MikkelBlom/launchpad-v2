import { existsSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import {
  createProject,
  deleteProject,
  getProject,
  getProjectByPath,
  listProjects,
  touchOpened,
  updateProject
} from '../repo/projects.ts'
import { scanProject } from '../services/scanner.ts'
import { buildExport, renderExportMarkdown } from '../services/exporter.ts'
import { openInEditor } from '../services/launcher.ts'
import { normalizePath } from '../config.ts'

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects', async () => listProjects())

  // Resolve a project by its filesystem path — used by the CLI to identify "this" project.
  app.get('/projects/resolve', async (req, reply) => {
    const path = (req.query as { path?: string }).path
    if (!path) return reply.code(400).send({ error: 'path query parameter required' })
    const project = getProjectByPath(normalizePath(path))
    if (!project) return reply.code(404).send({ error: 'No project registered at that path' })
    return project
  })

  app.get('/projects/:id', async (req, reply) => {
    const project = getProject(Number((req.params as { id: string }).id))
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    return project
  })

  app.post('/projects', async (req, reply) => {
    const body = req.body as { name?: string; path?: string; description?: string; status?: never }
    if (!body?.name || !body?.path) {
      return reply.code(400).send({ error: 'name and path are required' })
    }
    const path = normalizePath(body.path)
    if (getProjectByPath(path)) {
      return reply.code(409).send({ error: 'A project is already registered at that path' })
    }
    const created = createProject({ name: body.name, path, description: body.description })
    if (existsSync(created.path)) {
      await scanProject(created.id, created.path, created.description)
    }
    return reply.code(201).send(getProject(created.id))
  })

  app.patch('/projects/:id', async (req, reply) => {
    const project = updateProject(
      Number((req.params as { id: string }).id),
      req.body as Record<string, never>
    )
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    return project
  })

  app.delete('/projects/:id', async (req) => {
    deleteProject(Number((req.params as { id: string }).id))
    return { ok: true }
  })

  app.post('/projects/:id/scan', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const project = getProject(id)
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    await scanProject(id, project.path, project.description)
    return getProject(id)
  })

  app.post('/projects/:id/open', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const project = getProject(id)
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    openInEditor(project.path)
    touchOpened(id)
    return { ok: true }
  })

  // JSON export consumed by the CLI / agents.
  app.get('/projects/:id/export', async (req, reply) => {
    const data = buildExport(Number((req.params as { id: string }).id))
    if (!data) return reply.code(404).send({ error: 'Project not found' })
    return data
  })

  app.get('/projects/:id/export.md', async (req, reply) => {
    const data = buildExport(Number((req.params as { id: string }).id))
    if (!data) return reply.code(404).send({ error: 'Project not found' })
    reply.type('text/markdown; charset=utf-8')
    return renderExportMarkdown(data)
  })
}
