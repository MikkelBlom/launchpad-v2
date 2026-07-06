import { useMemo, useState } from 'react'
import type { GitActivity, Project } from '../../../shared/types'
import { ProjectCard } from './ProjectCard'
import { Button, EmptyState, inputCls } from './ui'
import { IconPlus, IconRefresh, IconSearch } from './icons'

type ActivityFilter = 'all' | GitActivity

const FILTERS: Array<{ key: ActivityFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'fresh', label: 'Fresh' },
  { key: 'recent', label: 'Recent' },
  { key: 'stalled', label: 'Stalled' },
  { key: 'dormant', label: 'Dormant' }
]

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

  const filtered = useMemo(() => {
    if (!projects) return []
    const q = query.trim().toLowerCase()
    return projects.filter((p) => {
      if (filter !== 'all' && p.activity !== filter) return false
      if (q && !(`${p.name} ${p.description}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [projects, query, filter])

  if (projects === null) {
    return <div className="p-8 text-sm text-ink-faint">Loading…</div>
  }

  if (projects.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <EmptyState
          title="No projects yet"
          hint="Add a project root in Settings and scan, or create a new project."
        />
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="primary" onClick={onNewProject}>
            <IconPlus /> New project
          </Button>
          <Button variant="subtle" onClick={onScan} disabled={scanning}>
            <IconRefresh /> {scanning ? 'Scanning…' : 'Scan for projects'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-6 py-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            className={`${inputCls} pl-9`}
            placeholder="Search projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-1 rounded-lg bg-surface-2 p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
                filter === f.key ? 'bg-surface-0 text-ink shadow-sm' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No projects match" hint="Try a different search or filter." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => (
            <ProjectCard key={p.id} project={p} onOpen={() => onOpenProject(p.id)} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  )
}
