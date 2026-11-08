import type {
  ActivityItem,
  AppSettings,
  Capture,
  CaptureKind,
  ChangeEntry,
  DashboardStats,
  DiscoveryResult,
  DuplicateGroup,
  GitCommit,
  HygieneOverview,
  Idea,
  ItemType,
  LaunchProfile,
  NeedsMikkelInbox,
  Note,
  OnboardResult,
  PortCheck,
  PortClaim,
  PortClaimResult,
  PortDetectResult,
  PortOverview,
  PortSuggestion,
  Priority,
  Project,
  ProjectAudit,
  ProjectDiff,
  ProjectHygiene,
  ProjectStatus,
  PushPlan,
  PushResult,
  RelocateCandidate,
  SearchHit,
  Tag,
  Task,
  Timeline,
  VercelProject
} from '../../shared/types'

const SEGMENT: Record<ItemType, string> = { task: 'tasks', idea: 'ideas', note: 'notes' }

export interface ImportResult {
  registrySource: string
  imported: Array<{ name: string; path: string }>
  relocated: Array<{ name: string; from: string; to: string }>
  skipped: Array<{ name: string; reason: string }>
  notFound: Array<{ name: string; path: string }>
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // Only advertise a JSON body when we actually send one — a bodyless POST with a
  // JSON content-type makes the server reject it as an empty body.
  const headers: Record<string, string> = {}
  if (init?.body) headers['Content-Type'] = 'application/json'
  const res = await fetch(`/api${path}`, { ...init, headers })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return text ? (JSON.parse(text) as T) : (undefined as T)
}

const body = (data: unknown): RequestInit => ({ body: JSON.stringify(data) })

