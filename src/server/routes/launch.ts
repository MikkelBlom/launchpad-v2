import type { FastifyInstance } from 'fastify'
import {
  createLaunchProfile,
  deleteLaunchProfile,
  listLaunchProfiles,
  updateLaunchProfile
} from '../repo/launchProfiles.ts'
import { getProject } from '../repo/projects.ts'
import { openFolder, openTerminal, openUrl, runLaunchProfile, gitRemoteToHttps } from '../services/launcher.ts'
import {
  createCapture,
  deleteCapture,
  listCaptures,
  setCaptureProcessed
} from '../repo/captures.ts'
import type { CaptureKind, LaunchKind } from '../../shared/types.ts'

export async function launchRoutes(app: FastifyInstance): Promise<void> {
  // ---- Launch profiles ----
  app.get('/projects/:id/launch', async (req) =>
    listLaunchProfiles(Number((req.params as { id: string }).id))
  )

  app.post('/projects/:id/launch', async (req, reply) => {
    const body = req.body as { name?: string; kind?: LaunchKind; value?: string; cwd?: string }
    const profile = createLaunchProfile({
      projectId: Number((req.params as { id: string }).id),
      name: body.name ?? 'Launch',
      kind: body.kind ?? 'shell',
      value: body.value ?? '',
      cwd: body.cwd
    })
    return reply.code(201).send(profile)
  })

  app.patch('/launch/:id', async (req, reply) => {
    const profile = updateLaunchProfile(
      Number((req.params as { id: string }).id),
      req.body as Record<string, never>
    )
    if (!profile) return reply.code(404).send({ error: 'Launch profile not found' })
    return profile
  })

  app.delete('/launch/:id', async (req) => {
    deleteLaunchProfile(Number((req.params as { id: string }).id))
    return { ok: true }
  })

  app.post('/launch/:id/run', async (req, reply) => {
    try {
      runLaunchProfile(Number((req.params as { id: string }).id))
      return { ok: true }
    } catch (error) {
      return reply.code(400).send({ error: String(error instanceof Error ? error.message : error) })
    }
  })

  // ---- One-off open helpers (folder / GitHub) ----
  app.post('/projects/:id/open-folder', async (req, reply) => {
    const project = getProject(Number((req.params as { id: string }).id))
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    openFolder(project.path)
    return { ok: true }
  })

  app.post('/projects/:id/open-terminal', async (req, reply) => {
    const project = getProject(Number((req.params as { id: string }).id))
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    openTerminal(project.path)
    return { ok: true }
  })

  app.post('/projects/:id/open-github', async (req, reply) => {
    const project = getProject(Number((req.params as { id: string }).id))
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    const url = gitRemoteToHttps(project.git.remoteUrl)
    if (!url) return reply.code(400).send({ error: 'No GitHub remote for this project' })
    openUrl(url)
    return { ok: true }
  })

  // ---- Captures (quick-capture inbox) ----
  app.get('/captures', async (req) => {
    const includeProcessed = (req.query as { all?: string }).all === '1'
    return listCaptures(includeProcessed)
  })

  app.post('/captures', async (req, reply) => {
    const body = req.body as { projectId?: number | null; kind?: CaptureKind; text?: string; url?: string }
    if (!body.text || !body.text.trim()) {
      return reply.code(400).send({ error: 'text is required' })
    }
    const capture = createCapture({
      projectId: body.projectId ?? null,
      kind: body.kind ?? 'note',
      text: body.text.trim(),
      url: body.url
    })
    return reply.code(201).send(capture)
  })

  app.patch('/captures/:id', async (req) => {
    setCaptureProcessed(
      Number((req.params as { id: string }).id),
      (req.body as { processed?: boolean }).processed ?? true
    )
    return { ok: true }
  })

  app.delete('/captures/:id', async (req) => {
    deleteCapture(Number((req.params as { id: string }).id))
    return { ok: true }
  })
}
