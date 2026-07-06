import { useEffect, useState } from 'react'
import type { Project } from '../../../shared/types'
import { api } from '../api'
import { Button, Field, inputCls, Modal, useToast } from './ui'

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
  const toast = useToast()

  useEffect(() => {
    api.getSettings().then((s) => {
      if (s.projectRoots[0]) setParentPath(s.projectRoots[0])
    })
  }, [])

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
          <input className={`${inputCls} font-mono text-xs`} value={parentPath} onChange={(e) => setParentPath(e.target.value)} placeholder="C:\Users\you\Projects" />
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
