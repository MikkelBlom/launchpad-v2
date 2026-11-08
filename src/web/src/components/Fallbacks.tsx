import { Component, type ErrorInfo, type ReactNode } from 'react'

// Two ways the app can fail before it can say anything useful, and both used to end as a
// blank window: a render that throws (React unmounts the whole tree) and a service running
// an older build than these assets (every component reads fields that aren't in the
// response). A white screen is the least debuggable outcome there is — especially here,
// where the fix is one menu click away and nothing on screen says so.

const panel =
  'mx-auto mt-24 max-w-xl rounded-2xl border border-line bg-surface-0 px-6 py-5 text-sm text-ink-soft'

// The API version these assets were built against. Bump in step with `apiVersion` in
// routes/system.ts whenever the UI starts depending on a new server shape.
export const REQUIRES_API = 6

export function StaleService({ apiVersion }: { apiVersion: number }) {
  return (
    <div className={panel}>
      <h1 className="text-base font-semibold text-ink">Launchpad needs restarting</h1>
      <p className="mt-2">
        This window was built against API v{REQUIRES_API}, but the service answering on
        localhost is v{apiVersion || '?'} — an older build that is still running.
      </p>
      <p className="mt-3">
        Right-click the Launchpad tray icon and choose <strong>Restart server</strong>. If you
        just rebuilt, that step is what loads it: the running process keeps its old bundle in
        memory until it is replaced.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="mt-4 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong"
      >
        Reload
      </button>
    </div>
  )
}

interface BoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The window has no devtools in the packaged app, so the console is the only trail.
    console.error('Launchpad UI crashed:', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className={panel}>
        <h1 className="text-base font-semibold text-ink">Something in the UI crashed</h1>
        <p className="mt-2">
          This is a bug worth reporting — but first try <strong>Restart server</strong> in the
          tray menu: a service older than this window is the usual cause, and it looks exactly
          like this.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs text-ink-soft">
          {error.message}
        </pre>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong"
        >
          Reload
        </button>
      </div>
    )
  }
}