export const api = {
  // Projects
  listProjects: () => req<Project[]>('/projects'),
  getProject: (id: number) => req<Project>(`/projects/${id}`),
  createProject: (data: { name: string; path: string; description?: string }) =>
    req<Project>('/projects', { method: 'POST', ...body(data) }),
  updateProject: (
    id: number,
    patch: Partial<{
      name: string
      description: string
      status: ProjectStatus
      isFavorite: boolean
      color: string | null
    }>
  ) => req<Project>(`/projects/${id}`, { method: 'PATCH', ...body(patch) }),
  deleteProject: (id: number) => req<{ ok: true }>(`/projects/${id}`, { method: 'DELETE' }),
  scanProject: (id: number) => req<Project>(`/projects/${id}/scan`, { method: 'POST' }),
  openInEditor: (id: number) => req<{ ok: true }>(`/projects/${id}/open`, { method: 'POST' }),
  openFolder: (id: number) =>
    req<{ ok: true }>(`/projects/${id}/open-folder`, { method: 'POST' }),
  openGithub: (id: number) =>
    req<{ ok: true }>(`/projects/${id}/open-github`, { method: 'POST' }),

  // Scan / settings
  scan: () => req<DiscoveryResult>('/scan', { method: 'POST' }),

  // Opens a native folder-picker on the machine running the service.
  pickFolder: (title?: string) =>
    req<{ path: string | null }>('/pick-folder', { method: 'POST', ...body({ title: title ?? '' }) }),

  // Live deployments (Vercel)
  vercelProjects: () => req<VercelProject[]>('/vercel/projects'),
  vercelDetect: (id: number) =>
    req<{ matched: VercelProject | null; project: Project }>(`/projects/${id}/vercel/detect`, {
      method: 'POST'
    }),
  vercelLink: (id: number, vercelProjectId: string | null) =>
    req<Project>(`/projects/${id}/vercel/link`, { method: 'POST', ...body({ vercelProjectId }) }),
  setLiveUrl: (id: number, liveUrl: string | null) =>
    req<Project>(`/projects/${id}`, { method: 'PATCH', ...body({ liveUrl }) }),
  openLive: (id: number) => req<{ ok: true }>(`/projects/${id}/open-live`, { method: 'POST' }),

  // What the service is, asked before anything else renders — see Boot in App.tsx.
  health: () =>
    req<{ ok: boolean; service: string; port: number; apiVersion: number; buildTime: number }>(
      '/health'
    ),

  // Hygiene: a read-only cleanup report. The overview answers from cache and refreshes in
  // the background — poll while `scanning`.
  hygiene: (refresh = false) => req<HygieneOverview>(`/hygiene${refresh ? '?refresh=true' : ''}`),
  projectHygiene: (id: number, refresh = false) =>
    req<ProjectHygiene>(`/projects/${id}/hygiene${refresh ? '?refresh=true' : ''}`),

  // Dev server ports. A project claims one per process it runs.
  ports: () => req<PortOverview>('/ports'),
  checkPort: (port: number, projectId?: number) =>
    req<PortCheck>(
      `/ports/check?port=${port}${projectId === undefined ? '' : `&projectId=${projectId}`}`
    ),
  suggestPorts: (count = 3) => req<PortSuggestion>(`/ports/suggest?count=${count}`),
  claimPort: (id: number, port: number, options: { label?: string; force?: boolean } = {}) =>
    req<PortClaimResult>(`/projects/${id}/ports`, { method: 'POST', ...body({ port, ...options }) }),
  labelPort: (id: number, port: number, label: string) =>
    req<PortClaim>(`/projects/${id}/ports/${port}`, { method: 'PATCH', ...body({ label }) }),
  releasePort: (id: number, port: number) =>
    req<Project>(`/projects/${id}/ports/${port}`, { method: 'DELETE' }),
  releaseAllPorts: (id: number) => req<Project>(`/projects/${id}/ports`, { method: 'DELETE' }),
  orderPorts: (id: number, ports: number[]) =>
    req<Project>(`/projects/${id}/ports/order`, { method: 'POST', ...body({ ports }) }),
  detectPort: (id: number) =>
    req<PortDetectResult>(`/projects/${id}/detect-port`, { method: 'POST' }),
  openDev: (id: number, port?: number) =>
    req<{ ok: true; url: string }>(
      `/projects/${id}/open-dev${port === undefined ? '' : `?port=${port}`}`,
      { method: 'POST' }
    ),

  // Working-tree diff
  diff: (id: number, staged = false) =>
    req<ProjectDiff>(`/projects/${id}/diff${staged ? '?staged=true' : ''}`),

  // Agent onboarding (binding + CLAUDE.md block + snapshot), from the UI
  onboard: (id: number) => req<OnboardResult>(`/projects/${id}/onboard`, { method: 'POST' }),
  onboardAll: () =>
    req<{ onboarded: OnboardResult[]; failed: Array<{ projectId: number; name: string; error: string }> }>(
      '/onboard-all',
      { method: 'POST' }
    ),

  // Moved / renamed folders
  relocateCandidates: (id: number) =>
    req<RelocateCandidate[]>(`/projects/${id}/relocate/candidates`),
  relocateProject: (id: number, path: string) =>
    req<Project>(`/projects/${id}/relocate`, { method: 'POST', ...body({ path }) }),
  renameFolder: (id: number, folderName: string) =>
    req<Project>(`/projects/${id}/rename-folder`, { method: 'POST', ...body({ folderName }) }),
  importOld: () =>
    req<ImportResult>('/import/old-launchpad', { method: 'POST' }),
  getSettings: () => req<AppSettings>('/settings'),
  updateSettings: (patch: Partial<AppSettings>) =>
    req<AppSettings>('/settings', { method: 'PUT', ...body(patch) }),

  // Notes
  listNotes: (projectId: number, includeArchived = false) =>
    req<Note[]>(`/projects/${projectId}/notes${includeArchived ? '?includeArchived=true' : ''}`),
  createNote: (projectId: number, data: { title: string; body: string }) =>
    req<Note>(`/projects/${projectId}/notes`, { method: 'POST', ...body(data) }),
  updateNote: (id: number, patch: Partial<{ title: string; body: string; pinned: boolean }>) =>
    req<Note>(`/notes/${id}`, { method: 'PATCH', ...body(patch) }),
  deleteNote: (id: number) => req<{ ok: true }>(`/notes/${id}`, { method: 'DELETE' }),

  // Ideas
  listIdeas: (projectId: number, includeArchived = false) =>
    req<Idea[]>(`/projects/${projectId}/ideas${includeArchived ? '?includeArchived=true' : ''}`),
  createIdea: (projectId: number, data: { title: string; body: string; priority: Priority }) =>
    req<Idea>(`/projects/${projectId}/ideas`, { method: 'POST', ...body(data) }),
  updateIdea: (
    id: number,
    patch: Partial<{ title: string; body: string; priority: Priority; status: string }>
  ) => req<Idea>(`/ideas/${id}`, { method: 'PATCH', ...body(patch) }),
  deleteIdea: (id: number) => req<{ ok: true }>(`/ideas/${id}`, { method: 'DELETE' }),
  promoteIdea: (id: number, projectId: number) =>
    req<Task>(`/ideas/${id}/promote`, { method: 'POST', ...body({ projectId }) }),

  // Tasks
  listTasks: (projectId: number, includeArchived = false) =>
    req<Task[]>(`/projects/${projectId}/tasks${includeArchived ? '?includeArchived=true' : ''}`),
  createTask: (projectId: number, data: { title: string; priority: Priority; body?: string }) =>
    req<Task>(`/projects/${projectId}/tasks`, { method: 'POST', ...body(data) }),
  updateTask: (
    id: number,
    patch: Partial<{
      title: string
      body: string
      status: string
      priority: Priority
      sort: number
      dueDate: string | null
    }>
  ) => req<Task>(`/tasks/${id}`, { method: 'PATCH', ...body(patch) }),
  moveTask: (id: number, direction: 'up' | 'down') =>
    req<{ ok: true }>(`/tasks/${id}/move`, { method: 'POST', ...body({ direction }) }),
  deleteTask: (id: number) => req<{ ok: true }>(`/tasks/${id}`, { method: 'DELETE' }),

  // Launch profiles
  listLaunch: (projectId: number) => req<LaunchProfile[]>(`/projects/${projectId}/launch`),
  createLaunch: (
    projectId: number,
    data: { name: string; kind: string; value: string; cwd?: string }
  ) => req<LaunchProfile>(`/projects/${projectId}/launch`, { method: 'POST', ...body(data) }),
  updateLaunch: (id: number, patch: Partial<{ name: string; kind: string; value: string }>) =>
    req<LaunchProfile>(`/launch/${id}`, { method: 'PATCH', ...body(patch) }),
  deleteLaunch: (id: number) => req<{ ok: true }>(`/launch/${id}`, { method: 'DELETE' }),
  runLaunch: (id: number) => req<{ ok: true }>(`/launch/${id}/run`, { method: 'POST' }),

  // Captures
  listCaptures: () => req<Capture[]>('/captures'),
  createCapture: (data: { projectId?: number | null; kind?: CaptureKind; text: string; url?: string }) =>
    req<Capture>('/captures', { method: 'POST', ...body(data) }),
  setCaptureProcessed: (id: number, processed: boolean) =>
    req<{ ok: true }>(`/captures/${id}`, { method: 'PATCH', ...body({ processed }) }),
  deleteCapture: (id: number) => req<{ ok: true }>(`/captures/${id}`, { method: 'DELETE' }),

  // Scaffold
  scaffold: (data: {
    name: string
    parentPath: string
    description?: string
    initGit?: boolean
    createGithub?: boolean
    githubPrivate?: boolean
  }) =>
    req<{ project: Project; path: string; warnings: string[]; githubCreated: boolean }>(
      '/scaffold',
      { method: 'POST', ...body(data) }
    ),

  // Tags
  listTags: () => req<Tag[]>('/tags'),
  createTag: (name: string, color?: string) =>
    req<Tag>('/tags', { method: 'POST', ...body({ name, color }) }),
  updateTag: (id: number, patch: { name?: string; color?: string }) =>
    req<{ ok: true }>(`/tags/${id}`, { method: 'PATCH', ...body(patch) }),
  deleteTag: (id: number) => req<{ ok: true }>(`/tags/${id}`, { method: 'DELETE' }),
  addProjectTag: (projectId: number, data: { tagId?: number; name?: string; color?: string }) =>
    req<Project>(`/projects/${projectId}/tags`, { method: 'POST', ...body(data) }),
  removeProjectTag: (projectId: number, tagId: number) =>
    req<Project>(`/projects/${projectId}/tags/${tagId}`, { method: 'DELETE' }),

  // Tags on individual tasks / ideas / notes
  addItemTag: <T>(type: ItemType, id: number, name: string) =>
    req<T>(`/${SEGMENT[type]}/${id}/tags`, { method: 'POST', ...body({ name }) }),
  removeItemTag: <T>(type: ItemType, id: number, tagId: number) =>
    req<T>(`/${SEGMENT[type]}/${id}/tags/${tagId}`, { method: 'DELETE' }),
  setItemTags: <T>(type: ItemType, id: number, names: string[]) =>
    req<T>(`/${SEGMENT[type]}/${id}/tags`, { method: 'PUT', ...body({ names }) }),

  // "Needs Mikkel": open items in any project tagged needs-mikkel. Acting on one goes
  // through updateTask / archiveItem, the same endpoints the project view uses.
  needsMikkel: () => req<NeedsMikkelInbox>('/needs-mikkel'),
  needsMikkelCount: () => req<{ tag: string; count: number }>('/needs-mikkel/count'),

  // Archiving — the reversible alternative to deletion
  archiveItem: <T>(type: ItemType, id: number, archived = true) =>
    req<T>(`/${SEGMENT[type]}/${id}/archive`, { method: 'POST', ...body({ archived }) }),

  // Agent surface
  audit: () => req<ProjectAudit[]>('/audit'),
  auditProject: (id: number) => req<ProjectAudit>(`/projects/${id}/audit`),
  agentPrompt: (id: number) => req<{ prompt: string }>(`/projects/${id}/agent-prompt`),
  writeAgentInstructions: (id: number) =>
    req<{ path: string; action: string }>(`/projects/${id}/agent-instructions`, { method: 'POST' }),
  push: (id: number, plan: PushPlan, dryRun = false) =>
    req<PushResult>(`/projects/${id}/push${dryRun ? '?dryRun=true' : ''}`, {
      method: 'POST',
      ...body(plan)
    }),
  changes: (params: { projectId?: number; limit?: number; source?: string } = {}) => {
    const query = new URLSearchParams()
    if (params.projectId !== undefined) query.set('projectId', String(params.projectId))
    if (params.limit !== undefined) query.set('limit', String(params.limit))
    if (params.source) query.set('source', params.source)
    return req<ChangeEntry[]>(`/changes?${query.toString()}`)
  },

  // Insights
  stats: () => req<DashboardStats>('/stats'),
  activity: (limit = 40) => req<ActivityItem[]>(`/activity?limit=${limit}`),
  timeline: (week: string, opts: { mine?: boolean; refresh?: boolean } = {}) => {
    const query = new URLSearchParams({ week })
    if (opts.mine) query.set('mine', 'true')
    if (opts.refresh) query.set('refresh', 'true')
    return req<Timeline>(`/timeline?${query.toString()}`)
  },
  search: (q: string) => req<SearchHit[]>(`/search?q=${encodeURIComponent(q)}`),
  commits: (projectId: number) => req<GitCommit[]>(`/projects/${projectId}/commits`),
  readme: (projectId: number) => req<{ content: string }>(`/projects/${projectId}/readme`),
  duplicates: () => req<DuplicateGroup[]>('/duplicates'),
  // `keeperId` can differ from the one requested: if the requested keeper's folder is gone,
  // the merge survives onto a registration whose path actually exists.
  merge: (keeperId: number, mergeIds: number[]) =>
    req<{ merged: number; keeperId: number }>('/merge', {
      method: 'POST',
      ...body({ keeperId, mergeIds })
    }),

  // Project actions
  // `admin` overrides the terminal preference in settings for this one launch.
  openTerminal: (id: number, admin?: boolean) =>
    req<{ ok: true }>(`/projects/${id}/open-terminal`, {
      method: 'POST',
      ...(typeof admin === 'boolean' ? body({ admin }) : {})
    }),
  exportFile: (id: number) =>
    req<{ path: string }>(`/projects/${id}/export-file`, { method: 'POST' }),
  bulkUpdate: (ids: number[], patch: { status?: ProjectStatus; isFavorite?: boolean }) =>
    req<{ ok: true; count: number }>('/projects/bulk', { method: 'POST', ...body({ ids, patch }) }),
  bulkDelete: (ids: number[]) =>
    req<{ ok: true; count: number }>('/projects/bulk-delete', { method: 'POST', ...body({ ids }) }),

  // Data
  dataDir: () => req<{ dataDir: string }>('/data-dir'),
  openDataFolder: () => req<{ ok: true }>('/open-data-folder', { method: 'POST' }),
  backup: () => req<unknown>('/backup'),
  restore: (data: unknown) =>
    req<{ restored: Record<string, number> }>('/restore', { method: 'POST', ...body(data) })
}
