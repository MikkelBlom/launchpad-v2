import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const webRoot = fileURLToPath(new URL('./src/web', import.meta.url))
const outDir = fileURLToPath(new URL('./dist/web', import.meta.url))

// The web dev server runs on 7421 and proxies /api to the Fastify service on 7420.
// In production the Fastify service serves the built assets from dist/web directly.
//
// The API port is overridable because the stable app and the dev window share one live
// database (see ai-instructions/CLAUDE.md): the only safe way to try a migration or a bulk
// change is a second service on a copied LAUNCHPAD_DATA_DIR, and the UI has to be able to
// reach it. `set LAUNCHPAD_API_PORT=7439 && npm run web`.
const apiPort = Number(process.env.LAUNCHPAD_API_PORT) || 7420
export default defineConfig({
  root: webRoot,
  base: './',
  plugins: [react()],
  server: {
    port: 7421,
    strictPort: true,
    // Allow importing shared types from ../shared (outside the web root).
    fs: {
      allow: [fileURLToPath(new URL('.', import.meta.url))]
    },
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir,
    emptyOutDir: true
  }
})
