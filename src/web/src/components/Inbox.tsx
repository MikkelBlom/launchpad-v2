import { useCallback, useEffect, useState } from 'react'
import type { Capture, Project } from '../../../shared/types'
import { api } from '../api'
import { relativeTime } from '../format'
import { Button, EmptyState, IconButton, useToast } from './ui'
import { IconTrash } from './icons'

// The inbox turns loose captures into real items on a project.
export function Inbox({ projects, onChanged }: { projects: Project[]; onChanged: () => void }) {
  const [captures, setCaptures] = useState<Capture[] | null>(null)
  const toast = useToast()

  const load = useCallback(() => api.listCaptures().then(setCaptures), [])
  useEffect(() => {
    load()
  }, [load])

  const fileAway = async (capture: Capture, projectId: number, kind: 'task' | 'idea' | 'note') => {
    if (!projectId) {
      toast('Pick a project first', 'error')
      return
    }
    try {
      if (kind === 'task') await api.createTask(projectId, { title: capture.text, priority: 'medium' })
      else if (kind === 'idea') await api.createIdea(projectId, { title: capture.text, body: '', priority: 'medium' })
      else await api.createNote(projectId, { title: '', body: capture.text })
      await api.setCaptureProcessed(capture.id, true)
      load()
      onChanged()
      toast(`Filed as ${kind}`)
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    }
  }

  const remove = async (id: number) => {
    await api.deleteCapture(id)
    load()
    onChanged()
  }

  if (captures === null) return <div className="p-8 text-sm text-ink-faint">Loading…</div>

  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <h1 className="mb-1 text-xl font-semibold text-ink">Inbox</h1>
      <p className="mb-4 text-sm text-ink-soft">Loose captures waiting to be filed onto a project.</p>
      {captures.length === 0 ? (
        <EmptyState title="Inbox zero" hint="Capture thoughts from the bar at the top — they land here." />
      ) : (
        <div className="space-y-2">
          {captures.map((c) => (
            <InboxRow key={c.id} capture={c} projects={projects} onFile={fileAway} onRemove={remove} />
          ))}
        </div>
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
  onFile: (c: Capture, projectId: number, kind: 'task' | 'idea' | 'note') => void
  onRemove: (id: number) => void
}) {
  const [projectId, setProjectId] = useState<string>(capture.projectId ? String(capture.projectId) : '')

  return (
    <div className="rounded-xl border border-line bg-surface-0 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-ink">{capture.text}</p>
        <IconButton title="Delete" className="shrink-0" onClick={() => onRemove(capture.id)}>
          <IconTrash width={14} height={14} />
        </IconButton>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-faint">{relativeTime(capture.createdAt)}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <select
            className="rounded-lg border border-line bg-surface-0 px-2 py-1 text-sm text-ink-soft outline-none focus:border-brand"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">Choose project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Button variant="ghost" onClick={() => onFile(capture, Number(projectId), 'task')}>
            Task
          </Button>
          <Button variant="ghost" onClick={() => onFile(capture, Number(projectId), 'idea')}>
            Idea
          </Button>
          <Button variant="ghost" onClick={() => onFile(capture, Number(projectId), 'note')}>
            Note
          </Button>
        </div>
      </div>
    </div>
  )
}
