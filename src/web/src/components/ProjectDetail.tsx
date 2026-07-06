import { useCallback, useEffect, useState } from 'react'
import type { Idea, LaunchProfile, Note, Priority, Project, Task, TaskStatus } from '../../../shared/types'
import { api } from '../api'
import { ACTIVITY_META, PRIORITY_CLS, relativeTime, STATUS_META } from '../format'
import { Badge, Button, EmptyState, IconButton, inputCls, useToast } from './ui'
import {
  IconChevronLeft,
  IconCode,
  IconFolder,
  IconGithub,
  IconPlay,
  IconPlus,
  IconRefresh,
  IconStar,
  IconTrash
} from './icons'

type Tab = 'overview' | 'tasks' | 'ideas' | 'notes'

export function ProjectDetail({
  project,
  onBack,
  onChanged
}: {
  project: Project
  onBack: () => void
  onChanged: () => void
}) {
  const [tab, setTab] = useState<Tab>('overview')
  const [profiles, setProfiles] = useState<LaunchProfile[]>([])
  const toast = useToast()

  const loadProfiles = useCallback(() => {
    api.listLaunch(project.id).then(setProfiles)
  }, [project.id])

  useEffect(() => {
    loadProfiles()
  }, [loadProfiles])

  const guard = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      if (ok) toast(ok)
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    }
  }

  const activity = ACTIVITY_META[project.activity]

  return (
    <div className="mx-auto max-w-4xl px-6 py-5">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <IconChevronLeft /> All projects
      </button>

      {/* Header */}
      <div className="rounded-xl border border-line bg-surface-0 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${activity.dot}`} />
              <h1 className="truncate text-xl font-semibold text-ink">{project.name}</h1>
              <button
                onClick={() => guard(() => api.updateProject(project.id, { isFavorite: !project.isFavorite }).then(onChanged), '')}
                title="Toggle star"
              >
                <IconStar
                  width={18}
                  height={18}
                  className={project.isFavorite ? 'fill-amber-400 text-amber-400' : 'text-ink-faint hover:text-amber-400'}
                />
              </button>
            </div>
            <p className="mt-1 truncate font-mono text-xs text-ink-faint">{project.path}</p>
          </div>
          <select
            className="shrink-0 rounded-lg border border-line bg-surface-0 px-2 py-1.5 text-sm text-ink outline-none focus:border-brand"
            value={project.status}
            onChange={(e) => guard(() => api.updateProject(project.id, { status: e.target.value as Project['status'] }).then(onChanged), 'Status updated')}
          >
            {Object.entries(STATUS_META).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        {/* Git summary */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
          <Badge className={`${activity.text} bg-surface-2`}>{activity.label}</Badge>
          {project.git.hasGit ? (
            <>
              <Badge className="bg-surface-2 text-ink-soft">{project.git.branch ?? 'git'}</Badge>
              <Badge className="bg-surface-2 text-ink-soft">last commit {relativeTime(project.git.lastCommitAt)}</Badge>
              {project.git.dirty && <Badge className="bg-amber-100 text-amber-700">uncommitted changes</Badge>}
              {project.git.ahead > 0 && <Badge className="bg-sky-100 text-sky-700">↑{project.git.ahead}</Badge>}
              {project.git.behind > 0 && <Badge className="bg-sky-100 text-sky-700">↓{project.git.behind}</Badge>}
            </>
          ) : (
            <Badge className="bg-surface-2 text-ink-faint">no git repo</Badge>
          )}
        </div>

        {/* Quick launches */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="subtle" onClick={() => guard(() => api.openInEditor(project.id), 'Opening editor…')}>
            <IconCode /> Editor
          </Button>
          <Button variant="subtle" onClick={() => guard(() => api.openFolder(project.id), 'Opening folder…')}>
            <IconFolder /> Folder
          </Button>
          {project.git.remoteUrl && (
            <Button variant="subtle" onClick={() => guard(() => api.openGithub(project.id), 'Opening GitHub…')}>
              <IconGithub /> GitHub
            </Button>
          )}
          <div className="mx-1 h-5 w-px bg-line" />
          {profiles.map((p) => (
            <div key={p.id} className="group inline-flex items-center">
              <Button variant="subtle" onClick={() => guard(() => api.runLaunch(p.id), `Launching ${p.name}…`)}>
                <IconPlay /> {p.name}
              </Button>
              <IconButton
                title="Delete profile"
                className="h-7 w-7 opacity-0 group-hover:opacity-100"
                onClick={() => guard(() => api.deleteLaunch(p.id).then(loadProfiles), '')}
              >
                <IconTrash width={13} height={13} />
              </IconButton>
            </div>
          ))}
          <AddLaunchButton projectId={project.id} onAdded={loadProfiles} />
          <IconButton
            title="Rescan project"
            className="ml-auto"
            onClick={() => guard(() => api.scanProject(project.id).then(onChanged), 'Rescanned')}
          >
            <IconRefresh />
          </IconButton>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-4 flex gap-1 border-b border-line">
        {(['overview', 'tasks', 'ideas', 'notes'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize transition-colors ${
              tab === t ? 'border-brand text-brand-strong' : 'border-transparent text-ink-soft hover:text-ink'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="py-4">
        {tab === 'overview' && <OverviewTab project={project} onChanged={onChanged} />}
        {tab === 'tasks' && <TasksTab projectId={project.id} onChanged={onChanged} />}
        {tab === 'ideas' && <IdeasTab projectId={project.id} onChanged={onChanged} />}
        {tab === 'notes' && <NotesTab projectId={project.id} onChanged={onChanged} />}
      </div>
    </div>
  )
}

function AddLaunchButton({ projectId, onAdded }: { projectId: number; onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState('shell')
  const [value, setValue] = useState('')
  const toast = useToast()

  const save = async () => {
    if (!name.trim()) return
    try {
      await api.createLaunch(projectId, { name: name.trim(), kind, value: value.trim() })
      setName('')
      setValue('')
      setOpen(false)
      onAdded()
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    }
  }

  if (!open) {
    return (
      <IconButton title="Add launch profile" onClick={() => setOpen(true)}>
        <IconPlus />
      </IconButton>
    )
  }
  return (
    <div className="flex items-center gap-1 rounded-lg border border-line bg-surface-1 p-1">
      <input className="w-28 rounded px-2 py-1 text-sm outline-none" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="rounded bg-surface-0 px-1 py-1 text-sm outline-none" value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="shell">shell</option>
        <option value="vscode">vscode</option>
        <option value="url">url</option>
        <option value="folder">folder</option>
      </select>
      <input className="w-40 rounded px-2 py-1 text-sm outline-none" placeholder="command / url / subpath" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      <Button variant="primary" onClick={save}>
        Add
      </Button>
    </div>
  )
}

function OverviewTab({ project, onChanged }: { project: Project; onChanged: () => void }) {
  const [description, setDescription] = useState(project.description)
  const [dirty, setDirty] = useState(false)
  const [copied, setCopied] = useState(false)
  const toast = useToast()

  useEffect(() => {
    setDescription(project.description)
    setDirty(false)
  }, [project.id, project.description])

  const save = async () => {
    try {
      await api.updateProject(project.id, { description })
      setDirty(false)
      onChanged()
      toast('Saved')
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    }
  }

  const copyPull = () => {
    navigator.clipboard.writeText('launchpad pull').then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1 block text-sm font-medium text-ink-soft">Description</label>
        <textarea
          className={`${inputCls} min-h-[90px] resize-y`}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value)
            setDirty(true)
          }}
        />
        {dirty && (
          <div className="mt-2">
            <Button variant="primary" onClick={save}>
              Save description
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-brand/30 bg-brand-soft/50 p-4">
        <p className="text-sm font-semibold text-brand-strong">Agent pull</p>
        <p className="mt-1 text-sm text-ink-soft">
          An AI agent working in this project can pull these notes, ideas, and open tasks into
          <span className="font-mono"> ai-instructions/LAUNCHPAD.md</span> by running:
        </p>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 rounded-lg bg-surface-0 px-3 py-2 font-mono text-sm text-ink ring-1 ring-line">
            launchpad pull
          </code>
          <Button variant="subtle" onClick={copyPull}>
            {copied ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------- Tasks ----------
const TASK_NEXT: Record<TaskStatus, TaskStatus> = { todo: 'doing', doing: 'done', done: 'todo' }
const TASK_DOT: Record<TaskStatus, string> = {
  todo: 'border-stone-300',
  doing: 'border-amber-400 bg-amber-100',
  done: 'border-brand bg-brand'
}

function TasksTab({ projectId, onChanged }: { projectId: number; onChanged: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')

  const load = useCallback(() => api.listTasks(projectId).then(setTasks), [projectId])
  useEffect(() => {
    load()
  }, [load])

  const add = async () => {
    if (!title.trim()) return
    await api.createTask(projectId, { title: title.trim(), priority })
    setTitle('')
    load()
    onChanged()
  }
  const cycle = async (t: Task) => {
    await api.updateTask(t.id, { status: TASK_NEXT[t.status] })
    load()
    onChanged()
  }
  const remove = async (id: number) => {
    await api.deleteTask(id)
    load()
    onChanged()
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input className={inputCls} placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <select className="rounded-lg border border-line bg-surface-0 px-2 text-sm outline-none" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <Button variant="primary" onClick={add}>
          <IconPlus /> Add
        </Button>
      </div>
      {tasks.length === 0 ? (
        <EmptyState title="No tasks yet" />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface-0">
          {tasks.map((t) => (
            <li key={t.id} className="group flex items-center gap-3 px-3 py-2.5">
              <button onClick={() => cycle(t)} title={t.status} className={`h-4 w-4 shrink-0 rounded-full border-2 ${TASK_DOT[t.status]}`} />
              <span className={`flex-1 text-sm ${t.status === 'done' ? 'text-ink-faint line-through' : 'text-ink'}`}>{t.title}</span>
              <Badge className={PRIORITY_CLS[t.priority]}>{t.priority}</Badge>
              <IconButton title="Delete" className="opacity-0 group-hover:opacity-100" onClick={() => remove(t.id)}>
                <IconTrash width={14} height={14} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------- Ideas ----------
function IdeasTab({ projectId, onChanged }: { projectId: number; onChanged: () => void }) {
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const toast = useToast()

  const load = useCallback(() => api.listIdeas(projectId).then(setIdeas), [projectId])
  useEffect(() => {
    load()
  }, [load])

  const add = async () => {
    if (!title.trim()) return
    await api.createIdea(projectId, { title: title.trim(), body: '', priority })
    setTitle('')
    load()
    onChanged()
  }
  const promote = async (id: number) => {
    await api.promoteIdea(id, projectId)
    load()
    onChanged()
    toast('Promoted to task')
  }
  const remove = async (id: number) => {
    await api.deleteIdea(id)
    load()
    onChanged()
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input className={inputCls} placeholder="Add an idea…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <select className="rounded-lg border border-line bg-surface-0 px-2 text-sm outline-none" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <Button variant="primary" onClick={add}>
          <IconPlus /> Add
        </Button>
      </div>
      {ideas.length === 0 ? (
        <EmptyState title="No ideas yet" hint="Park anything here — it costs nothing." />
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ideas.map((i) => (
            <div key={i.id} className={`group rounded-xl border border-line bg-surface-0 p-3 ${i.status === 'promoted' ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-ink">{i.title}</p>
                <Badge className={PRIORITY_CLS[i.priority]}>{i.priority}</Badge>
              </div>
              {i.body && <p className="mt-1 text-sm text-ink-soft">{i.body}</p>}
              <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                {i.status !== 'promoted' && (
                  <Button variant="ghost" onClick={() => promote(i.id)}>
                    → Task
                  </Button>
                )}
                {i.status === 'promoted' && <span className="text-xs text-ink-faint">promoted</span>}
                <IconButton title="Delete" className="ml-auto" onClick={() => remove(i.id)}>
                  <IconTrash width={14} height={14} />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- Notes ----------
function NotesTab({ projectId, onChanged }: { projectId: number; onChanged: () => void }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const load = useCallback(() => api.listNotes(projectId).then(setNotes), [projectId])
  useEffect(() => {
    load()
  }, [load])

  const add = async () => {
    if (!title.trim() && !body.trim()) return
    await api.createNote(projectId, { title: title.trim(), body: body.trim() })
    setTitle('')
    setBody('')
    load()
    onChanged()
  }
  const remove = async (id: number) => {
    await api.deleteNote(id)
    load()
    onChanged()
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line bg-surface-0 p-3">
        <input className={`${inputCls} mb-2`} placeholder="Note title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className={`${inputCls} min-h-[70px] resize-y`} placeholder="Write freely — no format required…" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="mt-2">
          <Button variant="primary" onClick={add}>
            <IconPlus /> Add note
          </Button>
        </div>
      </div>
      {notes.length === 0 ? (
        <EmptyState title="No notes yet" />
      ) : (
        <div className="space-y-2">
          {notes.map((n) => (
            <div key={n.id} className="group rounded-xl border border-line bg-surface-0 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {n.title && <p className="text-sm font-semibold text-ink">{n.title}</p>}
                  {n.body && <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-soft">{n.body}</p>}
                </div>
                <IconButton title="Delete" className="shrink-0 opacity-0 group-hover:opacity-100" onClick={() => remove(n.id)}>
                  <IconTrash width={14} height={14} />
                </IconButton>
              </div>
              <p className="mt-2 text-xs text-ink-faint">{relativeTime(n.updatedAt)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
