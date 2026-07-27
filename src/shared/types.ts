// Shared domain types used by the server, the web UI, and the CLI.

export type ProjectStatus = 'active' | 'idea' | 'on-hold' | 'done' | 'archived'

// Derived from git activity — never set by hand.
export type GitActivity = 'fresh' | 'recent' | 'stalled' | 'dormant' | 'unknown'

export type Priority = 'high' | 'medium' | 'low'
export type TaskStatus = 'todo' | 'doing' | 'done'
export type IdeaStatus = 'open' | 'promoted' | 'archived'
export type CaptureKind = 'idea' | 'task' | 'note' | 'link'
export type LaunchKind = 'vscode' | 'shell' | 'url' | 'folder'

// Which surface made a write. Agents identify themselves so their edits stay reviewable.
export type WriteSource = 'ui' | 'cli' | 'agent' | 'import'

// The three per-project item kinds that can carry their own tags.
export type ItemType = 'task' | 'idea' | 'note'

export interface Provenance {
  source: WriteSource
  actor: string
}

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

export interface Tag {
  id: number
  name: string
  color: string
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
  tags: Tag[]
  // Live deployment, either detected from Vercel or entered by hand.
  liveUrl: string | null
  vercelProjectId: string | null
  // False when the folder has been moved, renamed, or deleted on disk.
  pathExists: boolean
}

export interface Note {
  id: number
  projectId: number
  title: string
  body: string
  pinned: boolean
  archivedAt: string | null
  source: WriteSource
  updatedBy: string
  tags: Tag[]
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
  source: WriteSource
  updatedBy: string
  tags: Tag[]
  createdAt: string
  updatedAt: string
}

export interface Task {
  id: number
  projectId: number
  title: string
  body: string
  status: TaskStatus
  priority: Priority
  sort: number
  dueDate: string | null
  archivedAt: string | null
  source: WriteSource
  updatedBy: string
  tags: Tag[]
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
  scanDepth: number
  excludeDirs: string[]
  defaultSort: string
  groupByStatus: boolean
  // Vercel personal access token, used to match projects to their live deployments.
  vercelToken: string
  vercelTeamId: string
}

export interface VercelProject {
  id: string
  name: string
  url: string | null
  framework: string | null
  gitRepo: string | null
  updatedAt: string | null
}

// Result of a discovery scan — reports why nothing was found, not just that nothing was.
export interface DiscoveryResult {
  added: string[]
  scanned: number
  roots: Array<{ path: string; exists: boolean; candidates: number; added: number }>
  skippedExisting: number
  message: string
}

// A folder on disk that probably corresponds to a project whose path went missing.
export interface RelocateCandidate {
  path: string
  name: string
  score: number
  reason: string
}

export interface ApiError {
  error: string
}

export interface GitCommit {
  hash: string
  date: string
  message: string
  author: string
}

export interface DashboardStats {
  total: number
  active: number
  dirty: number
  stalledActive: number
  openTasks: number
  byActivity: Record<GitActivity, number>
  byStatus: Record<ProjectStatus, number>
}

export type ActivityKind = 'commit' | 'task' | 'idea' | 'note'

export interface ActivityItem {
  kind: ActivityKind
  projectId: number
  projectName: string
  text: string
  at: string
}

export interface SearchHit {
  type: 'project' | 'task' | 'idea' | 'note'
  projectId: number
  projectName: string
  id: number
  title: string
  snippet: string
}

// Registrations that look like the same project. `nested` is historical — the group is no
// longer only about nested folders — so each entry carries why it was grouped.
export interface DuplicateGroup {
  keeper: { id: number; name: string; path: string }
  nested: Array<{ id: number; name: string; path: string; reason: string }>
}

// Payload returned to an AI agent pulling a project's data into its repo. Item ids are
// included so an agent can address anything it just read (`launchpad task update 42 …`).
export interface ProjectExport {
  generatedAt: string
  project: {
    id: number
    name: string
    path: string
    description: string
    status: ProjectStatus
    tags: string[]
    stack: string[]
    activity: GitActivity
  }
  notes: Array<Pick<Note, 'id' | 'title' | 'body' | 'pinned' | 'updatedAt'> & { tags: string[] }>
  ideas: Array<
    Pick<Idea, 'id' | 'title' | 'body' | 'priority' | 'status' | 'updatedAt'> & { tags: string[] }
  >
  tasks: Array<
    Pick<Task, 'id' | 'title' | 'body' | 'status' | 'priority' | 'dueDate' | 'updatedAt'> & {
      tags: string[]
    }
  >
}

export interface ChangeEntry {
  id: number
  at: string
  source: WriteSource
  actor: string
  projectId: number | null
  entityType: string
  entityId: number | null
  action: string
  summary: string
}

// "What still needs filling in" — the work list an agent reads before setting a project up.
export interface AuditIssue {
  code:
    | 'no-description'
    | 'no-tags'
    | 'no-tasks'
    | 'no-notes'
    | 'untagged-items'
    | 'stalled'
    | 'uncommitted'
    | 'missing-path'
  detail: string
}

export interface ProjectAudit {
  projectId: number
  name: string
  path: string
  status: ProjectStatus
  issues: AuditIssue[]
}

// ---- Batch push (agent → Launchpad) ----

export interface PushItem {
  id?: number
  title: string
  body?: string
  priority?: Priority
  tags?: string[]
}

export interface PushTask extends PushItem {
  status?: TaskStatus
  dueDate?: string | null
}

export interface PushIdea extends PushItem {
  status?: IdeaStatus
}

export interface PushNote extends PushItem {
  pinned?: boolean
}

export interface PushPlan {
  project?: {
    description?: string
    status?: ProjectStatus
    tags?: string[]
  }
  tasks?: PushTask[]
  ideas?: PushIdea[]
  notes?: PushNote[]
}

export interface PushChange {
  type: ItemType | 'project'
  action: 'created' | 'updated' | 'unchanged'
  id: number | null
  title: string
  fields: string[]
}

export interface PushResult {
  dryRun: boolean
  projectId: number
  projectName: string
  created: number
  updated: number
  unchanged: number
  changes: PushChange[]
  warnings: string[]
  backupPath: string | null
}
