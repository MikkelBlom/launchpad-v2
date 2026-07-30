import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getPort } from '../config.ts'
import { getProject, listProjects } from '../repo/projects.ts'
import { writeAgentInstructions } from './agentDocs.ts'
import { writeExportToProject } from './exporter.ts'
import type { OnboardResult, Project } from '../../shared/types.ts'

// Onboarding writes into a real folder on disk, so its failures are ordinary outcomes
// (the folder moved, or was deleted) with messages worth showing verbatim, not 500s.
export class OnboardError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'OnboardError'
    this.status = status
  }
}

const BINDING_FILE = join('ai-instructions', '.launchpad.json')

// Same shape the CLI's `writeBinding` produces — this file is what makes a bare
// `launchpad pull` inside the folder resolve to this project.
//
// `path` records the folder this binding was written for. Ids move (see isOnboarded in
// repo/projects.ts), so the CLI treats `projectId` as a cache and uses `path` to tell a stale id
// apart from a binding that was copied into a different repo. Re-running onboarding rewrites the
// file, which is how a stale id gets corrected.
function writeBinding(project: Project): string {
  const file = join(project.path, BINDING_FILE)
  mkdirSync(dirname(file), { recursive: true })
  const binding = {
    projectId: project.id,
    name: project.name,
    path: project.path,
    url: `http://localhost:${getPort()}`
  }
  writeFileSync(file, `${JSON.stringify(binding, null, 2)}\n`, 'utf-8')
  return file
}

/**
 * Everything `launchpad onboard` does, without a terminal: bind the folder, insert the
 * Launchpad block into ai-instructions/CLAUDE.md, and write the LAUNCHPAD.md snapshot.
 * Re-running it is safe — each of the three writes replaces its own file/block in place.
 */
export function onboardProject(projectId: number): OnboardResult {
  const project = getProject(projectId)
  if (!project) throw new OnboardError('Project not found', 404)
  // Never create directories for a folder that is gone — that would scatter empty
  // ai-instructions folders at stale paths instead of surfacing the real problem.
  if (!project.pathExists) {
    throw new OnboardError(
      `The folder ${project.path} does not exist, so there is nothing to onboard. ` +
        'Point Launchpad at its current location first.'
    )
  }

  const bindingPath = writeBinding(project)
  const instructions = writeAgentInstructions(project.id)
  if (!instructions) throw new OnboardError('Project not found', 404)
  const snapshot = writeExportToProject(project.id)
  if (!snapshot) throw new OnboardError('Project not found', 404)

  return {
    projectId: project.id,
    name: project.name,
    bindingPath,
    instructionsPath: instructions.path,
    snapshotPath: snapshot.path
  }
}

export interface OnboardFailure {
  projectId: number
  name: string
  error: string
}

export interface OnboardAllResult {
  onboarded: OnboardResult[]
  failed: OnboardFailure[]
}

/**
 * Onboard every project that isn't already. One unreachable folder must not cost the user
 * the other twenty-four, so each project's failure is collected and reported instead of
 * thrown.
 */
export function onboardAllProjects(): OnboardAllResult {
  const onboarded: OnboardResult[] = []
  const failed: OnboardFailure[] = []
  for (const project of listProjects()) {
    if (project.onboarded) continue
    // Archived projects are deliberately skipped: onboarding writes files into the repo,
    // and a repo the user has shelved shouldn't grow new files behind their back. Onboard
    // one explicitly from its own page if you want it.
    if (project.status === 'archived') continue
    try {
      onboarded.push(onboardProject(project.id))
    } catch (error) {
      failed.push({
        projectId: project.id,
        name: project.name,
        error: String(error instanceof Error ? error.message : error)
      })
    }
  }
  return { onboarded, failed }
}
