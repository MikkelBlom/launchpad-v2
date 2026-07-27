import { useCallback, useEffect, useState, type SVGProps } from 'react'
import type { PortCheck, PortOverview } from '../../../shared/types'
import { api } from '../api'
import { Badge, Button, EmptyState, IconButton, inputCls, useToast } from './ui'
import { IconGlobe, IconPlay, IconRefresh, IconSearch } from './icons'

// icons.tsx has no clipboard glyph and is shared with everything else, so this one lives here.
const IconCopy = (p: SVGProps<SVGSVGElement>) => (
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
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

function Section({
  title,
  hint,
  children
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {hint && <p className="mb-2 mt-0.5 text-xs text-ink-faint">{hint}</p>}
      <div className={hint ? '' : 'mt-2'}>{children}</div>
    </section>
  )
}

export function PortsView({ onOpenProject }: { onOpenProject: (id: number) => void }) {
  const [overview, setOverview] = useState<PortOverview | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [probe, setProbe] = useState('')
  const [probeResult, setProbeResult] = useState<PortCheck | null>(null)
  const toast = useToast()

  const load = useCallback(async () => {
    try {
      setOverview(await api.ports())
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not read ports', 'error')
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast(`Copied ${text}`)
    } catch {
      toast('Could not copy to the clipboard', 'error')
    }
  }

  const openDev = async (id: number) => {
    try {
      await api.openDev(id)
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not open it', 'error')
    }
  }

  const detect = async (id: number, name: string) => {
    setBusyId(id)
    try {
      const result = await api.detectPort(id)
      toast(
        result.port === null
          ? `Nothing in ${name}'s config declares a port`
          : `${name} → port ${result.port} (from ${result.source})`,
        result.port === null ? 'error' : 'ok'
      )
      await load()
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Detection failed', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const checkProbe = async () => {
    const port = Number(probe)
    if (!Number.isInteger(port)) {
      toast('Enter a port number', 'error')
      return
    }
    try {
      setProbeResult(await api.checkPort(port))
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not check that port', 'error')
    }
  }

  if (overview === null) return <div className="p-8 text-sm text-ink-faint">Loading…</div>

  const claimed = overview.projects.filter((p) => p.devPort !== null)
  const unclaimed = overview.projects.filter((p) => p.devPort === null)
  const claimedPorts = new Set(claimed.map((p) => p.devPort))
  // Windows hands out 49152+ to outbound sockets and RPC — noise, not servers worth listing.
  const unclaimedListening = overview.listening.filter((port) => !claimedPorts.has(port))
  const foreign = unclaimedListening.filter((port) => port < 49152)
  const dynamic = unclaimedListening.length - foreign.length
  const conflicts = claimed.filter((p) => p.conflictsWith.length > 0).length

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
            <IconGlobe /> Ports
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            Which localhost each project runs on, and what is actually live right now.
          </p>
        </div>
        <IconButton title="Refresh" onClick={() => void load()}>
          <IconRefresh />
        </IconButton>
      </div>

      {conflicts > 0 && (
        <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {conflicts} project{conflicts === 1 ? '' : 's'} share a port with another project. Two dev
          servers cannot both hold the same localhost — move one of them.
        </p>
      )}

      <Section title="Claimed ports">
        {claimed.length === 0 ? (
          <EmptyState
            title="No project claims a port yet"
            hint="Use Detect below, or run `launchpad set port <number>` in a project folder."
          />
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-0">
            {claimed.map((row) => (
              <div
                key={row.projectId}
                className={`flex items-center gap-3 px-4 py-2.5 ${
                  row.conflictsWith.length > 0 ? 'bg-rose-50' : ''
                }`}
              >
                <span
                  title={row.listening ? 'Something is listening' : 'Nothing is listening'}
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    row.listening ? 'bg-emerald-500' : 'bg-line'
                  }`}
                />
                <button
                  onClick={() => onOpenProject(row.projectId)}
                  className="min-w-0 shrink truncate text-left text-sm font-medium text-ink hover:text-brand"
                >
                  {row.name}
                </button>
                {row.conflictsWith.length > 0 && (
                  <Badge className="bg-rose-100 text-rose-700">
                    also {row.conflictsWith.join(', ')}
                  </Badge>
                )}
                <span className="flex-1" />
                {row.devPortSource && (
                  <span className="hidden shrink-0 truncate text-xs text-ink-faint sm:block sm:max-w-[11rem]">
                    {row.devPortSource}
                  </span>
                )}
                <code className="shrink-0 rounded bg-surface-2 px-2 py-0.5 font-mono text-xs text-ink-soft">
                  {row.url}
                </code>
                <IconButton title="Copy URL" onClick={() => void copy(row.url ?? '')}>
                  <IconCopy />
                </IconButton>
                <Button variant="subtle" onClick={() => void openDev(row.projectId)}>
                  <IconPlay /> Open
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Free to claim"
        hint="Suggested from the 74xx band — nothing is listening on these and no project claims them."
      >
        <div className="flex flex-wrap items-center gap-2">
          {overview.suggested.length === 0 ? (
            <span className="text-sm text-ink-faint">No free ports found in the suggestion range.</span>
          ) : (
            overview.suggested.map((port) => (
              <button
                key={port}
                onClick={() => void copy(String(port))}
                title={`Copy ${port}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-soft px-2.5 py-1 font-mono text-xs text-brand hover:bg-brand hover:text-white"
              >
                {port} <IconCopy width={12} height={12} />
              </button>
            ))
          )}
        </div>
      </Section>

      <Section title="Check a port" hint="Is it free, and who claims it?">
        <div className="flex items-center gap-2">
          <input
            value={probe}
            onChange={(e) => setProbe(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void checkProbe()}
            placeholder="4200"
            inputMode="numeric"
            className={`${inputCls} max-w-[8rem] font-mono`}
          />
          <Button variant="subtle" onClick={() => void checkProbe()}>
            <IconSearch /> Check
          </Button>
          {probeResult && (
            <span
              className={`text-sm ${probeResult.available ? 'text-brand-strong' : 'text-ink-soft'}`}
            >
              {probeResult.reason}
            </span>
          )}
        </div>
      </Section>

      {unclaimed.length > 0 && (
        <Section
          title={`No port claimed (${unclaimed.length})`}
          hint="Detect reads the project's own config: .claude/launch.json, vite.config, package.json scripts, .env, docker-compose, launchSettings.json."
        >
          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-0">
            {unclaimed.map((row) => (
              <div key={row.projectId} className="flex items-center gap-3 px-4 py-2">
                <button
                  onClick={() => onOpenProject(row.projectId)}
                  className="min-w-0 flex-1 truncate text-left text-sm text-ink-soft hover:text-brand"
                >
                  {row.name}
                </button>
                <Button
                  variant="ghost"
                  disabled={busyId === row.projectId}
                  onClick={() => void detect(row.projectId, row.name)}
                >
                  {busyId === row.projectId ? 'Detecting…' : 'Detect'}
                </Button>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section
        title={`In use, claimed by no project (${foreign.length})`}
        hint="Everything else listening on this machine — the answer to “what the hell is on 4200?”"
      >
        {foreign.length === 0 ? (
          <p className="text-sm text-ink-faint">Nothing else is listening.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {foreign.map((port) => (
              <button
                key={port}
                onClick={() => {
                  setProbe(String(port))
                  void api.checkPort(port).then(setProbeResult)
                }}
                title={`Check ${port}`}
                className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-xs text-ink-soft hover:bg-line hover:text-ink"
              >
                {port}
              </button>
            ))}
            {dynamic > 0 && (
              <span className="text-xs text-ink-faint">
                +{dynamic} in the dynamic range above 49152 — not dev servers
              </span>
            )}
          </div>
        )}
      </Section>
    </div>
  )
}
