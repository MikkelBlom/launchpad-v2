import type {
  AppSettings,
  Capture,
  CaptureKind,
  Idea,
  LaunchProfile,
  Note,
  Priority,
  Project,
  ProjectStatus,
  Task
} from '../../shared/types'

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
  scan: () => req<{ added: string[]; scanned: number }>('/scan', { method: 'POST' }),
  importOld: () =>
    req<ImportResult>('/import/old-launchpad', { method: 'POST' }),
  getSettings: () => req<AppSettings>('/settings'),
  updateSettings: (patch: Partial<AppSettings>) =>
    req<AppSettings>('/settings', { method: 'PUT', ...body(patch) }),

  // Notes
  listNotes: (projectId: number) => req<Note[]>(`/projects/${projectId}/notes`),
  createNote: (projectId: number, data: { title: string; body: string }) =>
    req<Note>(`/projects/${projectId}/notes`, { method: 'POST', ...body(data) }),
  updateNote: (id: number, patch: Partial<{ title: string; body: string; pinned: boolean }>) =>
    req<Note>(`/notes/${id}`, { method: 'PATCH', ...body(patch) }),
  deleteNote: (id: number) => req<{ ok: true }>(`/notes/${id}`, { method: 'DELETE' }),

  // Ideas
  listIdeas: (projectId: number) => req<Idea[]>(`/projects/${projectId}/ideas`),
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
  listTasks: (projectId: number) => req<Task[]>(`/projects/${projectId}/tasks`),
  createTask: (projectId: number, data: { title: string; priority: Priority }) =>
    req<Task>(`/projects/${projectId}/tasks`, { method: 'POST', ...body(data) }),
  updateTask: (
    id: number,
    patch: Partial<{ title: string; status: string; priority: Priority; sort: number }>
  ) => req<Task>(`/tasks/${id}`, { method: 'PATCH', ...body(patch) }),
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
    )
}
