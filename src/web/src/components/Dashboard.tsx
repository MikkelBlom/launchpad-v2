import { useEffect, useMemo, useRef, useState } from 'react'
import type { GitActivity, Project, ProjectStatus, Tag } from '../../../shared/types'
import { api } from '../api'
import { ProjectCard } from './ProjectCard'
import { Button, EmptyState, inputCls, useToast } from './ui'
import { IconLayers, IconList, IconPlus, IconRefresh, IconSearch } from './icons'
import { STATUS_META } from '../format'

type ActivityFilter = 'all' | GitActivity
type SortKey = 'activity' | 'name' | 'created' | 'commit' | 'tasks'

const FILTERS: Array<{ key: ActivityFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'fresh', label: 'Fresh' },
  { key: 'recent', label: 'Recent' },
  { key: 'stalled', label: 'Stalled' },
  { key: 'dormant', label: 'Dormant' }
]

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'activity', label: 'Recent activity' },
  { key: 'name', label: 'Name' },
  { key: 'created', label: 'Newest' },
  { key: 'commit', label: 'Last commit' },
  { key: 'tasks', label: 'Open tasks' }
]

const STATUS_ORDER: ProjectStatus[] = ['active', 'idea', 'on-hold', 'done', 'archived']

function ts(iso: string | null): number {
  return iso ? new Date(iso).getTime() || 0 : 0
}

function sortProjects(list: Project[], sort: SortKey): Project[] {
  const copy = [...list]
  copy.sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1
    switch (sort) {
      case 'name':
        return a.name.localeCompare(b.name)
      case 'created':
        return ts(b.createdAt) - ts(a.createdAt)
      case 'commit':
      case 'activity':
        return ts(b.git.lastCommitAt) - ts(a.git.lastCommitAt)
      case 'tasks':
        return b.counts.openTasks - a.counts.openTasks
      default:
        return 0
    }
  })
  return copy
}

function StatTile({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-0 px-3 py-2">
      <div className={`text-lg font-semibold ${accent ?? 'text-ink'}`}>{value}</div>
      <div className="text-xs text-ink-faint">{label}</div>
    </div>
  )
}

