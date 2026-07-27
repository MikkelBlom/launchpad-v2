import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CaptureKind, Project } from '../../../shared/types'
import { api } from '../api'
import { Button, inputCls, useToast } from './ui'
import { IconInbox, IconPlus } from './icons'

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
    const p = projects.find((pp) => matchesNeedle(pp, needle))
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

// The single fuzzy rule used both by parseCapture and by the #project suggestions,
// so what the dropdown offers is always what the parser will actually resolve.
function matchesNeedle(project: Project, needle: string) {
  const n = project.name.toLowerCase()
  return n.replace(/\s+/g, '').includes(needle) || n.startsWith(needle)
}

// The literal token parseCapture reads back: #([\w-]+)
function projectTag(project: Project) {
  return project.name.toLowerCase().replace(/[^\w-]+/g, '')
}

const KIND_LABEL: Record<CaptureKind, string> = {
  note: 'Note',
  idea: 'Idea',
  task: 'Task',
  link: 'Link'
}

const PREFIXES = [
  { value: 'task:', hint: 'Something to do' },
  { value: 'idea:', hint: 'Something to explore' },
  { value: 'note:', hint: 'Something to remember' }
]

interface Suggestion {
  key: string
  label: string
  hint: string
  apply: () => void
}

const selectCls =
  'shrink-0 rounded-md border border-line bg-surface-0 px-1.5 py-1 text-xs text-ink outline-none focus:border-brand disabled:cursor-not-allowed disabled:text-ink-soft disabled:opacity-70'

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
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(-1)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingCaret = useRef<number | null>(null)
  const toast = useToast()

  useEffect(() => {
    setProjectId(defaultProjectId ? String(defaultProjectId) : '')
  }, [defaultProjectId])

  // Put the caret back where the completion left it, after React has written the value.
  useEffect(() => {
    const next = pendingCaret.current
    if (next == null) return
    pendingCaret.current = null
    inputRef.current?.setSelectionRange(next, next)
  }, [text])

  const applyEdit = useCallback((next: string, nextCaret: number) => {
    pendingCaret.current = nextCaret
    setText(next)
    setCaret(nextCaret)
    setActive(-1)
    setDismissed(false)
    inputRef.current?.focus()
  }, [])

  // What will actually happen — derived from parseCapture so the preview can never
  // disagree with submit().
  const parsed = useMemo(() => parseCapture(text, projects), [text, projects])
  const tagProject = useMemo(
    () => (parsed.projectId == null ? null : projects.find((p) => p.id === parsed.projectId) ?? null),
    [parsed.projectId, projects]
  )
  const finalKind: CaptureKind = kind === 'auto' ? parsed.kind ?? 'note' : kind
  const finalProjectId = tagProject ? tagProject.id : projectId ? Number(projectId) : null
  const destination = tagProject ?? projects.find((p) => p.id === finalProjectId) ?? null

  // Suggestions: a #project completion while a tag is being typed, otherwise the
  // available syntax prefixes while the first word is still being written.
  const { mode, items } = useMemo<{ mode: 'tag' | 'prefix' | 'none'; items: Suggestion[] }>(() => {
    const before = text.slice(0, caret)

    const tagMatch = before.match(/(^|\s)#([\w-]*)$/)
    if (tagMatch) {
      const needle = tagMatch[2].toLowerCase()
      const start = caret - tagMatch[2].length - 1
      const after = text.slice(caret)
      const tagItems = projects
        .filter((p) => matchesNeedle(p, needle) && projectTag(p))
        .slice(0, 6)
        .map<Suggestion>((p) => ({
          key: `tag-${p.id}`,
          label: `#${projectTag(p)}`,
          hint: p.name,
          apply: () => {
            const insert = `#${projectTag(p)}${after.startsWith(' ') ? '' : ' '}`
            applyEdit(text.slice(0, start) + insert + after, start + insert.length)
          }
        }))
      return { mode: 'tag', items: tagItems }
    }

    // Still on the first word, and no prefix has been committed yet.
    if (/\s/.test(before) || /^(todo|task|idea|note)[:\s]/i.test(text)) return { mode: 'none', items: [] }

    const word = before.toLowerCase()
    const rest = text.slice(before.length).trimStart()
    const prefixItems = PREFIXES.filter((p) => p.value.startsWith(word)).map<Suggestion>((p) => ({
      key: `pre-${p.value}`,
      label: p.value,
      hint: p.hint,
      apply: () => applyEdit(`${p.value} ${rest}`, p.value.length + 1)
    }))
    if (!word) {
      prefixItems.push({
        key: 'pre-tag',
        label: '#project',
        hint: 'File it under a project',
        apply: () => applyEdit(`#${text}`, 1)
      })
    }
    return { mode: 'prefix', items: prefixItems }
  }, [text, caret, projects, applyEdit])

  const open = focused && !dismissed && items.length > 0
  const highlighted = open && active >= 0 ? items[active] ?? null : null

  const submit = async () => {
    if (!text.trim()) return
    if (!parsed.text && !parsed.url) return
    try {
      await api.createCapture({
        text: parsed.text || parsed.url,
        url: parsed.url,
        kind: finalKind,
        projectId: finalProjectId
      })
      setText('')
      setCaret(0)
      setActive(-1)
      toast('Captured')
      onCaptured()
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return
      e.preventDefault()
      setDismissed(false)
      const down = e.key === 'ArrowDown'
      setActive((a) => {
        if (down) return a + 1 >= items.length ? 0 : a + 1
        return a <= 0 ? items.length - 1 : a - 1
      })
      return
    }
    if (e.key === 'Escape') {
      if (!open) return
      e.preventDefault()
      setDismissed(true)
      setActive(-1)
      return
    }
    if (e.key === 'Tab') {
      // Tab completes an obvious #project match even when nothing is highlighted.
      const pick = highlighted ?? (open && mode === 'tag' ? items[0] ?? null : null)
      if (!pick) return
      e.preventDefault()
      pick.apply()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (highlighted) highlighted.apply()
      else submit()
    }
  }

  return (
    <div className="relative z-20 border-b border-line bg-surface-2 px-3 py-2 sm:px-4">
      <div className="flex items-start gap-2">
        <span
          className="mt-2 inline-flex shrink-0 items-center gap-1.5 self-start rounded-md bg-brand-soft px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-brand-strong"
          title="Global quick capture — available from every view and never tied to the project you have open"
        >
          <IconInbox width={13} height={13} />
          <span className="hidden sm:inline">Quick capture</span>
        </span>

        <div className="min-w-0 flex-1">
          <div className="relative">
            <input
              ref={inputRef}
              className={inputCls}
              placeholder="Capture anything… try 'task: fix bug #project' or paste a link"
              value={text}
              autoComplete="off"
              aria-label="Quick capture"
              aria-expanded={open}
              onChange={(e) => {
                setText(e.target.value)
                setCaret(e.target.selectionStart ?? e.target.value.length)
                setActive(-1)
                setDismissed(false)
              }}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
              onFocus={(e) => {
                setFocused(true)
                setCaret(e.currentTarget.selectionStart ?? 0)
              }}
              onBlur={() => {
                setFocused(false)
                setActive(-1)
              }}
              onKeyDown={onKeyDown}
            />

            {open && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-line bg-surface-0 py-1 shadow-lg">
                {items.map((item, i) => (
                  <button
                    key={item.key}
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => item.apply()}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm ${
                      i === active ? 'bg-brand-soft text-brand-strong' : 'text-ink hover:bg-surface-1'
                    }`}
                  >
                    <span className="truncate font-medium">{item.label}</span>
                    <span className="shrink-0 truncate text-xs text-ink-faint">{item.hint}</span>
                  </button>
                ))}
                <p className="mt-1 border-t border-line px-3 pt-1.5 text-[11px] text-ink-faint">
                  ↑↓ to pick · Enter to insert · Esc to dismiss
                </p>
              </div>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
            <span className="text-ink-faint">Global · goes to</span>
            <select
              className={`max-w-[10rem] ${selectCls}`}
              aria-label="Capture destination"
              disabled={!!tagProject}
              title={
                tagProject
                  ? `Destination comes from #${projectTag(tagProject)} in the text — remove the tag to choose here`
                  : 'Where this capture is filed'
              }
              value={tagProject ? String(tagProject.id) : projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">Inbox (unfiled)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <span className="text-ink-faint">as</span>
            <select
              className={selectCls}
              aria-label="Capture kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as CaptureKind | 'auto')}
            >
              <option value="auto">Auto</option>
              <option value="note">Note</option>
              <option value="idea">Idea</option>
              <option value="task">Task</option>
              <option value="link">Link</option>
            </select>

            <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface-0 px-2 py-1 text-[11px] font-medium">
              <span className="text-ink">{KIND_LABEL[finalKind]}</span>
              <span className="text-ink-faint">→</span>
              <span className={destination ? 'text-brand-strong' : 'text-ink-soft'}>
                {destination ? destination.name : 'Inbox'}
              </span>
            </span>
          </div>
        </div>

        <Button variant="primary" onClick={submit} className="mt-0.5 shrink-0">
          <IconPlus /> <span className="hidden sm:inline">Add</span>
        </Button>
      </div>
    </div>
  )
}
