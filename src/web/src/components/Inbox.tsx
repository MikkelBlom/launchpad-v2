import { useCallback, useEffect, useState } from 'react'
import type { Capture, CaptureKind, Project } from '../../../shared/types'
import { api } from '../api'
import { relativeTime } from '../format'
import { Button, EmptyState, IconButton, useToast } from './ui'
import { IconTrash } from './icons'

const KIND_LABEL: Record<CaptureKind, string> = { note: 'Note', idea: 'Idea', task: 'Task', link: 'Link' }

async function fileCapture(capture: Capture, projectId: number, as: 'task' | 'idea' | 'note') {
  const text = capture.text + (capture.url && !capture.text.includes(capture.url) ? ` ${capture.url}` : '')
  if (as === 'task') await api.createTask(projectId, { title: capture.text, priority: 'medium' })
  else if (as === 'idea') await api.createIdea(projectId, { title: capture.text, body: '', priority: 'medium' })
  else await api.createNote(projectId, { title: '', body: text })
  await api.setCaptureProcessed(capture.id, true)
}

export function Inbox({ projects, onChanged }: { projects: Project[]; onChanged: () => void }) {
  const [captures, setCaptures] = useState<Capture[] | null>(null)
  const [bulkProject, setBulkProject] = useState('')
  const toast = useToast()

  const load = useCallback(() => api.listCaptures().then(setCaptures), [])
  useEffect(() => { load() }, [load])

  const fileAway = async (capture: Capture, projectId: number, as: 'task' | 'idea' | 'note') => {
    if (!projectId) return toast('Pick a project first', 'error')
    try {
      await fileCapture(capture, projectId, as)
      load(); onChanged(); toast(`Filed as ${as}`)
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    }
  }

  const fileAll = async () => {
    const pid = Number(bulkProject)
    if (!pid) return toast('Pick a project for "file all"', 'error')
    try {
      for (const c of captures ?? []) {
        const as = c.kind === 'task' ? 'task' : c.kind === 'idea' ? 'idea' : 'note'
        await fileCapture(c, c.projectId ?? pid, as)
      }
      load(); onChanged(); toast('Filed all')
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    }
  }

  const clearAll = async () => {
    for (const c of captures ?? []) await api.deleteCapture(c.id)
    load(); onChanged(); toast('Inbox cleared')
  }

  const remove = async (id: number) => { await api.deleteCapture(id); load(); onChanged() }

  if (captures === null) return <div className="p-8 text-sm text-ink-faint">Loading…</div>

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <h1 className="mb-1 text-xl font-semibold text-ink">Inbox</h1>
      <p className="mb-4 text-sm text-ink-soft">Loose captures waiting to be filed onto a project.</p>

      {captures.length === 0 ? (
        <EmptyState title="Inbox zero" hint="Capture thoughts from the bar at the top — they land here." />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2">
            <span className="text-sm text-ink-soft">{captures.length} item(s)</span>
            <select className="ml-auto rounded-lg border border-line bg-surface-0 px-2 py-1 text-sm text-ink-soft outline-none" value={bulkProject} onChange={(e) => setBulkProject(e.target.value)}>
              <option value="">Default project…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <Button variant="subtle" onClick={fileAll}>File all</Button>
            <Button variant="danger" onClick={clearAll}>Clear all</Button>
          </div>
          <div className="space-y-2">
            {captures.map((c) => (
              <InboxRow key={c.id} capture={c} projects={projects} onFile={fileAway} onRemove={remove} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function InboxRow({
  capture,
  projects,
  onFile,
  onRemove
}: {
  capture: Capture
  projects: Project[]
  onFile: (c: Capture, projectId: number, as: 'task' | 'idea' | 'note') => void
  onRemove: (id: number) => void
}) {
  const [projectId, setProjectId] = useState<string>(capture.projectId ? String(capture.projectId) : '')
  return (
    <div className="rounded-xl border border-line bg-surface-0 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-ink">{capture.text}</p>
          {capture.url && <a href={capture.url} target="_blank" rel="noopener" className="text-xs text-brand underline">{capture.url}</a>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-faint">{KIND_LABEL[capture.kind]}</span>
          <IconButton title="Delete" onClick={() => onRemove(capture.id)}><IconTrash width={14} height={14} /></IconButton>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-faint">{relativeTime(capture.createdAt)}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <select className="rounded-lg border border-line bg-surface-0 px-2 py-1 text-sm text-ink-soft outline-none focus:border-brand" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Choose project…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Button variant="ghost" onClick={() => onFile(capture, Number(projectId), 'task')}>Task</Button>
          <Button variant="ghost" onClick={() => onFile(capture, Number(projectId), 'idea')}>Idea</Button>
          <Button variant="ghost" onClick={() => onFile(capture, Number(projectId), 'note')}>Note</Button>
        </div>
      </div>
    </div>
  )
}
