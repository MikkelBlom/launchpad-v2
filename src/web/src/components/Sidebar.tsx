import type { Project } from '../../../shared/types'
import { ACTIVITY_META } from '../format'
import { Button } from './ui'
import { IconGrid, IconInbox, IconPlus, IconRefresh, IconSettings, IconStar } from './icons'

type View = 'dashboard' | 'inbox' | 'settings'

export function Sidebar({
  projects,
  view,
  selectedId,
  inboxCount,
  scanning,
  onNav,
  onOpenProject,
  onNewProject,
  onScan
}: {
  projects: Project[]
  view: View
  selectedId: number | null
  inboxCount: number
  scanning: boolean
  onNav: (view: View) => void
  onOpenProject: (id: number) => void
  onNewProject: () => void
  onScan: () => void
}) {
  const favorites = projects.filter((p) => p.isFavorite)
  const rest = projects.filter((p) => !p.isFavorite)

  const navItem = (v: View, label: string, icon: React.ReactNode, badge?: number) => {
    const active = view === v && selectedId === null
    return (
      <button
        onClick={() => onNav(v)}
        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
          active ? 'bg-brand-soft text-brand-strong' : 'text-ink-soft hover:bg-surface-2'
        }`}
      >
        {icon}
        <span className="flex-1 text-left">{label}</span>
        {badge ? (
          <span className="rounded-full bg-brand px-1.5 text-xs font-semibold text-white">{badge}</span>
        ) : null}
      </button>
    )
  }

  const projectRow = (p: Project) => (
    <button
      key={p.id}
      onClick={() => onOpenProject(p.id)}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
        selectedId === p.id ? 'bg-surface-2 text-ink' : 'text-ink-soft hover:bg-surface-2'
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${ACTIVITY_META[p.activity].dot}`} />
      <span className="min-w-0 flex-1 truncate text-left">{p.name}</span>
      {p.isFavorite && <IconStar width={12} height={12} className="fill-amber-400 text-amber-400" />}
    </button>
  )

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-line bg-surface-0">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">
          L
        </div>
        <span className="text-[15px] font-semibold text-ink">Launchpad</span>
      </div>

      <div className="space-y-0.5 px-2">
        {navItem('dashboard', 'Projects', <IconGrid />)}
        {navItem('inbox', 'Inbox', <IconInbox />, inboxCount)}
        {navItem('settings', 'Settings', <IconSettings />)}
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-2">
        {favorites.length > 0 && (
          <>
            <p className="px-2.5 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Starred
            </p>
            {favorites.map(projectRow)}
          </>
        )}
        <p className="px-2.5 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          All projects
        </p>
        {rest.map(projectRow)}
      </div>

      <div className="space-y-2 border-t border-line p-3">
        <Button variant="primary" className="w-full justify-center" onClick={onNewProject}>
          <IconPlus /> New project
        </Button>
        <Button variant="ghost" className="w-full justify-center" onClick={onScan} disabled={scanning}>
          <IconRefresh /> {scanning ? 'Scanning…' : 'Scan for projects'}
        </Button>
      </div>
    </aside>
  )
}
