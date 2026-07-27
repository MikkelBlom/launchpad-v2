import { useEffect, useState } from 'react'
import type { ActivityItem } from '../../../shared/types'
import { api } from '../api'
import { relativeTime } from '../format'
import { EmptyState } from './ui'
import { IconGitCommit } from './icons'

const KIND_META: Record<ActivityItem['kind'], { emoji: string; label: string }> = {
  commit: { emoji: '⎇', label: 'commit' },
  task: { emoji: '✓', label: 'task' },
  idea: { emoji: '💡', label: 'idea' },
  note: { emoji: '📝', label: 'note' }
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const that = new Date(d)
  that.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - that.getTime()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return `${diff} days ago`
  return d.toLocaleDateString()
}

export function ActivityView({ onOpenProject }: { onOpenProject: (id: number) => void }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null)

  useEffect(() => {
    api.activity(80).then(setItems)
  }, [])

  if (items === null) return <div className="p-8 text-sm text-ink-faint">Loading…</div>

  const groups: Array<{ day: string; items: ActivityItem[] }> = []
  for (const item of items) {
    const day = dayLabel(item.at)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.items.push(item)
    else groups.push({ day, items: [item] })
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <h1 className="mb-1 flex items-center gap-2 text-xl font-semibold text-ink">
        <IconGitCommit /> Activity
      </h1>
      <p className="mb-4 text-sm text-ink-soft">What you've touched recently, across every project.</p>
      {items.length === 0 ? (
        <EmptyState title="Nothing yet" hint="Commits and edits will show up here." />
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.day}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                {group.day}
              </p>
              <div className="space-y-1">
                {group.items.map((item, i) => (
                  <button
                    key={`${item.kind}-${item.projectId}-${i}`}
                    onClick={() => onOpenProject(item.projectId)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-surface-1"
                  >
                    <span className="w-4 shrink-0 text-center text-sm">{KIND_META[item.kind].emoji}</span>
                    <span className="shrink-0 text-xs font-medium text-brand-strong">{item.projectName}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">{item.text}</span>
                    <span className="shrink-0 text-xs text-ink-faint">{relativeTime(item.at)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
