import type { FastifyRequest } from 'fastify'
import type { Provenance, WriteSource } from '../../shared/types.ts'

const SOURCES: WriteSource[] = ['ui', 'cli', 'agent', 'import']

// Callers declare who they are with headers rather than body fields, so every endpoint
// gets provenance for free. The CLI sends `agent` on behalf of whatever is driving it.
export function provenanceFrom(req: FastifyRequest): Provenance {
  const headers = req.headers as Record<string, string | string[] | undefined>
  const rawSource = String(headers['x-launchpad-source'] ?? '').toLowerCase()
  const source = (SOURCES as string[]).includes(rawSource) ? (rawSource as WriteSource) : 'ui'
  const actor = String(headers['x-launchpad-actor'] ?? '').slice(0, 60)
  return { source, actor }
}
