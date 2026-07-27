import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  GitCommit,
  Idea,
  LaunchProfile,
  Note,
  Priority,
  Project,
  ProjectAudit,
  Task,
  TaskStatus
} from '../../../shared/types'
import { api } from '../api'
import { ACTIVITY_META, dueMeta, PRIORITY_CLS, relativeTime, STATUS_META } from '../format'
import { renderMarkdown } from '../markdown'
import { Badge, Button, EmptyState, IconButton, inputCls, Modal, useToast } from './ui'
import { ItemTags } from './ItemTags'
import {
  IconArchive,
  IconArrowDown,
  IconArrowUp,
  IconChevronLeft,
  IconCode,
  IconDownload,
  IconEdit,
  IconFolder,
  IconGitCommit,
  IconGithub,
  IconLayers,
  IconList,
  IconPlay,
  IconPlus,
  IconRefresh,
  IconRobot,
  IconStar,
  IconTerminal,
  IconTrash
} from './icons'

type Tab = 'overview' | 'tasks' | 'ideas' | 'notes' | 'git' | 'readme'

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
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(project.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const toast = useToast()

  const loadProfiles = useCallback(() => {
    api.listLaunch(project.id).then(setProfiles)
  }, [project.id])

  useEffect(() => {
    loadProfiles()
  }, [loadProfiles])
  useEffect(() => {
    setNameDraft(project.name)
  }, [project.name])

  const guard = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      if (ok) toast(ok)
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    }
  }

  const saveName = async () => {
    if (nameDraft.trim() && nameDraft !== project.name) {
      await guard(() => api.updateProject(project.id, { name: nameDraft.trim() }).then(onChanged), 'Renamed')
    }
    setRenaming(false)
  }

  const addTag = async () => {
    const name = tagDraft.trim().replace(/^#/, '')
    if (!name) return
    await guard(() => api.addProjectTag(project.id, { name }).then(onChanged), '')
    setTagDraft('')
  }

  const activity = ACTIVITY_META[project.activity]

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <IconChevronLeft /> All projects
      </button>

      <div className="rounded-xl border border-line bg-surface-0 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${activity.dot}`} />
              {renaming ? (
                <input
                  autoFocus
                  className="min-w-0 flex-1 rounded border border-line px-2 py-0.5 text-xl font-semibold text-ink outline-none focus:border-brand"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setNameDraft(project.name); setRenaming(false) } }}
                  onBlur={saveName}
                />
              ) : (
                <h1 className="truncate text-xl font-semibold text-ink">{project.name}</h1>
              )}
              <IconButton title="Rename" onClick={() => setRenaming(true)}><IconEdit width={15} height={15} /></IconButton>
              <button onClick={() => guard(() => api.updateProject(project.id, { isFavorite: !project.isFavorite }).then(onChanged), '')} title="Toggle star">
                <IconStar width={18} height={18} className={project.isFavorite ? 'fill-amber-400 text-amber-400' : 'text-ink-faint hover:text-amber-400'} />
              </button>
            </div>
            <p className="mt-1 truncate font-mono text-xs text-ink-faint">{project.path}</p>
          </div>
          <select
            className="shrink-0 rounded-lg border border-line bg-surface-0 px-2 py-1.5 text-sm text-ink outline-none focus:border-brand"
            value={project.status}
            onChange={(e) => guard(() => api.updateProject(project.id, { status: e.target.value as Project['status'] }).then(onChanged), 'Status updated')}
          >
            {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        {/* Tags */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {project.tags.map((t) => (
            <span key={t.id} className="group inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `${t.color}22`, color: t.color }}>
              #{t.name}
              <button onClick={() => guard(() => api.removeProjectTag(project.id, t.id).then(onChanged), '')} className="opacity-60 hover:opacity-100">×</button>
            </span>
          ))}
          <input
            className="w-24 rounded-full border border-dashed border-line px-2 py-0.5 text-xs outline-none focus:border-brand"
            placeholder="+ tag"
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTag()}
          />
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
          <Button variant="subtle" onClick={() => guard(() => api.openInEditor(project.id), 'Opening editor…')}><IconCode /> Editor</Button>
          <Button variant="subtle" onClick={() => guard(() => api.openTerminal(project.id), 'Opening terminal…')}><IconTerminal /> Terminal</Button>
          <Button variant="subtle" onClick={() => guard(() => api.openFolder(project.id), 'Opening folder…')}><IconFolder /> Folder</Button>
          {project.git.remoteUrl && <Button variant="subtle" onClick={() => guard(() => api.openGithub(project.id), 'Opening GitHub…')}><IconGithub /> GitHub</Button>}
          <div className="mx-1 h-5 w-px bg-line" />
          {profiles.map((p) => (
            <div key={p.id} className="group inline-flex items-center">
              <Button variant="subtle" onClick={() => guard(() => api.runLaunch(p.id), `Launching ${p.name}…`)}><IconPlay /> {p.name}</Button>
              <IconButton title="Delete profile" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => guard(() => api.deleteLaunch(p.id).then(loadProfiles), '')}><IconTrash width={13} height={13} /></IconButton>
            </div>
          ))}
          <AddLaunchButton projectId={project.id} onAdded={loadProfiles} />
          <div className="ml-auto flex items-center gap-0.5">
            <IconButton title="Export snapshot to LAUNCHPAD.md" onClick={() => guard(() => api.exportFile(project.id), 'Wrote LAUNCHPAD.md')}><IconDownload /></IconButton>
            <IconButton title="Rescan project" onClick={() => guard(() => api.scanProject(project.id).then(onChanged), 'Rescanned')}><IconRefresh /></IconButton>
            <IconButton title="Delete project" onClick={() => setConfirmDelete(true)}><IconTrash /></IconButton>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-4 flex gap-1 overflow-x-auto border-b border-line">
        {(['overview', 'tasks', 'ideas', 'notes', 'git', 'readme'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium capitalize transition-colors ${tab === t ? 'border-brand text-brand-strong' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>

      <div className="py-4">
        {tab === 'overview' && <OverviewTab project={project} onChanged={onChanged} />}
        {tab === 'tasks' && <TasksTab projectId={project.id} onChanged={onChanged} />}
        {tab === 'ideas' && <IdeasTab projectId={project.id} onChanged={onChanged} />}
        {tab === 'notes' && <NotesTab projectId={project.id} onChanged={onChanged} />}
        {tab === 'git' && <GitTab projectId={project.id} hasGit={project.git.hasGit} />}
        {tab === 'readme' && <ReadmeTab projectId={project.id} />}
      </div>

      {confirmDelete && (
        <Modal title="Delete project?" onClose={() => setConfirmDelete(false)}>
          <p className="text-sm text-ink-soft">
            This removes <span className="font-semibold text-ink">{project.name}</span> from Launchpad
            (notes, ideas, tasks). Your files on disk are <span className="font-semibold">not</span> touched.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => guard(() => api.deleteProject(project.id).then(() => { setConfirmDelete(false); onChanged(); onBack() }), 'Deleted')}>Delete</Button>
          </div>
        </Modal>
      )}
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
      setName(''); setValue(''); setOpen(false); onAdded()
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    }
  }
  if (!open) return <IconButton title="Add launch profile" onClick={() => setOpen(true)}><IconPlus /></IconButton>
  return (
    <div className="flex items-center gap-1 rounded-lg border border-line bg-surface-1 p-1">
      <input className="w-24 rounded px-2 py-1 text-sm outline-none" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="rounded bg-surface-0 px-1 py-1 text-sm outline-none" value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="shell">shell</option><option value="vscode">vscode</option><option value="url">url</option><option value="folder">folder</option>
      </select>
      <input className="w-36 rounded px-2 py-1 text-sm outline-none" placeholder="command / url" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      <Button variant="primary" onClick={save}>Add</Button>
    </div>
  )
}

