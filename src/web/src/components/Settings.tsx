import { useEffect, useRef, useState } from 'react'
import type { AppSettings, DiscoveryResult, DuplicateGroup, OnboardResult, Tag } from '../../../shared/types'
import { api, type ImportResult } from '../api'
import { Button, EmptyState, IconButton, inputCls, useToast } from './ui'
import { IconDownload, IconFolder, IconPlus, IconRefresh, IconRobot, IconTrash, IconUpload } from './icons'

interface OnboardReport {
  onboarded: OnboardResult[]
  failed: Array<{ projectId: number; name: string; error: string }>
}

export function Settings({ onChanged }: { onChanged: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [newRoot, setNewRoot] = useState('')
  const [picking, setPicking] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<DiscoveryResult | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [onboarding, setOnboarding] = useState(false)
  const [onboardReport, setOnboardReport] = useState<OnboardReport | null>(null)
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

  const addRootPath = async (value: string) => {
    if (!value) return
    if (settings.projectRoots.includes(value)) return toast('Already added', 'error')
    await patch({ projectRoots: [...settings.projectRoots, value] })
    setNewRoot('')
  }
  const addRoot = () => addRootPath(newRoot.trim())
  // Opens a real folder dialog on this machine. The request stays open until the user
  // answers it, so the button reports that it is waiting. A cancel returns null — silent.
  const browseRoot = async () => {
    setPicking(true)
    try {
      const { path } = await api.pickFolder('Choose a projects folder')
      if (path) await addRootPath(path)
    } catch (e) { toast(String(e instanceof Error ? e.message : e), 'error') } finally { setPicking(false) }
  }
  const scan = async () => {
    setScanning(true)
    try {
      const r = await api.scan()
      setScanResult(r)
      onChanged()
      toast(scanSummary(r))
    } catch (e) { toast(String(e instanceof Error ? e.message : e), 'error') } finally { setScanning(false) }
  }
  const runImport = async () => {
    setImporting(true)
    try { const r = await api.importOld(); setImportResult(r); onChanged(); const n = r.imported.length + r.relocated.length; toast(n ? `Imported ${n} project(s)` : 'Nothing new to import') }
    catch (e) { toast(String(e instanceof Error ? e.message : e), 'error') } finally { setImporting(false) }
  }
  const onboardAll = async () => {
    setOnboarding(true)
    try {
      const r = await api.onboardAll()
      setOnboardReport(r)
      onChanged()
      const done = r.onboarded.length
      if (done === 0 && r.failed.length === 0) toast('Every project is already onboarded')
      else toast(`Onboarded ${done} project(s)${r.failed.length ? `, ${r.failed.length} failed` : ''}`, r.failed.length ? 'error' : 'ok')
    } catch (e) { toast(String(e instanceof Error ? e.message : e), 'error') } finally { setOnboarding(false) }
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
            <Button variant="subtle" className="shrink-0 whitespace-nowrap" onClick={browseRoot} disabled={picking}>
              <IconFolder /> {picking ? 'Waiting for folder…' : 'Browse…'}
            </Button>
            <input className={`${inputCls} font-mono text-xs`} placeholder="…or type C:\Users\you\Projects" value={newRoot} onChange={(e) => setNewRoot(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addRoot()} />
            <Button variant="subtle" className="shrink-0" onClick={addRoot}><IconPlus /> Add</Button>
          </div>
          {picking && <p className="text-xs text-ink-faint">A folder picker is open on your desktop — choose a folder or cancel it.</p>}
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
        {scanResult && <ScanReport result={scanResult} onChanged={onChanged} />}
      </section>

      <section className={`${card} space-y-4`}>
        <h2 className="text-sm font-semibold text-ink">Vercel</h2>
        <p className="text-sm text-ink-soft">
          Optional. With a token, a project can be matched to its Vercel deployment (by git remote,
          then by name) and gets a button that opens the live site. Everything else works without it.
        </p>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-soft">Personal access token</span>
          <input
            className={inputCls}
            type="password"
            autoComplete="off"
            placeholder="vercel.com → Account Settings → Tokens"
            value={settings.vercelToken}
            onChange={(e) => setSettings({ ...settings, vercelToken: e.target.value })}
            onBlur={() => patch({ vercelToken: settings.vercelToken.trim() })}
          />
          <span className="mt-1 block text-xs text-ink-faint">
            Stored in your local Launchpad database, never sent anywhere but api.vercel.com.
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-soft">Team ID (only if your projects live in a team)</span>
          <input
            className={inputCls}
            placeholder="team_…"
            value={settings.vercelTeamId}
            onChange={(e) => setSettings({ ...settings, vercelTeamId: e.target.value })}
            onBlur={() => patch({ vercelTeamId: settings.vercelTeamId.trim() })}
          />
        </label>
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
        </div>
        {/* Two different "on startup" ideas live here, so each says which startup it means. */}
        <div className="space-y-2 border-t border-line pt-3">
          <label className="flex items-start gap-2 text-sm text-ink-soft">
            <input className="mt-0.5" type="checkbox" checked={settings.startAtLogin} onChange={(e) => patch({ startAtLogin: e.target.checked })} />
            <span>
              Start Launchpad when Windows starts
              <span className="block text-xs text-ink-faint">
                Applies to the desktop app: it starts into the tray at login and keeps the local service running.
                The desktop app picks the change up the next time its window is opened or focused.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-ink-soft">
            <input className="mt-0.5" type="checkbox" checked={settings.scanOnStartup} onChange={(e) => patch({ scanOnStartup: e.target.checked })} />
            <span>
              Rescan projects when the service starts
              <span className="block text-xs text-ink-faint">Re-reads git and the filesystem for every project as Launchpad boots.</span>
            </span>
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
        <p className="mt-0.5 text-sm text-ink-soft">
          Registrations that look like the same project — nested folders, stale paths that no
          longer exist, and near-identical names. Notes, ideas and tasks are moved to the keeper;
          nothing on disk is touched.
        </p>
        <div className="mt-3"><Button variant="subtle" onClick={findDupes}><IconRefresh /> Find duplicates</Button></div>
        {dupes && (
          dupes.length === 0 ? (
            <p className="mt-3 text-sm text-ink-faint">No duplicates found. 🎉</p>
          ) : (
            <div className="mt-3 space-y-2">
              {dupes.map((g) => (
                <div key={g.keeper.id} className="rounded-lg bg-surface-1 p-3 text-sm">
                  <p className="font-medium text-ink">Keep: {g.keeper.name}</p>
                  <p className="font-mono text-[11px] text-ink-faint">{g.keeper.path}</p>
                  <ul className="mt-1.5 space-y-0.5">
                    {g.nested.map((n) => (
                      <li key={n.id} className="text-xs text-ink-soft">
                        <span className="text-ink">{n.name}</span> — {n.reason}
                        <span className="block font-mono text-[11px] text-ink-faint">{n.path}</span>
                      </li>
                    ))}
                  </ul>
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
            <ImportLine label="Already present" items={importResult.skipped.map((x) => (x.reason ? `${x.name} — ${x.reason}` : x.name))} tone="text-ink-faint" />
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
        <h2 className="text-sm font-semibold text-ink">Onboard projects for agents</h2>
        <p className="mt-0.5 text-sm text-ink-soft">
          Onboarding writes three files into a project's <span className="font-mono text-xs">ai-instructions/</span> folder:
          <span className="font-mono text-xs"> .launchpad.json</span> (binds the folder to this project, so a bare
          <span className="font-mono text-xs"> launchpad pull</span> in it resolves correctly), a Launchpad block inside
          <span className="font-mono text-xs"> CLAUDE.md</span> (your own text around it is left alone), and
          <span className="font-mono text-xs"> LAUNCHPAD.md</span> (a read-only snapshot of this project's tasks, ideas and notes).
          Nothing is read back — the database stays the source of truth.
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          This runs it for every project that isn't onboarded yet. Individual projects have their own Onboard
          button; re-running is safe and only refreshes those files.
        </p>
        <div className="mt-3"><Button variant="subtle" onClick={onboardAll} disabled={onboarding}><IconRobot /> {onboarding ? 'Onboarding…' : 'Onboard all projects'}</Button></div>
        {onboardReport && (
          <div className="mt-3 space-y-1 rounded-lg bg-surface-1 p-3 text-sm">
            {onboardReport.onboarded.length === 0 && onboardReport.failed.length === 0 && (
              <p className="text-ink-faint">Nothing to do — every project was already onboarded.</p>
            )}
            <ImportLine label="Onboarded" items={onboardReport.onboarded.map((o) => o.name)} tone="text-brand-strong" />
            {onboardReport.failed.length > 0 && (
              <div>
                <span className="font-medium text-rose-600">Failed ({onboardReport.failed.length}):</span>
                <ul className="mt-1 space-y-0.5">
                  {onboardReport.failed.map((f) => (
                    <li key={f.projectId} className="text-xs text-ink-soft">
                      <span className="text-ink">{f.name}</span> — {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
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

// The server explains the outcome itself; fall back only if an older server (or one
// mid-deploy) returns a result without a message.
function scanSummary(result: DiscoveryResult): string {
  if (result.message) return result.message
  const added = Array.isArray(result.added) ? result.added.length : 0
  return added ? `Found ${added} new project(s)` : 'Rescanned — no new projects'
}

// "No projects found" on its own is useless — show which root produced what, and call
// out roots that aren't on disk, since that is the usual reason a scan comes back empty.
function ScanReport({ result, onChanged }: { result: DiscoveryResult; onChanged: () => void }) {
  const roots = Array.isArray(result.roots) ? result.roots : []
  const missing = roots.filter((r) => !r.exists)
  const present = roots.filter((r) => r.exists)
  const added = Array.isArray(result.added) ? result.added : []
  const skipped = Array.isArray(result.skipped) ? result.skipped : []
  const empty = skipped.filter((s) => s.kind === 'empty')
  const unrecognised = skipped.filter((s) => s.kind !== 'empty')

  return (
    <div className="mt-3 space-y-2 rounded-lg bg-surface-1 p-3 text-sm">
      <p className="text-ink-soft">{scanSummary(result)}</p>
      {missing.length > 0 && (
        <div className="space-y-0.5">
          <p className="font-medium text-rose-600">Not found on disk ({missing.length}):</p>
          {missing.map((r) => (
            <p key={r.path} className="font-mono text-xs text-rose-600">{r.path}</p>
          ))}
          <p className="text-xs text-ink-faint">Fix the path or remove the root — nothing under it can be scanned.</p>
        </div>
      )}
      {present.length > 0 && (
        <div className="space-y-0.5">
          {present.map((r) => (
            <p key={r.path} className="text-xs text-ink-faint">
              <span className="font-mono">{r.path}</span> — {r.candidates} candidate{r.candidates === 1 ? '' : 's'}, {r.added} added
            </p>
          ))}
        </div>
      )}
      <ImportLine label="Added" items={added} tone="text-brand-strong" />
      {/* An empty folder sitting in a project root is a project someone started making and
          hasn't put anything in yet. Saying "skipped" and stopping there is the wrong answer;
          the right one is to offer to fill it in. */}
      {empty.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-brand-soft bg-brand-soft/40 p-2.5">
          <p className="font-medium text-brand-strong">
            {empty.length === 1 ? 'An empty folder is' : `${empty.length} empty folders are`} waiting
            to be initialised
          </p>
          {empty.map((s) => (
            <EmptyFolderRow key={s.path} path={s.path} onInitialized={onChanged} />
          ))}
        </div>
      )}
      {/* The folder someone came here looking for is usually one of these. Naming it, with
          the reason, is the difference between "the scan is broken" and "ah, it's empty". */}
      {unrecognised.length > 0 && (
        <div className="space-y-0.5">
          <p className="font-medium text-ink-soft">
            Skipped — not a project ({unrecognised.length}):
          </p>
          {unrecognised.map((s) => (
            <p key={s.path} className="text-xs text-ink-faint">
              <span className="font-mono">{s.path.split(/[\\/]/).pop()}</span> — {s.reason}
            </p>
          ))}
          <p className="text-xs text-ink-faint">
            To track one anyway, register it directly:{' '}
            <span className="font-mono">launchpad register &quot;&lt;path&gt;&quot;</span>
          </p>
        </div>
      )}
    </div>
  )
}

// Initialising writes into a folder on disk, so it names exactly what it will put there
// rather than acting on a bare "Yes".
function EmptyFolderRow({ path, onInitialized }: { path: string; onInitialized: () => void }) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const toast = useToast()
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path
  const parentPath = path.slice(0, path.length - name.length).replace(/[\\/]+$/, '')

  const initialize = async () => {
    setBusy(true)
    try {
      const result = await api.scaffold({ name, parentPath, initGit: true })
      setDone(true)
      toast(
        result.warnings.length > 0
          ? `Initialised ${name} — ${result.warnings[0]}`
          : `Initialised ${name}`,
        result.warnings.length > 0 ? 'error' : 'ok'
      )
      onInitialized()
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <p className="text-xs text-brand-strong">
        <span className="font-mono">{name}</span> — initialised and registered.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-soft" title={path}>
        {name}
      </span>
      <span className="text-xs text-ink-faint">
        README, .gitignore, ai-instructions/, git init
      </span>
      <Button variant="subtle" disabled={busy} onClick={() => void initialize()}>
        {busy ? 'Initialising…' : 'Initialise as project'}
      </Button>
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
