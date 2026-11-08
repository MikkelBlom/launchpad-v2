import type { FastifyInstance } from 'fastify'
import { applyPush, PlanError } from '../services/agentPush.ts'
import { applyReport, ReportError } from '../services/sessionReport.ts'
import { auditAll, auditProject } from '../services/audit.ts'
import { renderAgentPrompt, writeAgentInstructions } from '../services/agentDocs.ts'
import { onboardAllProjects, onboardProject, OnboardError } from '../services/onboarding.ts'
import { listChanges } from '../repo/changes.ts'
import { getProject } from '../repo/projects.ts'
import { provenanceFrom } from '../services/provenance.ts'
import type { PushPlan, WriteSource } from '../../shared/types.ts'

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  // Batch apply an agent-authored plan. `?dryRun=true` previews without committing.
  app.post('/projects/:id/push', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const dryRun = String((req.query as { dryRun?: string }).dryRun ?? '') === 'true'
    try {
      return applyPush(id, (req.body ?? {}) as PushPlan, provenanceFrom(req), { dryRun })
    } catch (error) {
      if (error instanceof PlanError) return reply.code(400).send({ error: error.message })
      throw error
    }
  })

  // End-of-session handoff: decisions/deferred → needs-mikkel tasks, the report → one note.
  // Runs through applyPush, so `?dryRun=true` is the same transaction, rolled back.
  app.post('/projects/:id/report', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const dryRun = String((req.query as { dryRun?: string }).dryRun ?? '') === 'true'
    try {
      return applyReport(id, req.body, provenanceFrom(req), { dryRun })
    } catch (error) {
      if (error instanceof ReportError || error instanceof PlanError) {
        return reply.code(400).send({ error: error.message })
      }
      throw error
    }
  })

  app.get('/audit', async () => auditAll())

  app.get('/projects/:id/audit', async (req, reply) => {
    const audit = auditProject(Number((req.params as { id: string }).id))
    if (!audit) return reply.code(404).send({ error: 'Project not found' })
    return audit
  })

  // Paste-into-a-chat prompt that names this project explicitly.
  app.get('/projects/:id/agent-prompt', async (req, reply) => {
    const project = getProject(Number((req.params as { id: string }).id))
    if (!project) return reply.code(404).send({ error: 'Project not found' })
    return { prompt: renderAgentPrompt(project) }
  })

  // Write (or refresh) the Launchpad block in the project's ai-instructions/CLAUDE.md.
  app.post('/projects/:id/agent-instructions', async (req, reply) => {
    try {
      const result = writeAgentInstructions(Number((req.params as { id: string }).id))
      if (!result) return reply.code(404).send({ error: 'Project not found' })
      return result
    } catch (error) {
      return reply.code(400).send({ error: String(error instanceof Error ? error.message : error) })
    }
  })

  // One-click equivalent of running `launchpad onboard` inside the project folder:
  // binding + CLAUDE.md block + LAUNCHPAD.md snapshot, all written server-side.
  app.post('/projects/:id/onboard', async (req, reply) => {
    try {
      return onboardProject(Number((req.params as { id: string }).id))
    } catch (error) {
      if (error instanceof OnboardError) return reply.code(error.status).send({ error: error.message })
      return reply.code(500).send({ error: String(error instanceof Error ? error.message : error) })
    }
  })

  // Every project that isn't onboarded yet. Per-project failures come back in `failed`
  // rather than aborting the batch.
  app.post('/onboard-all', async () => onboardAllProjects())

  app.get('/changes', async (req) => {
    const query = req.query as { limit?: string; projectId?: string; source?: string }
    return listChanges({
      limit: query.limit ? Number(query.limit) : undefined,
      projectId: query.projectId ? Number(query.projectId) : undefined,
      source: query.source as WriteSource | undefined
    })
  })
}
