import { exec } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { simpleGit } from 'simple-git'
import { createProject, getProject, getProjectByPath } from '../repo/projects.ts'
import { createLaunchProfile } from '../repo/launchProfiles.ts'
import { defaultProfilesFor } from './launcher.ts'
import { detectStack, readGitInfo, scanProject } from './scanner.ts'
import type { Project } from '../../shared/types.ts'

const execAsync = promisify(exec)

function sanitizeFolderName(name: string): string {
  return name.replace(/[<>:"/\\|?*]+/g, '').trim()
}

function renderClaudeMd(name: string, description: string): string {
  return `# ${name}

${description || 'Project description goes here.'}

## Working with Launchpad

This project is tracked in **Launchpad**. Notes, ideas, and tasks live in Launchpad's
database — not in this repo. To pull the latest into \`ai-instructions/LAUNCHPAD.md\`,
run from the project root:

\`\`\`
launchpad pull
\`\`\`

(That reads from the local Launchpad service at http://localhost:7420.)
`
}

export interface ScaffoldInput {
  name: string
  parentPath: string
  description?: string
  initGit?: boolean
  createGithub?: boolean
  githubPrivate?: boolean
}

export interface ScaffoldResult {
  project: Project
  path: string
  gitInitialized: boolean
  githubCreated: boolean
  warnings: string[]
}

export async function scaffoldProject(input: ScaffoldInput): Promise<ScaffoldResult> {
  const warnings: string[] = []
  const folderName = sanitizeFolderName(input.name)
  if (!folderName) throw new Error('Invalid project name')
  if (!input.parentPath || !existsSync(input.parentPath)) {
    throw new Error('Parent folder does not exist')
  }

  const projectPath = join(input.parentPath, folderName)
  if (existsSync(projectPath) && readdirSync(projectPath).length > 0) {
    throw new Error('A non-empty folder with that name already exists there')
  }
  if (getProjectByPath(projectPath)) {
    throw new Error('A project is already registered at that path')
  }

  mkdirSync(join(projectPath, 'ai-instructions'), { recursive: true })

  const description = input.description ?? ''
  writeFileSync(join(projectPath, 'README.md'), `# ${input.name}\n\n${description}\n`, 'utf-8')
  writeFileSync(join(projectPath, '.gitignore'), 'node_modules/\ndist/\n.env\n*.log\n', 'utf-8')
  writeFileSync(
    join(projectPath, 'ai-instructions', 'CLAUDE.md'),
    renderClaudeMd(input.name, description),
    'utf-8'
  )
  writeFileSync(
    join(projectPath, 'ai-instructions', 'LAUNCHPAD.md'),
    '# Launchpad snapshot\n\n_Run `launchpad pull` to fetch notes, ideas, and tasks from Launchpad._\n',
    'utf-8'
  )

  let gitInitialized = false
  if (input.initGit !== false) {
    try {
      const git = simpleGit(projectPath)
      await git.init()
      await git.add('.')
      await git.commit('Initial commit (scaffolded by Launchpad)')
      gitInitialized = true
    } catch (error) {
      warnings.push(`git init failed: ${String(error)}`)
    }
  }

  let githubCreated = false
  if (input.createGithub) {
    const visibility = input.githubPrivate === false ? '--public' : '--private'
    try {
      await execAsync(
        `gh repo create "${folderName}" ${visibility} --source . --remote origin --push`,
        { cwd: projectPath }
      )
      githubCreated = true
    } catch (error) {
      warnings.push(`GitHub repo creation failed (is gh installed and authenticated?): ${String(error)}`)
    }
  }

  const created = createProject({ name: input.name, path: projectPath, description })
  await scanProject(created.id, projectPath, description)

  const git = await readGitInfo(projectPath)
  const stack = detectStack(projectPath)
  for (const profile of defaultProfilesFor(stack, git.remoteUrl)) {
    createLaunchProfile({
      projectId: created.id,
      name: profile.name,
      kind: profile.kind,
      value: profile.value
    })
  }

  return {
    project: getProject(created.id)!,
    path: projectPath,
    gitInitialized,
    githubCreated,
    warnings
  }
}
