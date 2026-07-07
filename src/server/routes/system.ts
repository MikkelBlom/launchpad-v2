import type { FastifyInstance } from 'fastify'
import { getSettings, updateSettings } from '../repo/settings.ts'
import { discoverProjects, scanAll } from '../services/scanner.ts'
import { importOldLaunchpad } from '../services/importer.ts'
import { getPort } from '../config.ts'

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ ok: true, service: 'launchpad', port: getPort() }))

  app.get('/settings', async () => getSettings())

  app.put('/settings', async (req) => updateSettings(req.body as Record<string, never>))

  // Discover new projects under the configured roots, then rescan everything.
  app.post('/scan', async () => {
    const result = await discoverProjects()
    return result
  })

  // Rescan existing projects only (no discovery).
  app.post('/rescan', async () => {
    await scanAll()
    return { ok: true }
  })

  // Import projects from the original Launchpad's registry, relocating stale paths.
  app.post('/import/old-launchpad', async (req, reply) => {
    try {
      const registryPath = (req.body as { registryPath?: string } | undefined)?.registryPath
      return await importOldLaunchpad(registryPath)
    } catch (error) {
      return reply.code(400).send({
        error: String(error instanceof Error ? error.message : error)
      })
    }
  })
}
