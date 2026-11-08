import { useCallback, useEffect, useRef, useState, type SVGProps } from 'react'
import type { HygieneFinding, HygieneKind, HygieneOverview, ProjectHygiene } from '../../../shared/types'
import { api } from '../api'
import { relativeTime } from '../format'
import { Badge, Button, EmptyState, IconButton, useToast } from './ui'
import { IconRefresh } from './icons'

// Hygiene is read-only by design: every row shows a suggested command and a copy button,
// and nothing on this page can run one. Deleting a node_modules or a worktree is Mikkel's
// call, made in his own terminal.

export const IconBroom = (p: SVGProps<SVGSVGElement>) => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M19.4 3.6 13 10" />
    <path d="M9.5 9.5 14.5 14.5" />
    <path d="M9.5 9.5c-2 .5-4 2-5.5 4.5L3 21l7-1c2.5-1.5 4-3.5 4.5-5.5" />
    <path d="M7 17l-1.5 1.5" />
  </svg>
)

const IconCopy = (p: SVGProps<SVGSVGElement>) => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

export function formatBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

const KIND_META: Record<HygieneKind, { label: string; cls: string }> = {
  uncommitted: { label: 'Uncommitted', cls: 'bg-amber-100 text-amber-700' },
  unpushed: { label: 'Unpushed', cls: 'bg-sky-100 text-sky-700' },
  'no-remote': { label: 'No remote', cls: 'bg-rose-100 text-rose-700' },
  worktree: { label: 'Worktree', cls: 'bg-violet-100 text-violet-700' },
  'merged-branches': { label: 'Branches', cls: 'bg-stone-100 text-stone-600' },
  regenerable: { label: 'Regenerable', cls: 'bg-emerald-100 text-emerald-700' }
}

function useCopy() {
  const toast = useToast()
  return useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        toast('Copied — run it yourself from the project folder')
      } catch {
        toast('Could not copy to the clipboard', 'error')
      }
    },
    [toast]
  )
}

function FindingRow({ finding }: { finding: HygieneFinding }) {
  const copy = useCopy()
  const meta = KIND_META[finding.kind]
  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={meta.cls}>{meta.label}</Badge>
        <span className="min-w-0 flex-1 text-sm text-ink">{finding.title}</span>
        {finding.bytes !== null && (
          <span className="text-sm font-semibold tabular-nums text-ink">
            {finding.bytesExact ? '' : '≥ '}
            {formatBytes(finding.bytes)}
          </span>
        )}
      </div>
      {finding.detail && <p className="mt-1 text-xs text-ink-faint">{finding.detail}</p>}
      {finding.items.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-ink-soft">
          {finding.items.slice(0, 5).map((item) => (
            <li key={item} className="truncate font-mono">· {item}</li>
          ))}
          {finding.items.length > 5 && <li className="text-ink-faint">…and {finding.items.length - 5} more</li>}
        </ul>
      )}
      {finding.command && (
        <div className="mt-2 flex items-center gap-1 rounded-lg bg-surface-2 py-0.5 pl-2.5 pr-0.5">
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink-soft" title={finding.command}>
            {finding.command}
          </code>
          <IconButton title="Copy command" className="h-7 w-7" onClick={() => void copy(finding.command as string)}>
            <IconCopy />
          </IconButton>
        </div>
      )}
    </li>
  )
}

export function HygieneFindings({ hygiene }: { hygiene: ProjectHygiene }) {
  if (hygiene.error && hygiene.findings.length === 0) return <EmptyState title={hygiene.error} />
  if (hygiene.findings.length === 0) return <EmptyState title="Nothing to clean up" hint="No uncommitted work, unpushed commits, stale worktrees, merged branches or big regenerable folders." />
  return (
    <>
      {hygiene.error && <p className="mb-2 text-xs text-rose-600">{hygiene.error}</p>}
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface-0">
        {hygiene.findings.map((f, i) => (
          <FindingRow key={`${f.kind}-${f.path ?? ''}-${i}`} finding={f} />
        ))}
      </ul>
    </>
  )
}

function Reclaimable({ hygiene }: { hygiene: ProjectHygiene }) {
  if (!hygiene.reclaimableBytes) return null
  return (
    <span className="text-sm font-semibold tabular-nums text-ink">
      {hygiene.reclaimableIsLowerBound ? '≥ ' : ''}
      {formatBytes(hygiene.reclaimableBytes)}
      <span className="font-normal text-ink-faint"> reclaimable</span>
    </span>
  )
}

