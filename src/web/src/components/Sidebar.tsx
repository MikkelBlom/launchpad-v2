import type { Project } from '../../../shared/types'
import { ACTIVITY_META } from '../format'
import { Button } from './ui'
import { IconGitCommit, IconGrid, IconInbox, IconPlus, IconRefresh, IconSearch, IconSettings, IconStar } from './icons'

type View = 'dashboard' | 'inbox' | 'activity' | 'settings'

export function Sidebar({
  projects,
  view,
  selectedId,
  inboxCount,
  scanning,
  onNav,
  onOpenProject,
  onNewProject,
  onScan,
  onOpenPalette,
  open,
  onClose
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
  onOpenPalette: () => void
  open: boolean
  onClose: () => void
}) {
  const favorites = projects.filter((p) => p.isFavorite)
  const rest = projects.filter((p) => !p.isFavorite)

  const navItem = (v: View, label: string, icon: React.ReactNode, badge?: number) => {
    const active = view === v && selectedId === null
    return (
      <button
        onClick={() => { onNav(v); onClose() }}
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
      onClick={() => { onOpenProject(p.id); onClose() }}
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
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/30 sm:hidden" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-line bg-surface-0 transition-transform sm:static sm:z-auto sm:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">
          L
        </div>
        <span className="text-[15px] font-semibold text-ink">Launchpad</span>
      </div>

      <div className="px-2 pb-1">
        <button
          onClick={onOpenPalette}
          className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface-1 px-2.5 py-1.5 text-sm text-ink-faint hover:bg-surface-2"
        >
          <IconSearch width={14} height={14} />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="rounded bg-surface-0 px-1 text-[10px] font-medium text-ink-faint ring-1 ring-line">Ctrl K</kbd>
        </button>
      </div>

      <div className="space-y-0.5 px-2">
        {navItem('dashboard', 'Projects', <IconGrid />)}
        {navItem('activity', 'Activity', <IconGitCommit />)}
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
        <Button variant="primary" className="w-full justify-center" onClick={() => { onNewProject(); onClose() }}>
          <IconPlus /> New project
        </Button>
        <Button variant="ghost" className="w-full justify-center" onClick={onScan} disabled={scanning}>
          <IconRefresh /> {scanning ? 'Scanning…' : 'Scan for projects'}
        </Button>
      </div>
      </aside>
    </>
  )
}
