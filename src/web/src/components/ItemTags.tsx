import { useState } from 'react'
import type { ItemType, Tag } from '../../../shared/types'
import { api } from '../api'
import { useToast } from './ui'

// Tag chips + an inline "+" adder, shared by tasks, ideas and notes. Agents set these in
// bulk via `launchpad push`; this is the manual equivalent.
export function ItemTags({
  type,
  id,
  tags,
  onChanged
}: {
  type: ItemType
  id: number
  tags: Tag[]
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const toast = useToast()

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      onChanged()
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'error')
    }
  }

  const add = async () => {
    const name = draft.trim().replace(/^#/, '')
    setDraft('')
    setAdding(false)
    if (name) await run(() => api.addItemTag(type, id, name))
  }

  if (tags.length === 0 && !adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="text-xs text-ink-faint opacity-0 transition-opacity hover:text-ink-soft group-hover:opacity-100"
        title="Add a tag"
      >
        + tag
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <span
          key={t.id}
          className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium"
          style={{ backgroundColor: `${t.color}22`, color: t.color }}
        >
          {t.name}
          <button
            onClick={() => run(() => api.removeItemTag(type, id, t.id))}
            className="opacity-50 hover:opacity-100"
            title="Remove tag"
          >
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          className="w-20 rounded-full border border-dashed border-line px-1.5 py-0.5 text-[11px] outline-none focus:border-brand"
          placeholder="tag"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
            if (e.key === 'Escape') {
              setDraft('')
              setAdding(false)
            }
          }}
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-[11px] text-ink-faint opacity-0 transition-opacity hover:text-ink-soft group-hover:opacity-100"
          title="Add a tag"
        >
          +
        </button>
      )}
    </div>
  )
}
