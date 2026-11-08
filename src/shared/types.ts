// Shared domain types used by the server, the web UI, and the CLI.

export type ProjectStatus = 'active' | 'idea' | 'on-hold' | 'done' | 'archived'

// Derived from git activity — never set by hand.
export type GitActivity = 'fresh' | 'recent' | 'stalled' | 'dormant' | 'unknown'

export type Priority = 'high' | 'medium' | 'low'
export type TaskStatus = 'todo' | 'doing' | 'done'
export type IdeaStatus = 'open' | 'promoted' | 'archived'
export type CaptureKind = 'idea' | 'task' | 'note' | 'link'
export type LaunchKind = 'vscode' | 'shell' | 'url' | 'folder'

// Which shell the terminal button opens. 'auto' is PowerShell 7 where it is installed and
// Windows PowerShell where it isn't.
export type TerminalShell = 'auto' | 'pwsh' | 'powershell' | 'cmd'

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
  // Every localhost port this project claims — a project that runs several processes
  // (web + api + worker) claims one per process. Ordered; the first is the primary.
  ports: PortClaim[]
  // The primary port and where it came from. Both are DERIVED from `ports[0]` — they exist
  // so the many one-port affordances (card badge, "open localhost", the agent block) don't
  // each have to reach into the array. Never write them; write a claim.
  devPort: number | null
  devPortSource: string | null
  // False when the folder has been moved, renamed, or deleted on disk.
  pathExists: boolean
  // True when ai-instructions/.launchpad.json binds this folder to this project.
  onboarded: boolean
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
  // Whether the desktop app starts with Windows. The DB is the source of truth; the
  // Electron shell reads this on launch and applies it.
  startAtLogin: boolean
  // What the per-project terminal button opens, and whether it asks for elevation (one UAC
  // prompt per click). Only the terminal button reads these — shell launch profiles keep
  // running in cmd, because they hold commands written for it.
  terminalShell: TerminalShell
  terminalAsAdmin: boolean
}

// ---- Dev server ports ----

// One port claimed by one project. A project claims as many as it runs processes.
export interface PortClaim {
  id: number
  projectId: number
  port: number
  // What runs on it ("web", "api", "docs") — free text, blank when there's nothing to say.
  label: string
  // Where the number came from: "manual", or the config file it was detected in.
  source: string
  sort: number
}

// A claim as the ports page shows it: the claim itself plus everything only the machine
// and the rest of the database can say about it.
export interface PortClaimRow extends PortClaim {
  projectName: string
  url: string
  // Whether something is actually listening on that port right now.
  listening: boolean
  // A port Launchpad must never hand out — its own service or dev server.
  reserved: boolean
  // Other projects laying claim to the same port — a collision worth surfacing.
  conflictsWith: string[]
}

export interface PortOverview {
  // Every claim in Launchpad, ascending by port.
  claims: PortClaimRow[]
  // Projects claiming nothing, so the UI can offer to detect one.
  unclaimed: Array<{ projectId: number; name: string }>
  // Ports currently listening on this machine, whether or not Launchpad knows them.
  listening: number[]
  // Free ports Launchpad suggests claiming next.
  suggested: number[]
}

// What `ports free` skipped on its way to the suggestions, so the caller can see that the
// list accounts for claims and not just for what happens to be listening.
export interface PortSuggestion {
  ports: number[]
  skipped: {
    claimed: number[]
    listening: number[]
    reserved: number[]
  }
}

export interface PortCheck {
  port: number
  available: boolean
  listening: boolean
  claimedBy: string | null
  // True for ports Launchpad refuses to hand out at all.
  reserved: boolean
  reason: string
}

// The outcome of claiming a port. `warning` is for things worth saying but not worth
// refusing over (something is already listening on it, for instance).
export interface PortClaimResult {
  project: Project
  claim: PortClaim
  warning: string | null
}

// Detection reads a project's own config; some of what it finds may be unclaimable.
export interface PortDetectResult {
  project: Project
  claimed: PortClaim[]
  skipped: Array<{ port: number; source: string; reason: string }>
}

// ---- Git diff ----

export interface DiffFile {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
  additions: number
  deletions: number
  patch: string
  binary: boolean
  truncated: boolean
}

export interface ProjectDiff {
  staged: boolean
  files: DiffFile[]
  totalAdditions: number
  totalDeletions: number
  truncated: boolean
}

export interface OnboardResult {
  projectId: number
  name: string
  bindingPath: string
  instructionsPath: string
  snapshotPath: string
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
  // Folders sitting directly under a root that discovery did not recognise, and why. A scan
  // that reports only what it took leaves "so where is my folder?" unanswerable — which is
  // exactly the question someone asks after creating one and scanning.
  //
  // `kind` is what the UI acts on: an *empty* folder under a project root is almost always a
  // project someone started making, so it gets an offer to initialise rather than a shrug.
  skipped: Array<{ path: string; reason: string; kind: 'empty' | 'unrecognised' }>
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

// ---- Weekly timeline (GET /api/timeline) ----

export interface TimelineCommit {
  hash: string // short hash
  at: string // author date, ISO (UTC)
  subject: string
  author: string
  authorEmail: string
}

export interface TimelineWeek {
  key: string // "2026-W45"
  year: number
  week: number
  start: string // local Monday 00:00, ISO
  end: string // following Monday 00:00 (exclusive), ISO
  days: string[] // seven local dates YYYY-MM-DD, Monday first
  label: string // "Week 45 · 2–8 Nov 2026"
  prev: string
  next: string
  isCurrent: boolean
  isFuture: boolean
}

export interface TimelineDayProject {
  projectId: number
  projectName: string
  commits: TimelineCommit[] // chronological
}

export interface TimelineDay {
  date: string // YYYY-MM-DD, local
  label: string // "Mon 2 Nov"
  total: number
  projects: TimelineDayProject[] // most commits first
}

export interface TimelineProjectTotal {
  projectId: number
  projectName: string
  color: string | null
  total: number
  perDay: number[] // seven counts, Monday first
}

export interface TimelineAuthor {
  name: string
  email: string
  count: number
}

export interface Timeline {
  week: TimelineWeek
  days: TimelineDay[]
  projects: TimelineProjectTotal[] // only projects with commits, most first
  total: number
  authors: TimelineAuthor[]
  // `?mine=true`: each repo's commits filtered to its own `git config user.email`.
  mine: boolean
  // Repos that were looked at but could not be read (timeout, git error) — said, not hidden.
  skipped: Array<{ projectId: number; projectName: string; reason: string }>
  reposScanned: number
  generatedAt: string
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

// ---- Session report (`launchpad report`) ----
// An agent's end-of-session handoff. Decisions and deferred items become tasks tagged
// `needs-mikkel`; the whole report becomes one note. See services/sessionReport.ts.

export type SessionReportItem = string | { title: string; body?: string }

export interface SessionReport {
  title?: string
  summary: string
  decisions?: SessionReportItem[]
  deferred?: SessionReportItem[]
  next?: string[]
}

export interface SessionReportResult extends PushResult {
  noteTitle: string
}
