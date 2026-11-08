import '../test/tempDataDir.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getDb } from '../db/database.ts'
import { createProject } from '../repo/projects.ts'
import { archiveTask, createTask, updateTask } from '../repo/tasks.ts'
import { createIdea, updateIdea } from '../repo/ideas.ts'
import { archiveNote, createNote } from '../repo/notes.ts'
import { setItemTags } from '../repo/itemTags.ts'
import { listNeedsMikkel, NEEDS_MIKKEL_TAG, needsMikkelCount } from './needsMikkel.ts'

function stamp(table: 'tasks' | 'ideas' | 'notes', id: number, at: string): void {
  getDb().prepare(`UPDATE ${table} SET updated_at = ?, created_at = ? WHERE id = ?`).run(at, at, id)
}

test('lists open tagged items across projects, grouped and newest first', () => {
  const alpha = createProject({ name: 'Alpha', path: 'C:/tmp/nm-alpha' })
  const beta = createProject({ name: 'Beta', path: 'C:/tmp/nm-beta' })

  assert.equal(needsMikkelCount(), 0)
  assert.deepEqual(listNeedsMikkel().groups, [])

  // Alpha: an open tagged task (old), a tagged note (newest in Alpha), an untagged task,
  // a done tagged task, an archived tagged task.
  const aTask = createTask(alpha.id, { title: 'Pick a licence', body: 'MIT or\n\nApache?', priority: 'high' })
  setItemTags('task', aTask.id, [NEEDS_MIKKEL_TAG, 'legal'])
  stamp('tasks', aTask.id, '2026-01-01T00:00:00.000Z')

  const aNote = createNote(alpha.id, 'Review copy', 'x'.repeat(500))
  setItemTags('note', aNote.id, ['Needs-Mikkel']) // case-insensitive, like every tag
  stamp('notes', aNote.id, '2026-03-01T00:00:00.000Z')

  createTask(alpha.id, { title: 'Untagged' })

  const done = createTask(alpha.id, { title: 'Done already' })
  setItemTags('task', done.id, [NEEDS_MIKKEL_TAG])
  updateTask(done.id, { status: 'done' })

  const archived = createTask(alpha.id, { title: 'Archived' })
  setItemTags('task', archived.id, [NEEDS_MIKKEL_TAG])
  archiveTask(archived.id, true)

  const archivedNote = createNote(alpha.id, 'Old note', '')
  setItemTags('note', archivedNote.id, [NEEDS_MIKKEL_TAG])
  archiveNote(archivedNote.id, true)

  // Beta: an open tagged idea (newest overall), an archived and a promoted tagged idea.
  const bIdea = createIdea(beta.id, 'Rename the app?', '', 'low')
  setItemTags('idea', bIdea.id, [NEEDS_MIKKEL_TAG])
  stamp('ideas', bIdea.id, '2026-05-01T00:00:00.000Z')

  for (const status of ['archived', 'promoted'] as const) {
    const idea = createIdea(beta.id, `Idea ${status}`, '', 'low')
    setItemTags('idea', idea.id, [NEEDS_MIKKEL_TAG])
    updateIdea(idea.id, { status })
  }

  const inbox = listNeedsMikkel()
  assert.equal(inbox.tag, NEEDS_MIKKEL_TAG)
  assert.equal(inbox.total, 3)
  assert.equal(needsMikkelCount(), 3)

  assert.deepEqual(
    inbox.groups.map((g) => [g.projectName, g.items.map((i) => `${i.kind}:${i.id}`)]),
    [
      ['Beta', [`idea:${bIdea.id}`]],
      ['Alpha', [`note:${aNote.id}`, `task:${aTask.id}`]]
    ]
  )
  assert.equal(inbox.groups[0].latestAt, '2026-05-01T00:00:00.000Z')

  const task = inbox.groups[1].items[1]
  assert.equal(task.status, 'todo')
  assert.equal(task.priority, 'high')
  assert.equal(task.excerpt, 'MIT or Apache?')
  assert.deepEqual(task.tags.map((t) => t.name), ['legal', NEEDS_MIKKEL_TAG])
  assert.equal(task.source, 'ui')

  const note = inbox.groups[1].items[0]
  assert.equal(note.status, null)
  assert.equal(note.priority, null)
  assert.equal(note.excerpt.length, 200)

  // Acting on an item takes it out of the inbox.
  updateTask(aTask.id, { status: 'done' })
  archiveNote(aNote.id, true)
  assert.equal(needsMikkelCount(), 1)
  assert.deepEqual(listNeedsMikkel().groups.map((g) => g.projectName), ['Beta'])
})
