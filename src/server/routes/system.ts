import { statSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { getSettings, updateSettings } from '../repo/settings.ts'
import { discoverProjects, scanAll } from '../services/scanner.ts'
import { importOldLaunchpad } from '../services/importer.ts'
import { exportAll, importAll, type BackupData } from '../services/backup.ts'
import { openFolder } from '../services/launcher.ts'
import { pickFolder } from '../services/folderPicker.ts'
import { getDataDir, getPort } from '../config.ts'
import { nowIso } from '../db/database.ts'

// When the bundle this process is running was written. The desktop shell compares it against
// dist/server/index.js on disk: a server older than the build it is meant to be serving is
// the failure that shows up as a white window — new UI, old API — and it is invisible from
// inside the app. Zero when the path can't be read (running from source, odd argv).
const BUILD_TIME = (() => {
  try {
    return Math.round(statSync(process.argv[1]).mtimeMs)
  } catch {
    return 0
  }
})()

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  // `apiVersion` lets an agent CLI (and the web UI) detect a Launchpad older than the
  // commands it knows; `buildTime` lets the shell detect one older than the files on disk.
  app.get('/health', async () => ({
    ok: true,
    service: 'launchpad',
    port: getPort(),
    // 5 — a project claims many ports (`project_ports`); /api/ports returns claims, not
    // one row per project, and claiming refuses reserved/taken ports.
    apiVersion: 5,
    buildTime: BUILD_TIME
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

  // Open a native folder chooser on the machine running the service, so the UI never has
  // to make the user type a path. Blocks until the user answers; `null` means cancelled,
  // timed out, or unsupported platform — the UI falls back to typing.
  app.post('/pick-folder', async (req) => {
    const title = (req.body as { title?: string } | undefined)?.title
    return { path: await pickFolder(typeof title === 'string' ? title : undefined) }
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
