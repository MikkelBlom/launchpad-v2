import { useEffect, useState } from 'react'
import type { Project } from '../../../shared/types'
import { api } from '../api'
import { Button, Field, inputCls, Modal, useToast } from './ui'
import { IconFolder } from './icons'

export function NewProjectModal({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated: (project: Project) => void
}) {
  const [name, setName] = useState('')
  const [parentPath, setParentPath] = useState('')
  const [description, setDescription] = useState('')
  const [initGit, setInitGit] = useState(true)
  const [createGithub, setCreateGithub] = useState(false)
  const [githubPrivate, setGithubPrivate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const toast = useToast()

  useEffect(() => {
    api.getSettings().then((s) => {
      if (s.projectRoots[0]) setParentPath(s.projectRoots[0])
    })
  }, [])

  // Opens a native folder dialog on this machine; the request stays open until the user
  // answers. Cancelling returns null and leaves whatever was typed alone.
  const browseParent = async () => {
    setPicking(true)
    try {
      const { path } = await api.pickFolder('Choose where the new project folder goes')
      if (path) setParentPath(path)
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    } finally {
      setPicking(false)
    }
  }

  const create = async () => {
    if (!name.trim()) return toast('Name is required', 'error')
    if (!parentPath.trim()) return toast('Parent folder is required', 'error')
    setBusy(true)
    try {
      const result = await api.scaffold({
        name: name.trim(),
        parentPath: parentPath.trim(),
        description: description.trim(),
        initGit,
        createGithub,
        githubPrivate
      })
      if (result.warnings.length) {
        toast(result.warnings[0], 'error')
      } else {
        toast('Project created')
      }
      onCreated(result.project)
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="New project" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Project name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="My New Thing" autoFocus />
        </Field>
        <Field label="Parent folder">
          <div className="flex gap-2">
            <input className={`${inputCls} font-mono text-xs`} value={parentPath} onChange={(e) => setParentPath(e.target.value)} placeholder="C:\Users\you\Projects" />
            <Button variant="subtle" className="shrink-0 whitespace-nowrap" onClick={browseParent} disabled={picking}>
              <IconFolder /> {picking ? 'Waiting…' : 'Browse…'}
            </Button>
          </div>
          {picking && <span className="mt-1 block text-xs font-normal text-ink-faint">A folder picker is open on your desktop.</span>}
        </Field>
        <Field label="Description">
          <textarea className={`${inputCls} min-h-[70px] resize-y`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this?" />
        </Field>
        <div className="space-y-2 rounded-lg bg-surface-1 p-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={initGit} onChange={(e) => setInitGit(e.target.checked)} />
            <span className="text-sm text-ink-soft">Initialize a git repository</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={createGithub} onChange={(e) => setCreateGithub(e.target.checked)} />
            <span className="text-sm text-ink-soft">Create GitHub repo (needs gh CLI)</span>
          </label>
          {createGithub && (
            <label className="ml-6 flex items-center gap-2">
              <input type="checkbox" checked={githubPrivate} onChange={(e) => setGithubPrivate(e.target.checked)} />
              <span className="text-sm text-ink-soft">Private</span>
            </label>
          )}
        </div>
        <p className="text-xs text-ink-faint">
          Creates the folder with a README, .gitignore, and an ai-instructions/ folder, then registers it.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={create} disabled={busy}>
            {busy ? 'Creating…' : 'Create project'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