// The per-project tab. Scans on open (the server caches for a few minutes); Rescan forces it.
export function HygieneTab({ projectId }: { projectId: number }) {
  const [hygiene, setHygiene] = useState<ProjectHygiene | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (refresh: boolean) => {
      setBusy(true)
      setError(null)
      try {
        setHygiene(await api.projectHygiene(projectId, refresh))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Scan failed')
      } finally {
        setBusy(false)
      }
    },
    [projectId]
  )

  useEffect(() => {
    setHygiene(null)
    void load(false)
  }, [load])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-xs text-ink-faint">
          Read-only. Each finding suggests a command to copy — Launchpad never runs it.
          {hygiene && ` Scanned ${relativeTime(hygiene.scannedAt)} in ${(hygiene.durationMs / 1000).toFixed(1)} s.`}
        </p>
        {hygiene && <Reclaimable hygiene={hygiene} />}
        <Button variant="ghost" onClick={() => void load(true)} disabled={busy}>
          <IconRefresh /> {busy ? 'Scanning…' : 'Rescan'}
        </Button>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {hygiene ? <HygieneFindings hygiene={hygiene} /> : !error && <div className="text-sm text-ink-faint">Scanning git and folder sizes…</div>}
    </div>
  )
}

// The cross-project view. The overview answers from cache at once and refreshes in the
// background; this polls while the service says it is still scanning.
export function HygieneView({ onOpenProject }: { onOpenProject: (id: number) => void }) {
  const [overview, setOverview] = useState<HygieneOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const poll = useCallback(async (refresh: boolean) => {
    if (timer.current) clearTimeout(timer.current)
    try {
      const next = await api.hygiene(refresh)
      setOverview(next)
      setError(null)
      if (next.scanning) timer.current = setTimeout(() => void poll(false), 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read hygiene')
    }
  }, [])

  useEffect(() => {
    void poll(false)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [poll])

  const toggle = (id: number) =>
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const withFindings = overview?.projects.filter((p) => p.findings.length > 0 || p.error) ?? []
  const total = overview?.projects.reduce((n, p) => n + p.reclaimableBytes, 0) ?? 0
  const lowerBound = overview?.projects.some((p) => p.reclaimableIsLowerBound) ?? false

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-ink">Hygiene</h1>
          <p className="mt-0.5 text-sm text-ink-soft">
            What is lying around: uncommitted work, unpushed commits, stale worktrees, merged branches and big
            folders a tool can rebuild. Read-only — commands are suggestions to copy.
          </p>
        </div>
        <Button variant="ghost" onClick={() => void poll(true)} disabled={overview?.scanning}>
          <IconRefresh /> {overview?.scanning ? 'Scanning…' : 'Rescan all'}
        </Button>
      </div>

      {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}

      {overview && (
        <p className="mt-4 text-sm text-ink-soft">
          <span className="font-semibold text-ink">{withFindings.length}</span> of {overview.projects.length} scanned
          project(s) have something to clean
          {total > 0 && (
            <>
              {' '}· <span className="font-semibold text-ink">{lowerBound ? '≥ ' : ''}{formatBytes(total)}</span> reclaimable
            </>
          )}
          {overview.scanning && <span className="text-ink-faint"> · scanning, {overview.pending} still to go…</span>}
          {!overview.scanning && overview.lastFullScanAt && (
            <span className="text-ink-faint"> · last full scan {relativeTime(overview.lastFullScanAt)}</span>
          )}
        </p>
      )}

      <div className="mt-4 space-y-2">
        {overview === null && !error && <div className="text-sm text-ink-faint">Loading…</div>}
        {overview && withFindings.length === 0 && !overview.scanning && (
          <EmptyState title="Nothing to clean up" hint="Every scanned project is tidy." />
        )}
        {withFindings.map((p) => {
          const open = expanded.has(p.projectId)
          return (
            <section key={p.projectId} className="rounded-xl border border-line bg-surface-0">
              <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <button onClick={() => toggle(p.projectId)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
                  <span className="text-sm font-semibold text-ink">{open ? '▾' : '▸'} {p.name}</span>
                  <span className="ml-2 text-xs text-ink-faint">
                    {p.findings.length} finding{p.findings.length === 1 ? '' : 's'}
                    {summarizeKinds(p)}
                  </span>
                </button>
                <Reclaimable hygiene={p} />
                <Button variant="ghost" onClick={() => onOpenProject(p.projectId)}>Open</Button>
              </div>
              {open && (
                <div className="border-t border-line p-2">
                  <HygieneFindings hygiene={p} />
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function summarizeKinds(p: ProjectHygiene): string {
  const counts = new Map<HygieneKind, number>()
  for (const f of p.findings) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1)
  const parts = [...counts].map(([k, n]) => `${n > 1 ? `${n} ` : ''}${KIND_META[k].label.toLowerCase()}`)
  return parts.length ? ` · ${parts.join(', ')}` : ''
}
