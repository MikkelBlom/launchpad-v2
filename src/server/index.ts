import { getPort } from './config.ts'
import { startServer } from './app.ts'

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
