import { useEffect, useState } from 'react'
import type { CaptureKind, Project } from '../../../shared/types'
import { api } from '../api'
import { Button, inputCls, useToast } from './ui'
import { IconPlus } from './icons'

// Parse quick-capture hints: a URL (→ link), #project (→ target), and leading
// task:/idea:/note: keywords (→ kind). Everything is overridable via the selectors.
function parseCapture(raw: string, projects: Project[]) {
  let text = raw.trim()
  let kind: CaptureKind | null = null
  let projectId: number | null = null
  let url = ''

  const urlMatch = text.match(/https?:\/\/\S+/)
  if (urlMatch) {
    url = urlMatch[0]
    kind = 'link'
  }

  const tagMatch = text.match(/(^|\s)#([\w-]+)/)
  if (tagMatch) {
    const needle = tagMatch[2].toLowerCase()
    const p = projects.find((pp) => {
      const n = pp.name.toLowerCase()
      return n.replace(/\s+/g, '').includes(needle) || n.startsWith(needle)
    })
    if (p) projectId = p.id
    text = text.replace(tagMatch[0], ' ').trim()
  }

  if (/^(todo|task)[:\s]/i.test(text)) {
    kind = 'task'
    text = text.replace(/^(todo|task)[:\s]+/i, '')
  } else if (/^idea[:\s]/i.test(text)) {
    kind = 'idea'
    text = text.replace(/^idea[:\s]+/i, '')
  } else if (/^note[:\s]/i.test(text)) {
    kind = 'note'
    text = text.replace(/^note[:\s]+/i, '')
  }

  return { text: text.trim(), kind, projectId, url }
}

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
  const [kind, setKind] = useState<CaptureKind | 'auto'>('auto')
  const toast = useToast()

  useEffect(() => {
    setProjectId(defaultProjectId ? String(defaultProjectId) : '')
  }, [defaultProjectId])

  const submit = async () => {
    if (!text.trim()) return
    const parsed = parseCapture(text, projects)
    if (!parsed.text && !parsed.url) return
    const finalKind: CaptureKind = kind === 'auto' ? parsed.kind ?? 'note' : kind
    const finalProject = projectId ? Number(projectId) : parsed.projectId
    try {
      await api.createCapture({
        text: parsed.text || parsed.url,
        url: parsed.url,
        kind: finalKind,
        projectId: finalProject
      })
      setText('')
      toast('Captured')
      onCaptured()
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    }
  }

  return (
    <div className="flex items-center gap-2 border-b border-line bg-surface-0 px-3 py-2.5 sm:px-4">
      <input
        className={inputCls}
        placeholder="Capture… (try 'task: fix bug #myproj' or paste a link)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <select
        className="hidden shrink-0 rounded-lg border border-line bg-surface-0 px-2 py-2 text-sm text-ink-soft outline-none focus:border-brand sm:block"
        value={kind}
        onChange={(e) => setKind(e.target.value as CaptureKind | 'auto')}
      >
        <option value="auto">Auto</option>
        <option value="note">Note</option>
        <option value="idea">Idea</option>
        <option value="task">Task</option>
        <option value="link">Link</option>
      </select>
      <select
        className="hidden max-w-[9rem] shrink-0 rounded-lg border border-line bg-surface-0 px-2 py-2 text-sm text-ink-soft outline-none focus:border-brand sm:block"
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
      >
        <option value="">Inbox</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <Button variant="primary" onClick={submit} className="shrink-0">
        <IconPlus /> <span className="hidden sm:inline">Add</span>
      </Button>
    </div>
  )
}
