// Shared domain types used by the server, the web UI, and the CLI.

export type ProjectStatus = 'active' | 'idea' | 'on-hold' | 'done' | 'archived'

// Derived from git activity — never set by hand.
export type GitActivity = 'fresh' | 'recent' | 'stalled' | 'dormant' | 'unknown'

export type Priority = 'high' | 'medium' | 'low'
export type TaskStatus = 'todo' | 'doing' | 'done'
export type IdeaStatus = 'open' | 'promoted' | 'archived'
export type CaptureKind = 'idea' | 'task' | 'note' | 'link'
export type LaunchKind = 'vscode' | 'shell' | 'url' | 'folder'

export interface GitInfo {
  hasGit: boolean
  branch: string | null
  lastCommitAt: string | null
  lastCommitMessage: string | null
  lastCommitHash: string | null
  dirty: boolean
  ahead: number
  behind: number
  remoteUrl: string | null
}

export interface ProjectCounts {
  notes: number
  ideas: number
  openTasks: number
}

export interface Project {
  id: number
  name: string
  path: string
  description: string
  status: ProjectStatus
  isFavorite: boolean
  color: string | null
  stack: string[]
  git: GitInfo
  activity: GitActivity
  lastScannedAt: string | null
  lastOpenedAt: string | null
  createdAt: string
  counts: ProjectCounts
}

export interface Note {
  id: number
  projectId: number
  title: string
  body: string
  pinned: boolean
  createdAt: string
  updatedAt: string
}

export interface Idea {
  id: number
  projectId: number
  title: string
  body: string
  priority: Priority
  status: IdeaStatus
  createdAt: string
  updatedAt: string
}

export interface Task {
  id: number
  projectId: number
  title: string
  status: TaskStatus
  priority: Priority
  sort: number
  createdAt: string
  updatedAt: string
  doneAt: string | null
}

export interface Capture {
  id: number
  projectId: number | null
  kind: CaptureKind
  text: string
  url: string
  processed: boolean
  createdAt: string
}

export interface LaunchProfile {
  id: number
  projectId: number
  name: string
  kind: LaunchKind
  value: string
  cwd: string
  sort: number
}

export interface AppSettings {
  projectRoots: string[]
  defaultEditor: string
  githubUser: string
  scanOnStartup: boolean
}

export interface ApiError {
  error: string
}

// Payload returned to an AI agent pulling a project's data into its repo.
export interface ProjectExport {
  generatedAt: string
  project: {
    id: number
    name: string
    path: string
    description: string
    status: ProjectStatus
  }
  notes: Array<Pick<Note, 'title' | 'body' | 'updatedAt'>>
  ideas: Array<Pick<Idea, 'title' | 'body' | 'priority' | 'status' | 'updatedAt'>>
  tasks: Array<Pick<Task, 'title' | 'status' | 'priority' | 'updatedAt'>>
}
