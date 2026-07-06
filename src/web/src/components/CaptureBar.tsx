import { useEffect, useState } from 'react'
import type { Project } from '../../../shared/types'
import { api } from '../api'
import { Button, inputCls, useToast } from './ui'
import { IconPlus } from './icons'

// Always-visible quick capture. A stray thought goes into the inbox (or straight at a
// project) in two seconds, no format required.
export function CaptureBar({
  projects,
  defaultProjectId,
  onCaptured
}: {
  projects: Project[]
  defaultProjectId: number | null
  onCaptured: () => void
}) {
  const [text, setText] = useState('')
  const [projectId, setProjectId] = useState<string>('')
  const toast = useToast()

  useEffect(() => {
    setProjectId(defaultProjectId ? String(defaultProjectId) : '')
  }, [defaultProjectId])

  const submit = async () => {
    const trimmed = text.trim()
    if (!trimmed) return
    try {
      await api.createCapture({
        text: trimmed,
        projectId: projectId ? Number(projectId) : null
      })
      setText('')
      toast('Captured')
      onCaptured()
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    }
  }

  return (
    <div className="flex items-center gap-2 border-b border-line bg-surface-0 px-4 py-2.5">
      <input
        className={inputCls}
        placeholder="Capture a thought, idea, or task…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <select
        className="shrink-0 rounded-lg border border-line bg-surface-0 px-2 py-2 text-sm text-ink-soft outline-none focus:border-brand"
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
      >
        <option value="">Inbox</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <Button variant="primary" onClick={submit} className="shrink-0">
        <IconPlus /> Add
      </Button>
    </div>
  )
}
