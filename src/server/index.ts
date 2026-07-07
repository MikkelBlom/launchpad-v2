import { getPort } from './config.ts'
import { startServer } from './app.ts'
import { closeDb } from './db/database.ts'

startServer()
  .then(() => {
    // eslint-disable-next-line no-console
    console.log(`Launchpad service running at http://localhost:${getPort()}`)
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to start Launchpad service:', err)
    process.exit(1)
  })

// Close the database cleanly on graceful signals (best-effort).
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    closeDb()
    process.exit(0)
  })
}
