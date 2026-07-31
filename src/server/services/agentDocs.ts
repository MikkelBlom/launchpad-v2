import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPort } from '../config.ts'
import { getProject } from '../repo/projects.ts'
import type { Project } from '../../shared/types.ts'

const BEGIN = '<!-- launchpad:begin -->'
const END = '<!-- launchpad:end -->'

function baseUrl(): string {
  return `http://localhost:${getPort()}`
}

/**
 * The block written into a project's ai-instructions/CLAUDE.md. Its whole job is to make
 * an agent that opens this repo — with no other context — know that Launchpad exists,
 * which project this is, and how to read and write it.
 */
export function renderClaudeBlock(project: Project): string {
  return `${BEGIN}
## Launchpad

This project is tracked in **Launchpad**, a local service on ${baseUrl()} that owns
Mikkel's notes, ideas, and tasks for every project. **It is Launchpad project #${project.id} ("${project.name}").**
Launchpad's database is the source of truth — not the markdown in this repo.

\`\`\`bash
launchpad pull --json      # read this project's tasks/ideas/notes (nothing written to disk)
launchpad guide            # the full command set, with the push-plan schema
\`\`\`

Every \`launchpad\` command run inside this folder targets project #${project.id} automatically.
Write back with \`launchpad task add "…"\`, \`launchpad idea add "…"\`, \`launchpad note add "…"\`,
\`launchpad set description "…"\`, \`launchpad tag add <name>\`, or a batch \`launchpad push plan.json\`.

**Dev server ports.** ${
    project.ports.length > 0
      ? `This project runs on ${project.ports
          .map((claim) => `**http://localhost:${claim.port}**${claim.label ? ` (${claim.label})` : ''}`)
          .join(' and ')}. Use ${project.ports.length > 1 ? 'those ports' : 'that port'} when you start or configure its dev server${project.ports.length > 1 ? 's' : ''} — don't invent a new one. A process this project runs that isn't listed above needs its own claim: \`launchpad ports add <n> --label "<what it is>"\`.`
      : `This project has no port claimed yet. Before configuring a dev server, run \`launchpad ports free\` to get ports that are actually available, pick one, and claim it with \`launchpad ports add <n>\` so it shows up in Launchpad and nothing else takes it. One claim per process the project runs.`
  } A port another project already claims is refused, naming the project that holds it — ask for a free one rather than forcing it. Never assume a port is free because nothing is listening on it: \`launchpad ports free\` is the only list that accounts for what other projects have claimed.

\`ai-instructions/LAUNCHPAD.md\` is a **read-only mirror** — editing it changes nothing.
Agents archive rather than delete; nothing you do here is unrecoverable.
${END}`
}

/**
 * The block Mikkel copies out of the UI and pastes into a fresh agent session. It names
 * the project explicitly so the agent never has to pick one from a list.
 */
export function renderAgentPrompt(project: Project): string {
  return `This project is tracked in Launchpad (local service on ${baseUrl()}) as project #${project.id} — "${project.name}", at ${project.path}.

Run \`launchpad guide\` first for the full command set. Then:
1. \`launchpad pull --json --project ${project.id}\` to see what Launchpad already has.
2. \`launchpad audit --project ${project.id}\` to see what's missing.
3. \`launchpad log --project ${project.id}\` to see what has changed recently — the user may
   have renamed, merged or edited things since anyone last looked.
4. Read this repo (README, ai-instructions/*, TODOs in code) and fill the gaps: a real
   description, tags, open tasks, ideas, and notes worth keeping. Ground everything in what
   the repo actually says is unfinished; don't invent work.
5. Write the plan to a temp file (not into the repo), preview it with
   \`launchpad push <plan.json> --project ${project.id} --dry-run\`, then apply without --dry-run.

Push is merge-only and idempotent — it never deletes, and re-running it updates instead of
duplicating. Archive instead of deleting.

If this project runs a dev server, also claim its port: \`launchpad ports free\` to see what is
actually available, then \`launchpad ports add <n> --project ${project.id}\` — once per process it
runs, with \`--label\` to say which is which. A port another project already holds is refused, and
the refusal names the project holding it.`
}

export interface WriteInstructionsResult {
  path: string
  action: 'created' | 'updated'
}

// Insert or refresh the Launchpad block in the project's ai-instructions/CLAUDE.md,
// leaving everything the user wrote around it untouched.
export function writeAgentInstructions(projectId: number): WriteInstructionsResult | null {
  const project = getProject(projectId)
  if (!project) return null
  if (!existsSync(project.path)) throw new Error(`Project folder does not exist: ${project.path}`)

  const dir = join(project.path, 'ai-instructions')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = join(dir, 'CLAUDE.md')
  const block = renderClaudeBlock(project)

  if (!existsSync(file)) {
    writeFileSync(file, `# ${project.name}\n\n${project.description}\n\n${block}\n`, 'utf-8')
    return { path: file, action: 'created' }
  }

  const current = readFileSync(file, 'utf-8')
  const start = current.indexOf(BEGIN)
  const end = current.indexOf(END)
  if (start !== -1 && end !== -1 && end > start) {
    const next = current.slice(0, start) + block + current.slice(end + END.length)
    writeFileSync(file, next, 'utf-8')
    return { path: file, action: 'updated' }
  }
  writeFileSync(file, `${current.trimEnd()}\n\n${block}\n`, 'utf-8')
  return { path: file, action: 'updated' }
}
