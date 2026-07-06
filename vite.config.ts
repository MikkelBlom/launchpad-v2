import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const webRoot = fileURLToPath(new URL('./src/web', import.meta.url))
const outDir = fileURLToPath(new URL('./dist/web', import.meta.url))

// The web dev server runs on 7421 and proxies /api to the Fastify service on 7420.
// In production the Fastify service serves the built assets from dist/web directly.
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
        target: 'http://localhost:7420',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir,
    emptyOutDir: true
  }
})
