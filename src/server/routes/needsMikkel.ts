import type { FastifyInstance } from 'fastify'
import { listNeedsMikkel, NEEDS_MIKKEL_TAG, needsMikkelCount } from '../services/needsMikkel.ts'

// Read-only. Acting on an item (done / archive) goes through the existing item endpoints,
// which already carry provenance and write the change log.
export async function needsMikkelRoutes(app: FastifyInstance): Promise<void> {
  app.get('/needs-mikkel', async () => listNeedsMikkel())

  app.get('/needs-mikkel/count', async () => ({ tag: NEEDS_MIKKEL_TAG, count: needsMikkelCount() }))
}
