import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance, FastifyReply } from 'fastify'
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
import { buildExport, renderExportMarkdown, writeExportToProject } from '../services/exporter.ts'
import { openInEditor, openUrl } from '../services/launcher.ts'
import { provenanceFrom } from '../services/provenance.ts'
import { recordChange } from '../repo/changes.ts'
import {
  findRelocateCandidates,
  RelocateError,
  relocateProject,
  renameProjectFolder
} from '../services/relocate.ts'
import { normalizeLiveUrl } from '../services/vercel.ts'
import { normalizePath } from '../config.ts'
import type { ProjectStatus } from '../../shared/types.ts'

// Relocating touches the filesystem, so its failures are expected outcomes with messages
// worth showing the user verbatim rather than 500s.
function failRelocate(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof RelocateError) return reply.code(error.status).send({ error: error.message })
  return reply.code(500).send({ error: String(error instanceof Error ? error.message : error) })
}

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects', async () => listProjects())

  // Bulk operations over many projects at once (archive/status/favorite, or delete).
  app.post('/projects/bulk', async (req) => {
    const body = req.body as {
      ids?: number[]
      patch?: { status?: ProjectStatus; isFavorite?: boolean }
    }
    const ids = body.ids ?? []
    for (const id of ids) updateProject(id, body.patch ?? {})
    return { ok: true, count: ids.length }
  })

  app.post('/projects/bulk-delete', async (req) => {
    const ids = (req.body as { ids?: number[] }).ids ?? []
    for (const id of ids) deleteProject(id)
    return { ok: true, count: ids.length }
  })

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
    const id = Number((req.params as { id: string }).id)
    const patch = (req.body ?? {}) as Record<string, unknown>
    const project = updateProject(id, patch)
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    recordChange({
      provenance: provenanceFrom(req),
      projectId: id,
      entityType: 'project',
      entityId: id,
      action: 'updated',
      summary: Object.keys(patch).join(', ')
    })
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

  // Open the project's live deployment in the default browser.
  app.post('/projects/:id/open-live', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const project = getProject(id)
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    const url = normalizeLiveUrl(project.liveUrl)
    if (!url) {
      return reply.code(400).send({ error: 'No usable live URL is set for this project' })
    }
    openUrl(url)
    touchOpened(id)
    return { ok: true }
  })

  // ---- Moved / renamed folders ----
  // The display name and the folder on disk are separate: renaming a project in Launchpad
  // never touches the filesystem. These three endpoints cover the other direction.

  // "Where did it go?" — folders under the configured roots that look like this project.
  app.get('/projects/:id/relocate/candidates', async (req, reply) => {
    try {
      return await findRelocateCandidates(Number((req.params as { id: string }).id))
    } catch (error) {
      return failRelocate(reply, error)
    }
  })

  // "I moved it myself, here's where it is now."
  app.post('/projects/:id/relocate', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const path = (req.body as { path?: string } | undefined)?.path ?? ''
    try {
      const project = await relocateProject(id, path)
      recordChange({
        provenance: provenanceFrom(req),
        projectId: id,
        entityType: 'project',
        entityId: id,
        action: 'updated',
        summary: `relocated to ${project.path}`
      })
      return project
    } catch (error) {
      return failRelocate(reply, error)
    }
  })

  // Rename the folder on disk and the stored path in one operation, so they cannot drift.
  app.post('/projects/:id/rename-folder', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const folderName = (req.body as { folderName?: string } | undefined)?.folderName ?? ''
    try {
      const project = await renameProjectFolder(id, folderName)
      recordChange({
        provenance: provenanceFrom(req),
        projectId: id,
        entityType: 'project',
        entityId: id,
        action: 'updated',
        summary: `renamed folder on disk to ${project.path}`
      })
      return project
    } catch (error) {
      return failRelocate(reply, error)
    }
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

  app.get('/projects/:id/readme', async (req, reply) => {
    const project = getProject(Number((req.params as { id: string }).id))
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    try {
      const name = readdirSync(project.path).find((n) => n.toLowerCase() === 'readme.md')
      if (!name) return { content: '' }
      return { content: readFileSync(join(project.path, name), 'utf-8') }
    } catch {
      return { content: '' }
    }
  })

  // Write the snapshot into the project's ai-instructions/LAUNCHPAD.md (UI "Export" button).
  app.post('/projects/:id/export-file', async (req, reply) => {
    const result = writeExportToProject(Number((req.params as { id: string }).id))
    if (!result) return reply.code(404).send({ error: 'Project not found' })
    return result
  })
}
