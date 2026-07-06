import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../shared/types'
import { api } from '../api'
import { Button, EmptyState, IconButton, inputCls, useToast } from './ui'
import { IconPlus, IconRefresh, IconTrash } from './icons'

export function Settings({ onChanged }: { onChanged: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [newRoot, setNewRoot] = useState('')
  const [scanning, setScanning] = useState(false)
  const toast = useToast()

  useEffect(() => {
    api.getSettings().then(setSettings)
  }, [])

  if (!settings) return <div className="p-8 text-sm text-ink-faint">Loading…</div>

  const patch = async (p: Partial<AppSettings>) => {
    const next = await api.updateSettings(p)
    setSettings(next)
  }

  const addRoot = async () => {
    const value = newRoot.trim()
    if (!value) return
    if (settings.projectRoots.includes(value)) {
      toast('That root is already added', 'error')
      return
    }
    await patch({ projectRoots: [...settings.projectRoots, value] })
    setNewRoot('')
  }

  const removeRoot = async (root: string) => {
    await patch({ projectRoots: settings.projectRoots.filter((r) => r !== root) })
  }

  const scan = async () => {
    setScanning(true)
    try {
      const result = await api.scan()
      onChanged()
      toast(result.added.length ? `Found ${result.added.length} new project(s)` : 'Rescanned — no new projects')
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-6">
      <h1 className="text-xl font-semibold text-ink">Settings</h1>

      <section className="rounded-xl border border-line bg-surface-0 p-5">
        <h2 className="text-sm font-semibold text-ink">Project roots</h2>
        <p className="mt-0.5 text-sm text-ink-soft">
          Folders Launchpad scans (2 levels deep) to discover your projects.
        </p>
        <div className="mt-3 space-y-2">
          {settings.projectRoots.length === 0 ? (
            <EmptyState title="No roots yet" hint="Add the folder where your projects live." />
          ) : (
            settings.projectRoots.map((root) => (
              <div key={root} className="flex items-center gap-2 rounded-lg bg-surface-1 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-soft">{root}</span>
                <IconButton title="Remove" onClick={() => removeRoot(root)}>
                  <IconTrash width={14} height={14} />
                </IconButton>
              </div>
            ))
          )}
          <div className="flex gap-2">
            <input
              className={`${inputCls} font-mono text-xs`}
              placeholder="C:\Users\you\Projects"
              value={newRoot}
              onChange={(e) => setNewRoot(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addRoot()}
            />
            <Button variant="subtle" onClick={addRoot}>
              <IconPlus /> Add
            </Button>
          </div>
        </div>
        <div className="mt-3">
          <Button variant="primary" onClick={scan} disabled={scanning}>
            <IconRefresh /> {scanning ? 'Scanning…' : 'Scan now'}
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-surface-0 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-ink">Preferences</h2>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-soft">Editor command</span>
          <input
            className={inputCls}
            value={settings.defaultEditor}
            onChange={(e) => setSettings({ ...settings, defaultEditor: e.target.value })}
            onBlur={() => patch({ defaultEditor: settings.defaultEditor })}
          />
          <span className="mt-1 block text-xs text-ink-faint">Used by "Open in editor". Default: code (VS Code).</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-soft">GitHub username</span>
          <input
            className={inputCls}
            value={settings.githubUser}
            onChange={(e) => setSettings({ ...settings, githubUser: e.target.value })}
            onBlur={() => patch({ githubUser: settings.githubUser })}
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.scanOnStartup}
            onChange={(e) => patch({ scanOnStartup: e.target.checked })}
          />
          <span className="text-sm text-ink-soft">Rescan projects on startup</span>
        </label>
      </section>

      <section className="rounded-xl border border-line bg-surface-0 p-5">
        <h2 className="text-sm font-semibold text-ink">Agent CLI</h2>
        <p className="mt-0.5 text-sm text-ink-soft">
          Install the <span className="font-mono">launchpad</span> command once so AI agents can pull
          project data from any folder:
        </p>
        <code className="mt-2 block rounded-lg bg-surface-1 px-3 py-2 font-mono text-xs text-ink ring-1 ring-line">
          cd launchpad-v2 &amp;&amp; npm link
        </code>
        <p className="mt-2 text-xs text-ink-faint">
          Then from any registered project: <span className="font-mono">launchpad pull</span>
        </p>
      </section>
    </div>
  )
}
