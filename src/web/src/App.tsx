import { useCallback, useEffect, useState } from 'react'
import type { Project } from '../../shared/types'
import { api } from './api'
import { ToastProvider, useToast } from './components/ui'
import { Dashboard } from './components/Dashboard'
import { ProjectDetail } from './components/ProjectDetail'
import { Settings } from './components/Settings'
import { Inbox } from './components/Inbox'
import { NewProjectModal } from './components/NewProjectModal'
import { CaptureBar } from './components/CaptureBar'
import { Sidebar } from './components/Sidebar'

type View = 'dashboard' | 'inbox' | 'settings'

function Shell() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [view, setView] = useState<View>('dashboard')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [inboxCount, setInboxCount] = useState(0)
  const [scanning, setScanning] = useState(false)
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

  const openProject = (id: number) => {
    setSelectedId(id)
  }

  const runScan = async () => {
    setScanning(true)
    try {
      const result = await api.scan()
      await refreshProjects()
      toast(
        result.added.length
          ? `Found ${result.added.length} new project${result.added.length === 1 ? '' : 's'}`
          : 'Rescanned — no new projects'
      )
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    } finally {
      setScanning(false)
    }
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
        onNav={(v) => {
          setView(v)
          setSelectedId(null)
        }}
        onOpenProject={openProject}
        onNewProject={() => setShowNew(true)}
        onScan={runScan}
      />

      <main className="flex min-w-0 flex-1 flex-col">
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
            <ProjectDetail
              project={selected}
              onBack={() => setSelectedId(null)}
              onChanged={refreshProjects}
            />
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
            <Inbox
              projects={projects ?? []}
              onChanged={() => {
                refreshInbox()
                refreshProjects()
              }}
            />
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
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  )
}
