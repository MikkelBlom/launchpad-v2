import { useEffect, useRef, useState } from 'react'
import type { AppSettings, DuplicateGroup, Tag } from '../../../shared/types'
import { api, type ImportResult } from '../api'
import { Button, EmptyState, IconButton, inputCls, useToast } from './ui'
import { IconDownload, IconFolder, IconPlus, IconRefresh, IconTrash, IconUpload } from './icons'

export function Settings({ onChanged }: { onChanged: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [newRoot, setNewRoot] = useState('')
  const [scanning, setScanning] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [newTag, setNewTag] = useState('')
  const [dupes, setDupes] = useState<DuplicateGroup[] | null>(null)
  const [dataDir, setDataDir] = useState('')
  const restoreRef = useRef<HTMLInputElement>(null)
  const toast = useToast()

  useEffect(() => {
    api.getSettings().then(setSettings)
    api.listTags().then(setTags)
    api.dataDir().then((d) => setDataDir(d.dataDir))
  }, [])

  if (!settings) return <div className="p-8 text-sm text-ink-faint">Loading…</div>

  const patch = async (p: Partial<AppSettings>) => setSettings(await api.updateSettings(p))

  const addRoot = async () => {
    const value = newRoot.trim()
    if (!value) return
    if (settings.projectRoots.includes(value)) return toast('Already added', 'error')
    await patch({ projectRoots: [...settings.projectRoots, value] })
    setNewRoot('')
  }
  const scan = async () => {
    setScanning(true)
    try {
      const r = await api.scan()
      onChanged()
      toast(r.added.length ? `Found ${r.added.length} new project(s)` : 'Rescanned — no new projects')
    } catch (e) { toast(String(e instanceof Error ? e.message : e), 'error') } finally { setScanning(false) }
  }
  const runImport = async () => {
    setImporting(true)
    try { const r = await api.importOld(); setImportResult(r); onChanged(); const n = r.imported.length + r.relocated.length; toast(n ? `Imported ${n} project(s)` : 'Nothing new to import') }
    catch (e) { toast(String(e instanceof Error ? e.message : e), 'error') } finally { setImporting(false) }
  }
  const addTag = async () => {
    if (!newTag.trim()) return
    await api.createTag(newTag.trim())
    setNewTag(''); setTags(await api.listTags())
  }
  const findDupes = async () => setDupes(await api.duplicates())
  const merge = async (g: DuplicateGroup) => {
    await api.merge(g.keeper.id, g.nested.map((n) => n.id))
    onChanged(); setDupes(await api.duplicates()); toast('Merged')
  }
  const backup = async () => {
    const data = await api.backup()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `launchpad-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click()
    URL.revokeObjectURL(url)
  }
  const restore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const data = JSON.parse(await file.text())
      const res = await api.restore(data)
      onChanged(); api.listTags().then(setTags)
      toast(`Restored ${Object.values(res.restored).reduce((a, b) => a + b, 0)} rows`)
    } catch (err) { toast(String(err instanceof Error ? err.message : err), 'error') }
    if (restoreRef.current) restoreRef.current.value = ''
  }

  const card = 'rounded-xl border border-line bg-surface-0 p-5'

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6">
      <h1 className="text-xl font-semibold text-ink">Settings</h1>

      <section className={card}>
        <h2 className="text-sm font-semibold text-ink">Project roots</h2>
        <p className="mt-0.5 text-sm text-ink-soft">Folders Launchpad scans to discover your projects.</p>
        <div className="mt-3 space-y-2">
          {settings.projectRoots.length === 0 ? (
            <EmptyState title="No roots yet" hint="Add the folder where your projects live." />
          ) : (
            settings.projectRoots.map((root) => (
              <div key={root} className="flex items-center gap-2 rounded-lg bg-surface-1 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-soft">{root}</span>
                <IconButton title="Remove" onClick={() => patch({ projectRoots: settings.projectRoots.filter((r) => r !== root) })}><IconTrash width={14} height={14} /></IconButton>
              </div>
            ))
          )}
          <div className="flex gap-2">
            <input className={`${inputCls} font-mono text-xs`} placeholder="C:\Users\you\Projects" value={newRoot} onChange={(e) => setNewRoot(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addRoot()} />
            <Button variant="subtle" onClick={addRoot}><IconPlus /> Add</Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-ink-soft">Scan depth</span>
            <input type="number" min={1} max={5} className="w-20 rounded-lg border border-line px-2 py-1.5 text-sm outline-none" value={settings.scanDepth} onChange={(e) => setSettings({ ...settings, scanDepth: Number(e.target.value) })} onBlur={() => patch({ scanDepth: settings.scanDepth })} />
          </label>
          <label className="flex-1 text-sm">
            <span className="mb-1 block font-medium text-ink-soft">Exclude folders (comma-separated)</span>
            <input className={inputCls} placeholder="archive, old, tmp" value={settings.excludeDirs.join(', ')} onChange={(e) => setSettings({ ...settings, excludeDirs: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} onBlur={() => patch({ excludeDirs: settings.excludeDirs })} />
          </label>
          <Button variant="primary" onClick={scan} disabled={scanning}><IconRefresh /> {scanning ? 'Scanning…' : 'Scan now'}</Button>
        </div>
      </section>

      <section className={`${card} space-y-4`}>
        <h2 className="text-sm font-semibold text-ink">Preferences</h2>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-soft">Editor command</span>
          <input className={inputCls} value={settings.defaultEditor} onChange={(e) => setSettings({ ...settings, defaultEditor: e.target.value })} onBlur={() => patch({ defaultEditor: settings.defaultEditor })} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-soft">GitHub username</span>
          <input className={inputCls} value={settings.githubUser} onChange={(e) => setSettings({ ...settings, githubUser: e.target.value })} onBlur={() => patch({ githubUser: settings.githubUser })} />
        </label>
        <div className="flex flex-wrap gap-4">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-ink-soft">Default sort</span>
            <select className="rounded-lg border border-line bg-surface-0 px-2 py-1.5 text-sm outline-none" value={settings.defaultSort} onChange={(e) => patch({ defaultSort: e.target.value })}>
              <option value="activity">Recent activity</option><option value="name">Name</option><option value="created">Newest</option><option value="commit">Last commit</option><option value="tasks">Open tasks</option>
            </select>
          </label>
          <label className="flex items-center gap-2 pt-6 text-sm text-ink-soft">
            <input type="checkbox" checked={settings.groupByStatus} onChange={(e) => patch({ groupByStatus: e.target.checked })} /> Group by status
          </label>
          <label className="flex items-center gap-2 pt-6 text-sm text-ink-soft">
            <input type="checkbox" checked={settings.scanOnStartup} onChange={(e) => patch({ scanOnStartup: e.target.checked })} /> Rescan on startup
          </label>
        </div>
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-ink">Tags</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {tags.map((t) => (
            <span key={t.id} className="group inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium" style={{ backgroundColor: `${t.color}22`, color: t.color }}>
              <input type="color" value={t.color} onChange={async (e) => { await api.updateTag(t.id, { color: e.target.value }); setTags(await api.listTags()); onChanged() }} className="h-3 w-3 cursor-pointer rounded-full border-0 bg-transparent p-0" title="Change color" />
              #{t.name}
              <button onClick={async () => { await api.deleteTag(t.id); setTags(await api.listTags()); onChanged() }} className="opacity-50 hover:opacity-100">×</button>
            </span>
          ))}
          <div className="inline-flex items-center gap-1">
            <input className="w-28 rounded-full border border-dashed border-line px-2.5 py-1 text-xs outline-none focus:border-brand" placeholder="new tag" value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTag()} />
            <Button variant="ghost" onClick={addTag}>Add</Button>
          </div>
        </div>
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-ink">Clean up duplicates</h2>
        <p className="mt-0.5 text-sm text-ink-soft">Projects registered inside another project's folder (scan/import overlap).</p>
        <div className="mt-3"><Button variant="subtle" onClick={findDupes}><IconRefresh /> Find duplicates</Button></div>
        {dupes && (
          dupes.length === 0 ? (
            <p className="mt-3 text-sm text-ink-faint">No nested duplicates found. 🎉</p>
          ) : (
            <div className="mt-3 space-y-2">
              {dupes.map((g) => (
                <div key={g.keeper.id} className="rounded-lg bg-surface-1 p-3 text-sm">
                  <p className="font-medium text-ink">Keep: {g.keeper.name}</p>
                  <p className="text-xs text-ink-faint">Merge in: {g.nested.map((n) => n.name).join(', ')}</p>
                  <div className="mt-2"><Button variant="subtle" onClick={() => merge(g)}>Merge {g.nested.length} into “{g.keeper.name}”</Button></div>
                </div>
              ))}
            </div>
          )
        )}
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-ink">Import from old Launchpad</h2>
        <p className="mt-0.5 text-sm text-ink-soft">Pull in projects from the original app. Missing/OneDrive paths are re-found by name.</p>
        <div className="mt-3"><Button variant="subtle" onClick={runImport} disabled={importing}><IconRefresh /> {importing ? 'Importing…' : 'Import old projects'}</Button></div>
        {importResult && (
          <div className="mt-3 space-y-1 rounded-lg bg-surface-1 p-3 text-sm">
            <ImportLine label="Imported" items={importResult.imported.map((x) => x.name)} tone="text-brand-strong" />
            <ImportLine label="Relocated" items={importResult.relocated.map((x) => `${x.name} → ${x.to}`)} tone="text-sky-700" />
            <ImportLine label="Already present" items={importResult.skipped.map((x) => x.name)} tone="text-ink-faint" />
            <ImportLine label="Not found" items={importResult.notFound.map((x) => `${x.name} (${x.path})`)} tone="text-rose-600" />
          </div>
        )}
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-ink">Backup & data</h2>
        <p className="mt-0.5 text-sm text-ink-soft">Your database: <span className="font-mono text-xs">{dataDir}</span></p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="subtle" onClick={backup}><IconDownload /> Download backup</Button>
          <Button variant="subtle" onClick={() => restoreRef.current?.click()}><IconUpload /> Restore from file</Button>
          <input ref={restoreRef} type="file" accept="application/json" className="hidden" onChange={restore} />
          <Button variant="ghost" onClick={() => api.openDataFolder()}><IconFolder /> Open data folder</Button>
        </div>
        <p className="mt-2 text-xs text-ink-faint">Restore replaces the entire database with the backup file's contents.</p>
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-ink">Agent CLI</h2>
        <p className="mt-0.5 text-sm text-ink-soft">Install once so agents can pull project data from any folder:</p>
        <code className="mt-2 block rounded-lg bg-surface-1 px-3 py-2 font-mono text-xs text-ink ring-1 ring-line">cd launchpad-v2 &amp;&amp; npm link</code>
        <p className="mt-2 text-xs text-ink-faint">Then from any project: <span className="font-mono">launchpad pull</span></p>
      </section>
    </div>
  )
}

function ImportLine({ label, items, tone }: { label: string; items: string[]; tone: string }) {
  if (items.length === 0) return null
  return (
    <div>
      <span className={`font-medium ${tone}`}>{label} ({items.length}):</span>{' '}
      <span className="text-ink-soft">{items.join(', ')}</span>
    </div>
  )
}
