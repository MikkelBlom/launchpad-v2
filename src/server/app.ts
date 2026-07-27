import { existsSync } from 'node:fs'
import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import { getPort, getWebDistDir } from './config.ts'
import { getDb } from './db/database.ts'
import { getSettings } from './repo/settings.ts'
import { scanAll } from './services/scanner.ts'
import { projectRoutes } from './routes/projects.ts'
import { contentRoutes } from './routes/content.ts'
import { launchRoutes } from './routes/launch.ts'
import { systemRoutes } from './routes/system.ts'
import { scaffoldRoutes } from './routes/scaffold.ts'
import { tagRoutes } from './routes/tags.ts'
import { insightRoutes } from './routes/insights.ts'
import { agentRoutes } from './routes/agent.ts'
import { vercelRoutes } from './routes/vercel.ts'

export async function createServer(): Promise<FastifyInstance> {
  getDb() // open connection + run migrations up front
  const app = Fastify({ logger: false })
  await app.register(cors, { origin: true })

  // Tolerate empty JSON bodies: many endpoints are bodyless POSTs (scan, open, run…).
  // The default parser rejects an empty body with 400, so treat empty as `undefined`.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, bodyStr, done) => {
    const trimmed = (bodyStr as string).trim()
    if (!trimmed) {
      done(null, undefined)
      return
    }
    try {
      done(null, JSON.parse(trimmed))
    } catch (err) {
      ;(err as { statusCode?: number }).statusCode = 400
      done(err as Error, undefined)
    }
  })

  await app.register(
    async (api) => {
      await projectRoutes(api)
      await contentRoutes(api)
      await launchRoutes(api)
      await systemRoutes(api)
      await scaffoldRoutes(api)
      await tagRoutes(api)
      await insightRoutes(api)
      await agentRoutes(api)
      await vercelRoutes(api)
    },
    { prefix: '/api' }
  )

  // In production Fastify serves the built UI from dist/web. In dev, Vite serves it
  // on :7421 and proxies /api here, so this block simply does nothing.
  const webDist = getWebDistDir()
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist })
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) {
        void reply.code(404).send({ error: 'Not found' })
        return
      }
      void reply.sendFile('index.html')
    })
  }

  return app
}

export async function startServer(): Promise<FastifyInstance> {
  const app = await createServer()
  await app.listen({ port: getPort(), host: '127.0.0.1' })
  if (getSettings().scanOnStartup) {
    scanAll().catch(() => {
      /* best-effort background scan */
    })
  }
  return app
}
