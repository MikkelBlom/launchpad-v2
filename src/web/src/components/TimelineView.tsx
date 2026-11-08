import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Timeline } from '../../../shared/types'
import { localDateKey } from '../../../shared/isoWeek'
import { filterTimelineByAuthor } from '../../../shared/timelineFilter'
import { api } from '../api'
import { Button, EmptyState, IconButton } from './ui'
import { IconCalendar, IconChevronLeft, IconChevronRight, IconRefresh } from './icons'

// Commit count → heat cell. Thresholds are deliberately coarse: the strip answers "where did
// my week go", not "exactly how many".
function heat(n: number): string {
  if (n === 0) return 'bg-surface-2 text-transparent'
  if (n === 1) return 'bg-emerald-100 text-emerald-900'
  if (n <= 3) return 'bg-emerald-200 text-emerald-900'
  if (n <= 7) return 'bg-emerald-400 text-white'
  return 'bg-emerald-600 text-white'
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export function TimelineView({ onOpenProject }: { onOpenProject: (id: number) => void }) {
  const [week, setWeek] = useState('this')
  const [mine, setMine] = useState(false)
  const [author, setAuthor] = useState('')
  const [data, setData] = useState<Timeline | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true)
      setError(null)
      try {
        setData(await api.timeline(week, { mine, refresh }))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [week, mine]
  )

  useEffect(() => {
    load()
  }, [load])

  const canGoNext = data ? !data.week.isCurrent && !data.week.isFuture : false

  // ← / → step through weeks, as long as nobody is typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey || !data) return
      if (e.key === 'ArrowLeft') setWeek(data.week.prev)
      else if (e.key === 'ArrowRight' && canGoNext) setWeek(data.week.next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [data, canGoNext])

  const view = useMemo(() => (data ? filterTimelineByAuthor(data, author) : null), [data, author])
  const today = localDateKey(new Date())
  const manyAuthors = (data?.authors.length ?? 0) > 1

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <h1 className="mb-1 flex items-center gap-2 text-xl font-semibold text-ink">
        <IconCalendar /> Timeline
      </h1>
      <p className="mb-4 text-sm text-ink-soft">What you touched this week, from the git history of every project.</p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <IconButton title="Previous week" onClick={() => data && setWeek(data.week.prev)} disabled={!data}>
          <IconChevronLeft />
        </IconButton>
        <span className="min-w-[14rem] text-center text-sm font-semibold text-ink">
          {data ? data.week.label : '…'}
        </span>
        <IconButton
          title="Next week"
          onClick={() => data && canGoNext && setWeek(data.week.next)}
          disabled={!canGoNext}
          className="disabled:opacity-40"
        >
          <IconChevronRight />
        </IconButton>
        <Button variant="ghost" onClick={() => setWeek('this')} disabled={data?.week.isCurrent}>
          This week
        </Button>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-sm text-ink-soft" title="Only commits whose author matches each repo's git user.email">
          <input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); setAuthor('') }} />
          Only mine
        </label>
        {manyAuthors && !mine && (
          <select
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            className="rounded-lg border border-line bg-surface-0 px-2 py-1 text-sm text-ink-soft"
          >
            <option value="">All authors</option>
            {data!.authors.map((a) => (
              <option key={a.email || a.name} value={a.email}>
                {a.name} ({a.count})
              </option>
            ))}
          </select>
        )}
        <IconButton title="Re-read git" onClick={() => load(true)} disabled={loading}>
          <IconRefresh className={loading ? 'animate-spin' : ''} />
        </IconButton>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : !view ? (
        <div className="p-8 text-sm text-ink-faint">Reading git history…</div>
      ) : (
        <div className={loading ? 'opacity-60 transition-opacity' : ''}>
          {view.skipped.length > 0 && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {view.skipped.length} repo{view.skipped.length === 1 ? '' : 's'} could not be read:{' '}
              {view.skipped.map((s) => `${s.projectName} (${s.reason})`).join(' · ')}
            </p>
          )}

          {view.total === 0 ? (
            <EmptyState
              title={view.week.isFuture ? 'This week has not happened yet' : 'No commits this week'}
              hint={`Looked at ${view.reposScanned} repo${view.reposScanned === 1 ? '' : 's'}${mine ? ' (only your commits)' : ''}.`}
            />
          ) : (
            <>
              <HeatStrip timeline={view} today={today} onOpenProject={onOpenProject} />
              <div className="mt-6 space-y-5">
                {view.days
                  .filter((d) => d.total > 0)
                  .map((day) => (
                    <section key={day.date}>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                        {day.label}
                        {day.date === today ? ' · today' : ''} · {day.total} commit{day.total === 1 ? '' : 's'}
                      </p>
                      <div className="space-y-2">
                        {day.projects.map((p) => (
                          <div key={p.projectId} className="rounded-xl border border-line bg-surface-0 px-3 py-2">
                            <button
                              onClick={() => onOpenProject(p.projectId)}
                              className="mb-1 text-sm font-semibold text-brand-strong hover:underline"
                            >
                              {p.projectName}
                            </button>
                            <ul className="space-y-0.5">
                              {p.commits.map((c) => (
                                <li key={c.hash} className="flex items-baseline gap-3 text-sm">
                                  <span className="w-10 shrink-0 font-mono text-xs text-ink-faint">{timeOf(c.at)}</span>
                                  <span className="min-w-0 flex-1 truncate text-ink-soft" title={c.subject}>
                                    {c.subject}
                                  </span>
                                  {manyAuthors && !author && (
                                    <span className="shrink-0 text-xs text-ink-faint">{c.author}</span>
                                  )}
                                  <span className="shrink-0 font-mono text-xs text-ink-faint">{c.hash}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function HeatStrip({
  timeline,
  today,
  onOpenProject
}: {
  timeline: Timeline
  today: string
  onOpenProject: (id: number) => void
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface-0 p-3">
      <table className="w-full border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="text-left font-medium text-ink-faint" />
            {timeline.days.map((d) => (
              <th
                key={d.date}
                className={`w-12 text-center font-medium ${d.date === today ? 'text-brand-strong' : 'text-ink-faint'}`}
              >
                {d.label.split(' ').slice(0, 2).join(' ')}
              </th>
            ))}
            <th className="w-10 text-right font-medium text-ink-faint">Σ</th>
          </tr>
        </thead>
        <tbody>
          {timeline.projects.map((p) => (
            <tr key={p.projectId}>
              <td className="max-w-[12rem] truncate pr-2">
                <button
                  onClick={() => onOpenProject(p.projectId)}
                  className="truncate text-left text-sm text-ink hover:text-brand-strong hover:underline"
                  title={`Open ${p.projectName}`}
                >
                  {p.projectName}
                </button>
              </td>
              {p.perDay.map((n, i) => (
                <td
                  key={i}
                  title={`${p.projectName} · ${timeline.days[i].label}: ${n} commit${n === 1 ? '' : 's'}`}
                  className={`h-7 rounded-md text-center font-semibold ${heat(n)}`}
                >
                  {n || '·'}
                </td>
              ))}
              <td className="text-right font-semibold text-ink-soft">{p.total}</td>
            </tr>
          ))}
          <tr>
            <td className="pr-2 pt-1 text-xs font-medium text-ink-faint">All projects</td>
            {timeline.days.map((d) => (
              <td key={d.date} className="pt-1 text-center font-semibold text-ink-soft">
                {d.total || ''}
              </td>
            ))}
            <td className="pt-1 text-right font-semibold text-ink">{timeline.total}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
