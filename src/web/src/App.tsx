import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from '../../shared/types'
import { api } from './api'
import { ToastProvider, useToast } from './components/ui'
import { Dashboard } from './components/Dashboard'
import { ProjectDetail } from './components/ProjectDetail'
import { Settings } from './components/Settings'
import { Inbox } from './components/Inbox'
import { ActivityView } from './components/ActivityView'
import { TimelineView } from './components/TimelineView'
import { PortsView } from './components/PortsView'
import { NewProjectModal } from './components/NewProjectModal'
import { CaptureBar } from './components/CaptureBar'
import { Sidebar } from './components/Sidebar'
import { CommandPalette, type PaletteAction } from './components/CommandPalette'
import { ErrorBoundary, REQUIRES_API, StaleService } from './components/Fallbacks'

type View = 'dashboard' | 'inbox' | 'activity' | 'timeline' | 'ports' | 'settings'

function Shell() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [view, setView] = useState<View>('dashboard')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [inboxCount, setInboxCount] = useState(0)
  const [scanning, setScanning] = useState(false)
  const gotoPending = useRef(false)
  const toast = useToast()

  const refreshProjects = useCallback(async () => {
    setProjects(await api.listProjects())
  }, [])
  const refreshInbox = useCallback(async () => {
    setInboxCount((await api.listCaptures()).length)
  }, [])

  useEffect(() => {
    refreshProjects()
    refreshInbox()
  }, [refreshProjects, refreshInbox])

  // Re-read project state when the window regains focus (git status may have changed).
  useEffect(() => {
    const onFocus = () => refreshProjects()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshProjects])

  const openProject = (id: number) => setSelectedId(id)
  const goTo = (v: View) => {
    setView(v)
    setSelectedId(null)
  }

  const runScan = useCallback(async () => {
    setScanning(true)
    try {
      const result = await api.scan()
      await refreshProjects()
      toast(result.added.length ? `Found ${result.added.length} new project(s)` : 'Rescanned — no new projects')
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    } finally {
      setScanning(false)
    }
  }, [refreshProjects, toast])

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
        return
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return
      if (gotoPending.current) {
        gotoPending.current = false
        if (e.key === 'd') goTo('dashboard')
        else if (e.key === 'i') goTo('inbox')
        else if (e.key === 'a') goTo('activity')
        else if (e.key === 't') goTo('timeline')
        else if (e.key === 's') goTo('settings')
        return
      }
      if (e.key === 'g') {
        gotoPending.current = true
        setTimeout(() => (gotoPending.current = false), 1200)
      } else if (e.key === 'n') {
        setShowNew(true)
      } else if (e.key === '/') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('lp:focus-search'))
      } else if (e.key === 'Escape') {
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onPaletteAction = (action: PaletteAction) => {
    if (action === 'new') setShowNew(true)
    else if (action === 'scan') runScan()
    else if (action === 'dashboard') goTo('dashboard')
    else if (action === 'inbox') goTo('inbox')
    else if (action === 'activity') goTo('activity')
    else if (action === 'timeline') goTo('timeline')
    else if (action === 'settings') goTo('settings')
  }

  const selected = selectedId !== null ? projects?.find((p) => p.id === selectedId) ?? null : null

  return (
    <div className="flex h-full">
      <Sidebar
        projects={projects ?? []}
        view={view}
        selectedId={selectedId}
        inboxCount={inboxCount}
        scanning={scanning}
        onNav={goTo}
        onOpenProject={openProject}
        onNewProject={() => setShowNew(true)}
        onScan={runScan}
        onOpenPalette={() => setPaletteOpen(true)}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line bg-surface-0 px-3 py-2 sm:hidden">
          <button onClick={() => setNavOpen(true)} className="rounded-lg p-1.5 text-ink-soft hover:bg-surface-2" aria-label="Menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <span className="text-sm font-semibold text-ink">Launchpad</span>
        </div>
        <CaptureBar
          projects={projects ?? []}
          defaultProjectId={selectedId}
          onCaptured={() => {
            refreshInbox()
            if (selectedId) refreshProjects()
          }}
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {selected ? (
            <ProjectDetail project={selected} onBack={() => setSelectedId(null)} onChanged={refreshProjects} />
          ) : view === 'dashboard' ? (
            <Dashboard
              projects={projects}
              onOpenProject={openProject}
              onChanged={refreshProjects}
              onNewProject={() => setShowNew(true)}
              onScan={runScan}
              scanning={scanning}
            />
          ) : view === 'inbox' ? (
            <Inbox projects={projects ?? []} onChanged={() => { refreshInbox(); refreshProjects() }} />
          ) : view === 'activity' ? (
            <ActivityView onOpenProject={openProject} />
          ) : view === 'timeline' ? (
            <TimelineView onOpenProject={openProject} />
          ) : view === 'ports' ? (
            <PortsView onOpenProject={openProject} />
          ) : (
            <Settings onChanged={refreshProjects} />
          )}
        </div>
      </main>

      {showNew && (
        <NewProjectModal
          onClose={() => setShowNew(false)}
          onCreated={(project) => {
            setShowNew(false)
            refreshProjects().then(() => setSelectedId(project.id))
          }}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          projects={projects ?? []}
          onClose={() => setPaletteOpen(false)}
          onOpenProject={(id) => {
            setPaletteOpen(false)
            openProject(id)
          }}
          onAction={onPaletteAction}
        />
      )}
    </div>
  )
}

// Nothing renders until the service has been asked what it is. One request against
// localhost, and it buys the difference between an explanation and a blank window: assets
// newer than the service read fields the service does not send, and the first `.map` over
// one of them takes the whole tree down.
function Boot() {
  const [apiVersion, setApiVersion] = useState<number | null>(null)

  useEffect(() => {
    api
      .health()
      .then((h) => setApiVersion(Number(h?.apiVersion) || 0))
      // Unreachable is not stale — the existing views already handle a service that is down,
      // so let them, rather than blaming a version for it.
      .catch(() => setApiVersion(REQUIRES_API))
  }, [])

  if (apiVersion === null) return null
  if (apiVersion < REQUIRES_API) return <StaleService apiVersion={apiVersion} />
  return <Shell />
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <Boot />
      </ToastProvider>
    </ErrorBoundary>
  )
}