function OverviewTab({ project, onChanged }: { project: Project; onChanged: () => void }) {
  const [description, setDescription] = useState(project.description)
  const [dirty, setDirty] = useState(false)
  const toast = useToast()
  useEffect(() => { setDescription(project.description); setDirty(false) }, [project.id, project.description])
  const save = async () => {
    try { await api.updateProject(project.id, { description }); setDirty(false); onChanged(); toast('Saved') }
    catch (e) { toast(String(e instanceof Error ? e.message : e), 'error') }
  }
  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1 block text-sm font-medium text-ink-soft">Description</label>
        <textarea className={`${inputCls} min-h-[90px] resize-y`} value={description} onChange={(e) => { setDescription(e.target.value); setDirty(true) }} />
        {dirty && <div className="mt-2"><Button variant="primary" onClick={save}>Save description</Button></div>}
      </div>
      <AgentPanel project={project} />
      <AuditPanel projectId={project.id} />
    </div>
  )
}

// Everything needed to hand this specific project to an AI agent — no project-picking
// required on the agent's side.
function AgentPanel({ project }: { project: Project }) {
  const [copied, setCopied] = useState<string | null>(null)
  const toast = useToast()

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 1500)
  }

  const copyPrompt = async () => {
    try {
      const { prompt } = await api.agentPrompt(project.id)
      await copy('prompt', prompt)
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    }
  }

  const writeInstructions = async () => {
    try {
      const result = await api.writeAgentInstructions(project.id)
      toast(`${result.action === 'created' ? 'Created' : 'Updated'} ${result.path}`)
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    }
  }

  const commands = [
    `launchpad pull --project ${project.id}`,
    `launchpad audit --project ${project.id}`,
    `launchpad task add "…" --project ${project.id}`
  ]

  return (
    <div className="rounded-xl border border-brand/30 bg-brand-soft/50 p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-brand-strong">
        <IconRobot width={15} height={15} /> Hand this project to an agent
      </p>
      <p className="mt-1 text-sm text-ink-soft">
        This is <span className="font-semibold text-ink">Launchpad project #{project.id}</span>. Any{' '}
        <span className="font-mono">launchpad</span> command run inside the project folder targets it
        automatically; elsewhere, add <span className="font-mono">--project {project.id}</span>.
      </p>

      <div className="mt-3 space-y-1.5">
        {commands.map((cmd) => (
          <div key={cmd} className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-surface-0 px-3 py-1.5 font-mono text-xs text-ink ring-1 ring-line">{cmd}</code>
            <Button variant="ghost" onClick={() => copy(cmd, cmd)}>{copied === cmd ? 'Copied!' : 'Copy'}</Button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={copyPrompt}>
          {copied === 'prompt' ? 'Copied!' : 'Copy agent prompt'}
        </Button>
        <Button variant="subtle" onClick={writeInstructions}>Write CLAUDE.md block</Button>
      </div>
      <p className="mt-2 text-xs text-ink-faint">
        The prompt names this project explicitly. The CLAUDE.md block does the same inside the repo,
        so an agent opening the folder knows about Launchpad without being told.
      </p>
    </div>
  )
}

// What Launchpad still doesn't know about this project — the same list agents read.
function AuditPanel({ projectId }: { projectId: number }) {
  const [audit, setAudit] = useState<ProjectAudit | null>(null)
  useEffect(() => { api.auditProject(projectId).then(setAudit).catch(() => setAudit(null)) }, [projectId])
  if (!audit) return null
  return (
    <div className="rounded-xl border border-line bg-surface-0 p-4">
      <p className="text-sm font-semibold text-ink">Gaps</p>
      {audit.issues.length === 0 ? (
        <p className="mt-1 text-sm text-ink-soft">Nothing missing — description, tags and content are all filled in.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {audit.issues.map((issue) => (
            <li key={issue.code} className="text-sm text-ink-soft">· {issue.detail}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------- Tasks ----------
const TASK_NEXT: Record<TaskStatus, TaskStatus> = { todo: 'doing', doing: 'done', done: 'todo' }
const TASK_DOT: Record<TaskStatus, string> = { todo: 'border-stone-300', doing: 'border-amber-400 bg-amber-100', done: 'border-brand bg-brand' }
const COLUMNS: Array<{ key: TaskStatus; label: string }> = [
  { key: 'todo', label: 'To do' },
  { key: 'doing', label: 'Doing' },
  { key: 'done', label: 'Done' }
]

function TasksTab({ projectId, onChanged }: { projectId: number; onChanged: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [due, setDue] = useState('')
  const [board, setBoard] = useState(false)
  const [pf, setPf] = useState<'all' | Priority>('all')
  const [sf, setSf] = useState<'all' | TaskStatus>('all')
  const [showArchived, setShowArchived] = useState(false)

  const load = useCallback(
    () => api.listTasks(projectId, showArchived).then(setTasks),
    [projectId, showArchived]
  )
  useEffect(() => { load() }, [load])

  const add = async () => {
    if (!title.trim()) return
    const t = await api.createTask(projectId, { title: title.trim(), priority })
    if (due) await api.updateTask(t.id, { dueDate: due })
    setTitle(''); setDue(''); load(); onChanged()
  }
  const upd = async (id: number, patch: Parameters<typeof api.updateTask>[1]) => { await api.updateTask(id, patch); load(); onChanged() }
  const move = async (id: number, dir: 'up' | 'down') => { await api.moveTask(id, dir); load() }
  const archive = async (t: Task) => { await api.archiveItem('task', t.id, t.archivedAt === null); load(); onChanged() }
  const remove = async (id: number) => { await api.deleteTask(id); load(); onChanged() }

  const visible = useMemo(
    () => tasks.filter((t) => (pf === 'all' || t.priority === pf) && (sf === 'all' || t.status === sf)),
    [tasks, pf, sf]
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input className={`${inputCls} min-w-[160px] flex-1`} placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <input type="date" className="rounded-lg border border-line bg-surface-0 px-2 text-sm text-ink-soft outline-none" value={due} onChange={(e) => setDue(e.target.value)} />
        <select className="rounded-lg border border-line bg-surface-0 px-2 text-sm outline-none" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
          <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <Button variant="primary" onClick={add}><IconPlus /> Add</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button title={board ? 'List view' : 'Board view'} onClick={() => setBoard((b) => !b)} className="rounded-lg border border-line px-2 py-1.5 text-ink-soft">
          {board ? <IconList width={15} height={15} /> : <IconLayers width={15} height={15} />}
        </button>
        <select className="rounded-lg border border-line bg-surface-0 px-2 py-1 text-ink-soft outline-none" value={sf} onChange={(e) => setSf(e.target.value as typeof sf)}>
          <option value="all">All statuses</option><option value="todo">To do</option><option value="doing">Doing</option><option value="done">Done</option>
        </select>
        <select className="rounded-lg border border-line bg-surface-0 px-2 py-1 text-ink-soft outline-none" value={pf} onChange={(e) => setPf(e.target.value as typeof pf)}>
          <option value="all">All priorities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <label className="flex items-center gap-1.5 text-ink-soft">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No tasks" />
      ) : board ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {COLUMNS.map((col) => (
            <div key={col.key} className="rounded-xl border border-line bg-surface-1 p-2">
              <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">{col.label} ({visible.filter((t) => t.status === col.key).length})</p>
              <div className="space-y-2">
                {visible.filter((t) => t.status === col.key).map((t) => {
                  const dm = dueMeta(t.dueDate)
                  return (
                    <div key={t.id} className={`group rounded-lg bg-surface-0 p-2 ring-1 ring-line ${t.archivedAt ? 'opacity-60' : ''}`}>
                      <p className="text-sm text-ink">{t.title}</p>
                      {t.body && <p className="mt-0.5 whitespace-pre-wrap text-xs text-ink-soft">{t.body}</p>}
                      <div className="mt-1.5 flex items-center gap-1">
                        <Badge className={PRIORITY_CLS[t.priority]}>{t.priority}</Badge>
                        {dm && <Badge className={dm.cls}>{dm.label}</Badge>}
                        <ItemTags type="task" id={t.id} tags={t.tags} onChanged={load} />
                        <div className="ml-auto flex opacity-0 group-hover:opacity-100">
                          {col.key !== 'todo' && <IconButton title="Back" className="h-6 w-6" onClick={() => upd(t.id, { status: col.key === 'done' ? 'doing' : 'todo' })}>◀</IconButton>}
                          {col.key !== 'done' && <IconButton title="Forward" className="h-6 w-6" onClick={() => upd(t.id, { status: col.key === 'todo' ? 'doing' : 'done' })}>▶</IconButton>}
                          <IconButton title={t.archivedAt ? 'Unarchive' : 'Archive'} className="h-6 w-6" onClick={() => archive(t)}><IconArchive width={12} height={12} /></IconButton>
                          <IconButton title="Delete" className="h-6 w-6" onClick={() => remove(t.id)}><IconTrash width={12} height={12} /></IconButton>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface-0">
          {visible.map((t) => {
            const dm = dueMeta(t.dueDate)
            return (
              <li key={t.id} className={`group flex items-center gap-3 px-3 py-2.5 ${t.archivedAt ? 'opacity-60' : ''}`}>
                <button onClick={() => upd(t.id, { status: TASK_NEXT[t.status] })} title={t.status} className={`h-4 w-4 shrink-0 rounded-full border-2 ${TASK_DOT[t.status]}`} />
                <div className="min-w-0 flex-1">
                  <span className={`text-sm ${t.status === 'done' ? 'text-ink-faint line-through' : 'text-ink'}`}>{t.title}</span>
                  {t.body && <p className="whitespace-pre-wrap text-xs text-ink-soft">{t.body}</p>}
                </div>
                <ItemTags type="task" id={t.id} tags={t.tags} onChanged={load} />
                {dm && <Badge className={dm.cls}>{dm.label}</Badge>}
                <input type="date" title="Due date" className="w-[8.5rem] rounded border border-line bg-surface-0 px-1 text-xs text-ink-faint opacity-0 outline-none group-hover:opacity-100" value={t.dueDate ?? ''} onChange={(e) => upd(t.id, { dueDate: e.target.value || null })} />
                <Badge className={PRIORITY_CLS[t.priority]}>{t.priority}</Badge>
                <div className="flex opacity-0 group-hover:opacity-100">
                  <IconButton title="Up" className="h-7 w-7" onClick={() => move(t.id, 'up')}><IconArrowUp width={13} height={13} /></IconButton>
                  <IconButton title="Down" className="h-7 w-7" onClick={() => move(t.id, 'down')}><IconArrowDown width={13} height={13} /></IconButton>
                  <IconButton title={t.archivedAt ? 'Unarchive' : 'Archive'} className="h-7 w-7" onClick={() => archive(t)}><IconArchive width={14} height={14} /></IconButton>
                  <IconButton title="Delete" className="h-7 w-7" onClick={() => remove(t.id)}><IconTrash width={14} height={14} /></IconButton>
                </div>
              </li>
            )
          })}
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
  const [pf, setPf] = useState<'all' | Priority>('all')
  const [showArchived, setShowArchived] = useState(false)
  const toast = useToast()
  const load = useCallback(
    () => api.listIdeas(projectId, showArchived).then(setIdeas),
    [projectId, showArchived]
  )
  useEffect(() => { load() }, [load])

  const add = async () => { if (!title.trim()) return; await api.createIdea(projectId, { title: title.trim(), body: '', priority }); setTitle(''); load(); onChanged() }
  const promote = async (id: number) => { await api.promoteIdea(id, projectId); load(); onChanged(); toast('Promoted to task') }
  const toNote = async (i: Idea) => { await api.createNote(projectId, { title: i.title, body: i.body }); await api.updateIdea(i.id, { status: 'archived' }); load(); onChanged(); toast('Saved as note') }
  const archive = async (i: Idea) => { await api.archiveItem('idea', i.id, i.status !== 'archived'); load(); onChanged() }
  const remove = async (id: number) => { await api.deleteIdea(id); load(); onChanged() }

  const visible = ideas.filter((i) => pf === 'all' || i.priority === pf)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input className={`${inputCls} min-w-[160px] flex-1`} placeholder="Add an idea…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <select className="rounded-lg border border-line bg-surface-0 px-2 text-sm outline-none" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
          <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <Button variant="primary" onClick={add}><IconPlus /> Add</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="flex gap-1 rounded-lg bg-surface-2 p-0.5 w-fit">
          {(['all', 'high', 'medium', 'low'] as const).map((p) => (
            <button key={p} onClick={() => setPf(p)} className={`rounded-md px-2.5 py-1 font-medium capitalize ${pf === p ? 'bg-surface-0 text-ink shadow-sm' : 'text-ink-soft'}`}>{p}</button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-ink-soft">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>
      {visible.length === 0 ? (
        <EmptyState title="No ideas yet" hint="Park anything here — it costs nothing." />
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {visible.map((i) => (
            <div key={i.id} className={`group rounded-xl border border-line bg-surface-0 p-3 ${i.status === 'promoted' || i.status === 'archived' ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-ink">{i.title}</p>
                <Badge className={PRIORITY_CLS[i.priority]}>{i.priority}</Badge>
              </div>
              {i.body && <p className="mt-1 text-sm text-ink-soft">{i.body}</p>}
              <div className="mt-2"><ItemTags type="idea" id={i.id} tags={i.tags} onChanged={load} /></div>
              <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                {i.status === 'open' && <Button variant="ghost" onClick={() => promote(i.id)}>→ Task</Button>}
                {i.status === 'open' && <Button variant="ghost" onClick={() => toNote(i)}>→ Note</Button>}
                {i.status !== 'open' && <span className="text-xs text-ink-faint">{i.status}</span>}
                <IconButton title={i.status === 'archived' ? 'Unarchive' : 'Archive'} className="ml-auto" onClick={() => archive(i)}><IconArchive width={14} height={14} /></IconButton>
                <IconButton title="Delete" onClick={() => remove(i.id)}><IconTrash width={14} height={14} /></IconButton>
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
  const [q, setQ] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const load = useCallback(
    () => api.listNotes(projectId, showArchived).then(setNotes),
    [projectId, showArchived]
  )
  useEffect(() => { load() }, [load])

  const add = async () => { if (!title.trim() && !body.trim()) return; await api.createNote(projectId, { title: title.trim(), body: body.trim() }); setTitle(''); setBody(''); load(); onChanged() }
  const togglePin = async (n: Note) => { await api.updateNote(n.id, { pinned: !n.pinned }); load() }
  const archive = async (n: Note) => { await api.archiveItem('note', n.id, n.archivedAt === null); load(); onChanged() }
  const remove = async (id: number) => { await api.deleteNote(id); load(); onChanged() }

  const visible = notes.filter((n) => { const s = q.trim().toLowerCase(); return !s || `${n.title} ${n.body}`.toLowerCase().includes(s) })

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line bg-surface-0 p-3">
        <input className={`${inputCls} mb-2`} placeholder="Note title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className={`${inputCls} min-h-[70px] resize-y`} placeholder="Write freely — no format required…" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="mt-2"><Button variant="primary" onClick={add}><IconPlus /> Add note</Button></div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {notes.length > 3 && <input className={`${inputCls} flex-1`} placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)} />}
        <label className="flex items-center gap-1.5 text-ink-soft">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>
      {visible.length === 0 ? (
        <EmptyState title="No notes" />
      ) : (
        <div className="space-y-2">
          {visible.map((n) => (
            <div key={n.id} className={`group rounded-xl border bg-surface-0 p-3 ${n.pinned ? 'border-amber-200' : 'border-line'} ${n.archivedAt ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {n.title && <p className="text-sm font-semibold text-ink">{n.title}</p>}
                  {n.body && <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-soft">{n.body}</p>}
                </div>
                <div className="flex shrink-0">
                  <IconButton title={n.pinned ? 'Unpin' : 'Pin'} onClick={() => togglePin(n)}><IconStar width={14} height={14} className={n.pinned ? 'fill-amber-400 text-amber-400' : 'text-ink-faint'} /></IconButton>
                  <IconButton title={n.archivedAt ? 'Unarchive' : 'Archive'} className="opacity-0 group-hover:opacity-100" onClick={() => archive(n)}><IconArchive width={14} height={14} /></IconButton>
                  <IconButton title="Delete" className="opacity-0 group-hover:opacity-100" onClick={() => remove(n.id)}><IconTrash width={14} height={14} /></IconButton>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <ItemTags type="note" id={n.id} tags={n.tags} onChanged={load} />
                <p className="ml-auto text-xs text-ink-faint">{relativeTime(n.updatedAt)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- Git history ----------
function GitTab({ projectId, hasGit }: { projectId: number; hasGit: boolean }) {
  const [commits, setCommits] = useState<GitCommit[] | null>(null)
  useEffect(() => { if (hasGit) api.commits(projectId).then(setCommits); else setCommits([]) }, [projectId, hasGit])
  if (!hasGit) return <EmptyState title="No git repository" hint="This project isn't a git repo." />
  if (commits === null) return <div className="text-sm text-ink-faint">Loading…</div>
  if (commits.length === 0) return <EmptyState title="No commits" />
  return (
    <ul className="divide-y divide-line rounded-xl border border-line bg-surface-0">
      {commits.map((c) => (
        <li key={c.hash} className="flex items-start gap-3 px-3 py-2.5">
          <IconGitCommit className="mt-0.5 shrink-0 text-ink-faint" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-ink">{c.message}</p>
            <p className="text-xs text-ink-faint"><span className="font-mono">{c.hash}</span> · {c.author} · {relativeTime(c.date)}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

// ---------- README preview ----------
function ReadmeTab({ projectId }: { projectId: number }) {
  const [content, setContent] = useState<string | null>(null)
  useEffect(() => { api.readme(projectId).then((r) => setContent(r.content)) }, [projectId])
  if (content === null) return <div className="text-sm text-ink-faint">Loading…</div>
  if (!content.trim()) return <EmptyState title="No README.md" />
  return (
    <div className="lp-markdown rounded-xl border border-line bg-surface-0 p-5 text-sm text-ink" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
  )
}
