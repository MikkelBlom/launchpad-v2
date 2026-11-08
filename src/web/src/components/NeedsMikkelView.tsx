import { useCallback, useEffect, useState } from 'react'
import type { ItemType, NeedsMikkelInbox, NeedsMikkelItem } from '../../../shared/types'
import { api } from '../api'
import { PRIORITY_CLS, relativeTime } from '../format'
import { Badge, Button, EmptyState, useToast } from './ui'
import { IconArchive, IconCheck } from './icons'

const KIND_LABEL: Record<ItemType, string> = { task: 'Task', idea: 'Idea', note: 'Note' }

// Tasks have a done state; ideas and notes don't, so "Done" archives them — the item has
// been dealt with either way, and archiving is reversible from the project view.
async function markDone(item: NeedsMikkelItem): Promise<void> {
  if (item.kind === 'task') await api.updateTask(item.id, { status: 'done' })
  else await api.archiveItem(item.kind, item.id, true)
}

export function NeedsMikkelView({
  onOpenProject,
  onChanged
}: {
  onOpenProject: (id: number) => void
  onChanged: () => void
}) {
  const [inbox, setInbox] = useState<NeedsMikkelInbox | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useToast()

  const load = useCallback(async () => {
    try {
      setInbox(await api.needsMikkel())
      setError(null)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    }
  }, [])

  useEffect(() => {
    load()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  const act = async (item: NeedsMikkelItem, action: 'done' | 'archive') => {
    const key = `${item.kind}:${item.id}`
    setBusy(key)
    try {
      if (action === 'done') await markDone(item)
      else await api.archiveItem(item.kind, item.id, true)
      toast(
        action === 'done' && item.kind === 'task'
          ? `Task #${item.id} done`
          : `${KIND_LABEL[item.kind]} #${item.id} archived`
      )
      await load()
      onChanged()
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    } finally {
      setBusy(null)
    }
  }

  if (error && !inbox) return <div className="p-8 text-sm text-rose-600">Could not load: {error}</div>
  if (inbox === null) return <div className="p-8 text-sm text-ink-faint">Loading…</div>

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="mb-1 text-xl font-semibold text-ink">Needs Mikkel</h1>
      <p className="mb-4 text-sm text-ink-soft">
        Open tasks, ideas and notes in any project tagged{' '}
        <code className="rounded bg-surface-2 px-1 text-xs">{inbox.tag}</code> — things an agent or you
        parked for a decision.
      </p>

      {inbox.total === 0 ? (
        <EmptyState
          title="Nothing is waiting on you"
          hint={`Tag an item "${inbox.tag}" (or have an agent do it) and it shows up here.`}
        />
      ) : (
        <div className="space-y-5">
          {inbox.groups.map((group) => (
            <section key={group.projectId}>
              <div className="mb-2 flex items-baseline gap-2">
                <button
                  onClick={() => onOpenProject(group.projectId)}
                  className="text-sm font-semibold text-ink hover:text-brand-strong hover:underline"
                  title={group.projectPath}
                >
                  {group.projectName}
                </button>
                <span className="text-xs text-ink-faint">
                  {group.items.length} item{group.items.length === 1 ? '' : 's'} · {relativeTime(group.latestAt)}
                </span>
              </div>
              <div className="space-y-2">
                {group.items.map((item) => (
                  <NeedsRow
                    key={`${item.kind}:${item.id}`}
                    item={item}
                    tag={inbox.tag}
                    busy={busy === `${item.kind}:${item.id}`}
                    onAct={act}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function NeedsRow({
  item,
  tag,
  busy,
  onAct
}: {
  item: NeedsMikkelItem
  tag: string
  busy: boolean
  onAct: (item: NeedsMikkelItem, action: 'done' | 'archive') => void
}) {
  const title = item.title || item.excerpt || '(untitled)'
  const showExcerpt = Boolean(item.title && item.excerpt)
  const otherTags = item.tags.filter((t) => t.name.toLowerCase() !== tag.toLowerCase())
  const by = item.updatedBy ? `${item.source} · ${item.updatedBy}` : item.source

  return (
    <div className="rounded-xl border border-line bg-surface-0 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-faint">
              {KIND_LABEL[item.kind]} #{item.id}
            </span>
            {item.priority && <Badge className={PRIORITY_CLS[item.priority]}>{item.priority}</Badge>}
            {item.kind === 'task' && item.status === 'doing' && (
              <Badge className="bg-sky-100 text-sky-700">doing</Badge>
            )}
            {otherTags.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-medium"
                style={{ backgroundColor: `${t.color}22`, color: t.color }}
              >
                {t.name}
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-sm font-medium text-ink">{title}</p>
          {showExcerpt && <p className="mt-0.5 line-clamp-2 text-xs text-ink-soft">{item.excerpt}</p>}
          <p className="mt-1.5 text-[11px] text-ink-faint">
            {by} · updated {relativeTime(item.updatedAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="subtle"
            disabled={busy}
            onClick={() => onAct(item, 'done')}
            title={item.kind === 'task' ? 'Mark the task done' : `${KIND_LABEL[item.kind]}s have no done state — this archives it`}
          >
            <IconCheck width={14} height={14} /> Done
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => onAct(item, 'archive')} title="Archive (reversible)">
            <IconArchive width={14} height={14} /> Archive
          </Button>
        </div>
      </div>
    </div>
  )
}