export function Dashboard({
  projects,
  onOpenProject,
  onChanged,
  onNewProject,
  onScan,
  scanning
}: {
  projects: Project[] | null
  onOpenProject: (id: number) => void
  onChanged: () => void
  onNewProject: () => void
  onScan: () => void
  scanning: boolean
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ActivityFilter>('all')
  const [sort, setSort] = useState<SortKey>('activity')
  const [grouped, setGrouped] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [activeTags, setActiveTags] = useState<Set<number>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const searchRef = useRef<HTMLInputElement>(null)
  const toast = useToast()

  useEffect(() => {
    const focus = () => searchRef.current?.focus()
    window.addEventListener('lp:focus-search', focus)
    return () => window.removeEventListener('lp:focus-search', focus)
  }, [])

  // Initialize sort/grouping from saved preferences.
  useEffect(() => {
    api.getSettings().then((s) => {
      setSort((s.defaultSort as SortKey) || 'activity')
      setGrouped(s.groupByStatus)
    })
  }, [])

  const allTags = useMemo(() => {
    const map = new Map<number, Tag>()
    for (const p of projects ?? []) for (const t of p.tags) map.set(t.id, t)
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [projects])

  const stats = useMemo(() => {
    const p = projects ?? []
    return {
      total: p.length,
      active: p.filter((x) => x.status === 'active').length,
      dirty: p.filter((x) => x.git.dirty).length,
      stalled: p.filter((x) => x.status === 'active' && (x.activity === 'stalled' || x.activity === 'dormant')).length,
      openTasks: p.reduce((s, x) => s + x.counts.openTasks, 0)
    }
  }, [projects])

  const needsAttention = useMemo(() => {
    return (projects ?? []).filter(
      (p) => p.status === 'active' && (p.git.dirty || p.activity === 'stalled' || p.activity === 'dormant')
    )
  }, [projects])

  const filtered = useMemo(() => {
    if (!projects) return []
    const q = query.trim().toLowerCase()
    const list = projects.filter((p) => {
      if (!showArchived && p.status === 'archived') return false
      if (filter !== 'all' && p.activity !== filter) return false
      if (activeTags.size > 0 && !Array.from(activeTags).every((id) => p.tags.some((t) => t.id === id))) return false
      if (q && !`${p.name} ${p.description}`.toLowerCase().includes(q)) return false
      return true
    })
    return sortProjects(list, sort)
  }, [projects, query, filter, activeTags, showArchived, sort])

  const toggleSelect = (id: number) => {
    setSelected((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const bulk = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn()
      setSelected(new Set())
      setSelectMode(false)
      onChanged()
      toast(msg)
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    }
  }

  if (projects === null) return <div className="p-8 text-sm text-ink-faint">Loading…</div>

  if (projects.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <EmptyState title="No projects yet" hint="Add a project root in Settings and scan, or create a new project." />
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="primary" onClick={onNewProject}><IconPlus /> New project</Button>
          <Button variant="subtle" onClick={onScan} disabled={scanning}>
            <IconRefresh /> {scanning ? 'Scanning…' : 'Scan for projects'}
          </Button>
        </div>
      </div>
    )
  }

  const ids = filtered.map((p) => p.id)

  const renderGrid = (list: Project[]) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {list.map((p) => (
        <ProjectCard
          key={p.id}
          project={p}
          onOpen={() => (selectMode ? toggleSelect(p.id) : onOpenProject(p.id))}
          onChanged={onChanged}
          selectable={selectMode}
          selected={selected.has(p.id)}
          onToggleSelect={() => toggleSelect(p.id)}
        />
      ))}
    </div>
  )

  return (
    <div className="px-6 py-5">
      {/* Stats */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <StatTile label="Projects" value={stats.total} />
        <StatTile label="Active" value={stats.active} accent="text-brand-strong" />
        <StatTile label="Uncommitted" value={stats.dirty} accent={stats.dirty ? 'text-amber-600' : undefined} />
        <StatTile label="Stalled active" value={stats.stalled} accent={stats.stalled ? 'text-rose-600' : undefined} />
        <StatTile label="Open tasks" value={stats.openTasks} />
      </div>

      {/* Needs attention */}
      {needsAttention.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">Needs attention</p>
          <div className="flex flex-wrap gap-1.5">
            {needsAttention.slice(0, 12).map((p) => (
              <button
                key={p.id}
                onClick={() => onOpenProject(p.id)}
                className="rounded-full bg-surface-0 px-2.5 py-1 text-xs text-ink-soft ring-1 ring-amber-200 hover:bg-amber-100"
              >
                {p.name} · {p.git.dirty ? 'uncommitted' : p.activity}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input ref={searchRef} className={`${inputCls} pl-9`} placeholder="Search projects… ( / )" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="rounded-lg border border-line bg-surface-0 px-2 py-2 text-sm text-ink-soft outline-none" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          {SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
        </select>
        <button title={grouped ? 'Ungroup' : 'Group by status'} onClick={() => setGrouped((g) => !g)} className={`rounded-lg border px-2.5 py-2 ${grouped ? 'border-brand bg-brand-soft text-brand-strong' : 'border-line text-ink-soft'}`}>
          {grouped ? <IconLayers width={15} height={15} /> : <IconList width={15} height={15} />}
        </button>
        <Button variant={selectMode ? 'primary' : 'subtle'} onClick={() => { setSelectMode((m) => !m); setSelected(new Set()) }}>
          {selectMode ? 'Done' : 'Select'}
        </Button>
      </div>

      {/* Filter chips + tags */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-surface-2 p-0.5">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} className={`rounded-md px-2.5 py-1 text-sm font-medium ${filter === f.key ? 'bg-surface-0 text-ink shadow-sm' : 'text-ink-soft hover:text-ink'}`}>{f.label}</button>
          ))}
        </div>
        {allTags.map((t) => {
          const on = activeTags.has(t.id)
          return (
            <button
              key={t.id}
              onClick={() => setActiveTags((s) => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n })}
              className="rounded-full px-2.5 py-1 text-xs font-medium"
              style={{ backgroundColor: on ? t.color : `${t.color}22`, color: on ? '#fff' : t.color }}
            >
              #{t.name}
            </button>
          )
        })}
        <label className="ml-auto flex items-center gap-1.5 text-sm text-ink-soft">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      {/* Bulk action bar */}
      {selectMode && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-ink px-3 py-2 text-sm text-white">
          <span>{selected.size} selected</span>
          <button className="rounded px-2 py-1 hover:bg-white/10" onClick={() => setSelected(new Set(ids))}>Select all</button>
          <div className="ml-auto flex gap-1.5">
            <button className="rounded bg-white/15 px-2 py-1 hover:bg-white/25" onClick={() => bulk(() => api.bulkUpdate([...selected], { status: 'archived' }), 'Archived')}>Archive</button>
            <button className="rounded bg-white/15 px-2 py-1 hover:bg-white/25" onClick={() => bulk(() => api.bulkUpdate([...selected], { status: 'active' }), 'Set active')}>Set active</button>
            <button className="rounded bg-rose-500 px-2 py-1 hover:bg-rose-600" onClick={() => bulk(() => api.bulkDelete([...selected]), 'Deleted')}>Delete</button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState title="No projects match" hint="Try a different search, filter, or tag." />
      ) : grouped ? (
        <div className="space-y-6">
          {STATUS_ORDER.map((status) => {
            const list = filtered.filter((p) => p.status === status)
            if (list.length === 0) return null
            return (
              <div key={status}>
                <h2 className="mb-2 text-sm font-semibold text-ink-soft">{STATUS_META[status].label} <span className="text-ink-faint">({list.length})</span></h2>
                {renderGrid(list)}
              </div>
            )
          })}
        </div>
      ) : (
        renderGrid(filtered)
      )}
    </div>
  )
}
