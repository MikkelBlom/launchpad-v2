import type { FastifyInstance } from 'fastify'
import { getSettings, updateSettings } from '../repo/settings.ts'
import { discoverProjects, scanAll } from '../services/scanner.ts'
import { importOldLaunchpad } from '../services/importer.ts'
import { exportAll, importAll, type BackupData } from '../services/backup.ts'
import { openFolder } from '../services/launcher.ts'
import { getDataDir, getPort } from '../config.ts'
import { nowIso } from '../db/database.ts'

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  // `apiVersion` lets an agent CLI detect a Launchpad older than the commands it knows.
  app.get('/health', async () => ({
    ok: true,
    service: 'launchpad',
    port: getPort(),
    apiVersion: 3
  }))

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

  app.get('/data-dir', async () => ({ dataDir: getDataDir() }))

  app.post('/open-data-folder', async () => {
    openFolder(getDataDir())
    return { ok: true }
  })

  // Full-database JSON backup + restore.
  app.get('/backup', async (_req, reply) => {
    reply.header('Content-Disposition', 'attachment; filename="launchpad-backup.json"')
    return exportAll(nowIso())
  })

  app.post('/restore', async (req, reply) => {
    try {
      return importAll(req.body as BackupData)
    } catch (error) {
      return reply.code(400).send({ error: String(error instanceof Error ? error.message : error) })
    }
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
