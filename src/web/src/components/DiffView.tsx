import { useCallback, useEffect, useMemo, useState, type SVGProps } from 'react'
import type { DiffFile, ProjectDiff } from '../../../shared/types'
import { api } from '../api'
import { Badge, Button, EmptyState, IconButton, useToast } from './ui'
import { IconRefresh } from './icons'

// Local icon — icons.tsx is shared across views and a disclosure chevron is only needed here.
const IconChevronRight = (p: SVGProps<SVGSVGElement>) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

const STATUS_CLS: Record<DiffFile['status'], string> = {
  modified: 'bg-amber-50 text-amber-800',
  added: 'bg-emerald-50 text-emerald-800',
  deleted: 'bg-rose-50 text-rose-800',
  renamed: 'bg-sky-50 text-sky-800',
  untracked: 'bg-surface-2 text-ink-soft'
}

// Expanding everything is only readable for a handful of files; past that the list itself is
// the useful view and the patches open on demand.
const AUTO_EXPAND_LIMIT = 2

export function DiffView({ projectId }: { projectId: number }) {
  const [staged, setStaged] = useState(false)
  const [diff, setDiff] = useState<ProjectDiff | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const toast = useToast()

  const load = useCallback(() => {
    let cancelled = false
    setLoading(true)
    // Drop the previous result rather than leaving it under the other toggle's label — a
    // stale patch shown as if it were the staged one is worse than a moment of "Loading…".
    setDiff(null)
    api
      .diff(projectId, staged)
      .then((result) => {
        if (cancelled) return
        setDiff(result)
        setExpanded(
          new Set(result.files.length <= AUTO_EXPAND_LIMIT ? result.files.map((f) => f.path) : [])
        )
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setDiff(null)
        toast(err instanceof Error ? err.message : 'Could not load the diff', 'error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, staged, toast])

  useEffect(() => load(), [load])

  const toggleFile = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const files = diff?.files ?? []
  const allOpen = files.length > 0 && files.every((f) => expanded.has(f.path))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg bg-surface-2 p-0.5">
          {([false, true] as const).map((mode) => (
            <button
              key={String(mode)}
              aria-pressed={staged === mode}
              onClick={() => setStaged(mode)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                staged === mode ? 'bg-surface-0 text-ink shadow-sm' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {mode ? 'Staged' : 'Working tree'}
            </button>
          ))}
        </div>

        {files.length > 0 && (
          <Button
            variant="ghost"
            onClick={() => setExpanded(allOpen ? new Set() : new Set(files.map((f) => f.path)))}
          >
            {allOpen ? 'Collapse all' : 'Expand all'}
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {diff && files.length > 0 && (
            <p className="text-xs text-ink-soft">
              {files.length} {files.length === 1 ? 'file' : 'files'} changed,{' '}
              <span className="font-medium text-emerald-700">+{diff.totalAdditions}</span>{' '}
              <span className="font-medium text-rose-700">−{diff.totalDeletions}</span>
            </p>
          )}
          <IconButton title="Refresh diff" onClick={() => load()}>
            <IconRefresh />
          </IconButton>
        </div>
      </div>

      {diff?.truncated && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          This diff is too large to show in full — the patches marked truncated below are
          shortened, or left out entirely.
        </p>
      )}

      {loading && !diff && <div className="text-sm text-ink-faint">Loading…</div>}

      {diff && files.length === 0 && (
        <EmptyState
          title={staged ? 'Nothing staged' : 'No uncommitted changes'}
          hint={
            staged
              ? 'Nothing has been added to the index yet.'
              : 'The working tree matches the last commit.'
          }
        />
      )}

      {files.length > 0 && (
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-0">
          {files.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              open={expanded.has(file.path)}
              onToggle={() => toggleFile(file.path)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FileRow({
  file,
  open,
  onToggle
}: {
  file: DiffFile
  open: boolean
  onToggle: () => void
}) {
  const slash = file.path.lastIndexOf('/')
  const dir = slash >= 0 ? file.path.slice(0, slash + 1) : ''
  const name = slash >= 0 ? file.path.slice(slash + 1) : file.path

  return (
    <div>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-1"
      >
        <IconChevronRight
          width={14}
          height={14}
          className={`shrink-0 text-ink-faint transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {dir && <span className="text-ink-faint">{dir}</span>}
          <span className="text-ink">{name}</span>
        </span>
        <Badge className={STATUS_CLS[file.status]}>{file.status}</Badge>
        {file.truncated && <span className="shrink-0 text-xs text-ink-faint">truncated</span>}
        {file.binary ? (
          <span className="shrink-0 text-xs text-ink-faint">binary</span>
        ) : (
          <span className="shrink-0 font-mono text-xs">
            <span className="text-emerald-700">+{file.additions}</span>{' '}
            <span className="text-rose-700">−{file.deletions}</span>
          </span>
        )}
      </button>
      {open && <Patch file={file} />}
    </div>
  )
}

function Patch({ file }: { file: DiffFile }) {
  const lines = useMemo(() => (file.patch ? file.patch.split('\n') : []), [file.patch])

  // How many changed lines the server left out, counted against the numstat totals it sent.
  const hidden = useMemo(() => {
    const shown = lines.filter((l) => l.startsWith('+') || l.startsWith('-')).length
    return Math.max(0, file.additions + file.deletions - shown)
  }, [lines, file.additions, file.deletions])

  if (file.binary) {
    return <Note text="Binary file — contents not shown." />
  }
  if (lines.length === 0) {
    if (!file.truncated) return <Note text="No content changes." />
    const changed = file.additions + file.deletions
    return (
      <Note
        text={
          changed > 0
            ? `Too large to display — ${changed} changed lines.`
            : 'Too large to display.'
        }
      />
    )
  }

  return (
    <div className="border-t border-line bg-surface-1">
      <div className="overflow-x-auto">
        <div className="min-w-max font-mono text-xs leading-5">
          {lines.map((line, i) => (
            <div key={i} className={`whitespace-pre px-3 ${lineCls(line)}`}>
              {line === '' ? ' ' : line}
            </div>
          ))}
        </div>
      </div>
      {file.truncated && (
        <Note
          text={
            hidden > 0
              ? `Diff truncated — ${hidden} more changed ${hidden === 1 ? 'line' : 'lines'} not shown.`
              : 'Diff truncated — the rest of this patch was not sent.'
          }
        />
      )}
    </div>
  )
}

function Note({ text }: { text: string }) {
  return <p className="border-t border-line bg-surface-1 px-3 py-2 text-xs text-ink-faint">{text}</p>
}

function lineCls(line: string): string {
  if (line.startsWith('@@')) return 'bg-surface-2 text-ink-faint'
  if (line.startsWith('+')) return 'bg-emerald-50 text-emerald-900'
  if (line.startsWith('-')) return 'bg-rose-50 text-rose-900'
  // "\ No newline at end of file" is git's own annotation, not file content.
  if (line.startsWith('\\')) return 'text-ink-faint'
  return 'text-ink-soft'
}
