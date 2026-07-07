import { spawn } from 'node:child_process'
import { isAbsolute, join } from 'node:path'
import {
  createLaunchProfile,
  getLaunchProfile,
  listLaunchProfiles
} from '../repo/launchProfiles.ts'
import { getProject, touchOpened } from '../repo/projects.ts'
import { getSettings } from '../repo/settings.ts'

// All launches are fire-and-forget: detached, output ignored, parent unref'd so the
// Launchpad service never blocks on or owns the spawned process.
function runShell(commandLine: string, cwd?: string): void {
  const child = spawn(commandLine, { cwd, shell: true, detached: true, stdio: 'ignore' })
  child.unref()
}

export function openUrl(url: string): void {
  runShell(`start "" "${url}"`)
}

export function openFolder(path: string): void {
  runShell(`start "" "${path}"`)
}

export function openInEditor(path: string): void {
  const editor = getSettings().defaultEditor || 'code'
  runShell(`${editor} "${path}"`, path)
}

// Turn a git remote (ssh or https, with or without .git) into a browsable URL.
export function gitRemoteToHttps(remote: string | null): string | null {
  if (!remote) return null
  let url = remote.trim()
  const sshMatch = url.match(/^git@([^:]+):(.+)$/)
  if (sshMatch) {
    url = `https://${sshMatch[1]}/${sshMatch[2]}`
  }
  url = url.replace(/\.git$/, '')
  return url.startsWith('http') ? url : null
}

function resolveTarget(value: string, projectPath: string): string {
  if (!value) return projectPath
  return isAbsolute(value) ? value : join(projectPath, value)
}

export function runLaunchProfile(id: number): void {
  const profile = getLaunchProfile(id)
  if (!profile) throw new Error(`Launch profile ${id} not found`)
  const project = getProject(profile.projectId)
  if (!project) throw new Error(`Project ${profile.projectId} not found`)

  const cwd = profile.cwd ? resolveTarget(profile.cwd, project.path) : project.path

  switch (profile.kind) {
    case 'vscode': {
      const editor = getSettings().defaultEditor || 'code'
      runShell(`${editor} "${resolveTarget(profile.value, project.path)}"`, cwd)
      break
    }
    case 'folder':
      openFolder(resolveTarget(profile.value, project.path))
      break
    case 'url':
      openUrl(profile.value)
      break
    case 'shell':
      // Open a visible, persistent terminal window running the command.
      runShell(`start "${profile.name || 'Launchpad'}" cmd /k "${profile.value}"`, cwd)
      break
    default:
      throw new Error(`Unknown launch kind: ${profile.kind}`)
  }

  touchOpened(project.id)
}

// Default launch profiles seeded for a freshly discovered/created project.
export interface SeedProfile {
  name: string
  kind: 'vscode' | 'shell' | 'url' | 'folder'
  value: string
}

export function defaultProfilesFor(stack: string[], remoteUrl: string | null): SeedProfile[] {
  const profiles: SeedProfile[] = [
    { name: 'Open in VS Code', kind: 'vscode', value: '' },
    { name: 'Open folder', kind: 'folder', value: '' }
  ]
  if (stack.includes('node')) {
    profiles.push({ name: 'Run dev server', kind: 'shell', value: 'npm run dev' })
  }
  const browseUrl = gitRemoteToHttps(remoteUrl)
  if (browseUrl) {
    profiles.push({ name: 'Open on GitHub', kind: 'url', value: browseUrl })
  }
  return profiles
}

// Seed sensible default launch profiles for a project, but only if it has none yet.
// Reads the project's already-scanned stack + git remote. Safe to call repeatedly.
export function seedDefaultLaunchProfiles(projectId: number): void {
  if (listLaunchProfiles(projectId).length > 0) return
  const project = getProject(projectId)
  if (!project) return
  for (const profile of defaultProfilesFor(project.stack, project.git.remoteUrl)) {
    createLaunchProfile({
      projectId,
      name: profile.name,
      kind: profile.kind,
      value: profile.value
    })
  }
}
