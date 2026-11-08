import { useEffect, useMemo, useRef, useState } from 'react'
import type { Project, SearchHit } from '../../../shared/types'
import { api } from '../api'

export type PaletteAction = 'new' | 'scan' | 'dashboard' | 'inbox' | 'needs-mikkel' | 'activity' | 'timeline' | 'settings'

interface Item {
  key: string
  label: string
  hint?: string
  run: () => void
}

export function CommandPalette({
  projects,
  onClose,
  onOpenProject,
  onAction
}: {
  projects: Project[]
  onClose: () => void
  onOpenProject: (id: number) => void
  onAction: (action: PaletteAction) => void
}) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setHits([])
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      api.search(q).then((r) => !cancelled && setHits(r.filter((h) => h.type !== 'project')))
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase()
    const actions: Item[] = [
      { key: 'a-new', label: 'New project', hint: 'action', run: () => onAction('new') },
      { key: 'a-scan', label: 'Scan for projects', hint: 'action', run: () => onAction('scan') },
      { key: 'a-activity', label: 'Go to Activity', hint: 'action', run: () => onAction('activity') },
      { key: 'a-timeline', label: 'Go to Timeline (this week)', hint: 'action', run: () => onAction('timeline') },
      { key: 'a-inbox', label: 'Go to Inbox', hint: 'action', run: () => onAction('inbox') },
      { key: 'a-needs-mikkel', label: 'Go to Needs Mikkel', hint: 'action', run: () => onAction('needs-mikkel') },
      { key: 'a-settings', label: 'Go to Settings', hint: 'action', run: () => onAction('settings') }
    ].filter((a) => !q || a.label.toLowerCase().includes(q))

    const projectItems: Item[] = projects
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((p) => ({
        key: `p-${p.id}`,
        label: p.name,
        hint: 'project',
        run: () => onOpenProject(p.id)
      }))

    const hitItems: Item[] = hits.slice(0, 8).map((h) => ({
      key: `h-${h.type}-${h.id}`,
      label: h.title,
      hint: `${h.type} · ${h.projectName}`,
      run: () => onOpenProject(h.projectId)
    }))

    return [...projectItems, ...hitItems, ...actions]
  }, [query, projects, hits, onAction, onOpenProject])

  useEffect(() => {
    setActive(0)
  }, [query])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      items[active]?.run()
      onClose()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/30 p-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl bg-surface-0 shadow-xl ring-1 ring-line"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder="Jump to a project, search, or run an action…"
          className="w-full border-b border-line px-4 py-3 text-[15px] text-ink outline-none"
        />
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-faint">No matches</p>
          ) : (
            items.map((item, i) => (
              <button
                key={item.key}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  item.run()
                  onClose()
                }}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${
                  i === active ? 'bg-brand-soft text-brand-strong' : 'text-ink hover:bg-surface-1'
                }`}
              >
                <span className="truncate">{item.label}</span>
                {item.hint && <span className="shrink-0 text-xs text-ink-faint">{item.hint}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
