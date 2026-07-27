import type { Project } from '../../../shared/types'
import { api } from '../api'
import { ACTIVITY_META, relativeTime, STACK_EMOJI, STATUS_META } from '../format'
import { Badge, IconButton, useToast } from './ui'
import { IconCode, IconFolder, IconGithub, IconStar, IconTerminal } from './icons'

export function ProjectCard({
  project,
  onOpen,
  onChanged,
  selectable = false,
  selected = false,
  onToggleSelect
}: {
  project: Project
  onOpen: () => void
  onChanged: () => void
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: () => void
}) {
  const toast = useToast()
  const activity = ACTIVITY_META[project.activity]
  const status = STATUS_META[project.status]

  const guard = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast(ok)
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    }
  }

  const toggleFav = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await api.updateProject(project.id, { isFavorite: !project.isFavorite })
    onChanged()
  }

  const stop = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div
      onClick={onOpen}
      className={`group flex cursor-pointer flex-col rounded-xl border bg-surface-0 p-4 transition-shadow hover:shadow-md ${
        selected ? 'border-brand ring-2 ring-brand/30' : 'border-line'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {selectable && (
            <input
              type="checkbox"
              checked={selected}
              onClick={stop}
              onChange={() => onToggleSelect?.()}
              className="shrink-0"
            />
          )}
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${activity.dot}`} title={activity.label} />
          <h3 className="truncate text-[15px] font-semibold text-ink">{project.name}</h3>
        </div>
        <button onClick={toggleFav} title="Toggle star" className="shrink-0">
          <IconStar width={16} height={16} className={project.isFavorite ? 'fill-amber-400 text-amber-400' : 'text-ink-faint hover:text-amber-400'} />
        </button>
      </div>

      <p className="mt-1.5 line-clamp-2 min-h-[2.5rem] text-sm text-ink-soft">
        {project.description || <span className="text-ink-faint">No description</span>}
      </p>

      {project.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {project.tags.map((t) => (
            <span key={t.id} className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: `${t.color}22`, color: t.color }}>
              #{t.name}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge className={status.cls}>{status.label}</Badge>
        {project.git.hasGit ? (
          <Badge className="bg-surface-2 text-ink-soft">{project.git.branch ?? 'git'} · {relativeTime(project.git.lastCommitAt)}</Badge>
        ) : (
          <Badge className="bg-surface-2 text-ink-faint">no git</Badge>
        )}
        {project.git.dirty && <Badge className="bg-amber-100 text-amber-700">uncommitted</Badge>}
        {project.stack.map((s) => (
          <span key={s} title={s} className="text-sm">{STACK_EMOJI[s] ?? '📦'}</span>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
        <div className="flex gap-3 text-xs text-ink-faint">
          <span>{project.counts.openTasks} tasks</span>
          <span>{project.counts.ideas} ideas</span>
          <span>{project.counts.notes} notes</span>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100" onClick={stop}>
          <IconButton title="Open in editor" onClick={() => guard(() => api.openInEditor(project.id), 'Opening editor…')}><IconCode /></IconButton>
          <IconButton title="Open terminal" onClick={() => guard(() => api.openTerminal(project.id), 'Opening terminal…')}><IconTerminal /></IconButton>
          <IconButton title="Open folder" onClick={() => guard(() => api.openFolder(project.id), 'Opening folder…')}><IconFolder /></IconButton>
          {project.git.remoteUrl && (
            <IconButton title="Open on GitHub" onClick={() => guard(() => api.openGithub(project.id), 'Opening GitHub…')}><IconGithub /></IconButton>
          )}
        </div>
      </div>
    </div>
  )
}
