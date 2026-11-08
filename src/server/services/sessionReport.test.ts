import '../test/tempDataDir.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createProject } from '../repo/projects.ts'
import { listNotes } from '../repo/notes.ts'
import { archiveTask, listTasks, updateTask } from '../repo/tasks.ts'
import { setItemTags } from '../repo/itemTags.ts'
import {
  applyReport,
  buildReportPlan,
  renderReportNote,
  ReportError,
  reportNoteTitle,
  validateReport
} from './sessionReport.ts'

const AGENT = { source: 'cli' as const, actor: 'test-agent' }
const tagNames = (item: { tags: { name: string }[] }) => item.tags.map((t) => t.name).sort()

// ---- pure: report → plan ----

test('validateReport requires a summary and normalizes items', () => {
  assert.throws(() => validateReport({}), ReportError)
  assert.throws(() => validateReport({ summary: '   ' }), ReportError)
  assert.throws(() => validateReport({ summary: 'x', decisions: 'nope' }), ReportError)
  assert.throws(() => validateReport({ summary: 'x', decisions: [42] }), ReportError)
  assert.throws(() => validateReport({ summary: 'x', next: [1] }), ReportError)
  const r = validateReport({
    summary: '  Did things  ',
    decisions: [' Pick A or B ', { title: 'Rename?', body: ' details ' }],
    next: ['', 'Ship it']
  })
  assert.equal(r.summary, 'Did things')
  assert.deepEqual(r.decisions, [{ title: 'Pick A or B' }, { title: 'Rename?', body: 'details' }])
  assert.deepEqual(r.deferred, [])
  assert.deepEqual(r.next, ['Ship it'])
})

test('note title uses the title, else the first line of the summary', () => {
  assert.equal(reportNoteTitle({ title: 'Ports', summary: 's' }, '2026-11-08'), 'Session report — 2026-11-08 — Ports')
  assert.equal(
    reportNoteTitle({ summary: 'First line\nsecond' }, '2026-11-08'),
    'Session report — 2026-11-08 — First line'
  )
  const long = reportNoteTitle({ summary: 'x'.repeat(200) }, '2026-11-08')
  assert.ok(long.length < 100 && long.endsWith('…'))
})

test('buildReportPlan tags new tasks and leaves existing ones untagged', () => {
  const report = validateReport({
    title: 'T',
    summary: 'S',
    decisions: ['Decide A', 'decide   a'],
    deferred: [{ title: 'Later B', body: 'why' }],
    next: ['N']
  })
  const { plan, warnings, noteTitle } = buildReportPlan(report, {
    date: '2026-11-08',
    existingTaskKeys: new Set(['later b'])
  })
  assert.equal(noteTitle, 'Session report — 2026-11-08 — T')
  assert.deepEqual(plan.tasks, [
    { title: 'Decide A', tags: ['needs-mikkel', 'decision'] },
    { title: 'Later B', body: 'why' }
  ])
  assert.equal(warnings.length, 1)
  assert.equal(plan.notes?.length, 1)
  assert.deepEqual(plan.notes?.[0].tags, ['session-report'])
  assert.equal(plan.project, undefined)
})

test('renderReportNote writes readable markdown sections', () => {
  const md = renderReportNote(
    validateReport({ summary: 'S', decisions: [{ title: 'D', body: 'b1\nb2' }], deferred: ['X'], next: ['N'] })
  )
  assert.match(md, /## Summary\n\nS/)
  assert.match(md, /## Decisions for Mikkel\n\n- \*\*D\*\*\n {2}b1\n {2}b2/)
  assert.match(md, /## Deferred \/ not done\n\n- X/)
  assert.match(md, /## Suggested next steps\n\n- N/)
  assert.doesNotMatch(renderReportNote(validateReport({ summary: 'S' })), /Decisions|needs-mikkel/)
})

// ---- integration against the temp database ----

test('applyReport: dry-run writes nothing, apply is idempotent, source is agent', () => {
  const project = createProject({ name: 'Report test', path: join(tmpdir(), 'report-test-project') })
  const report = {
    title: 'Ports',
    summary: 'Ports view shows conflicts.',
    decisions: ['Refuse 3000 outright?'],
    deferred: [{ title: 'Tray icon', body: 'Needs a design' }],
    next: ['Wire the tray menu']
  }
  const date = '2026-11-08'

  const preview = applyReport(project.id, report, AGENT, { dryRun: true, date })
  assert.equal(preview.dryRun, true)
  assert.equal(preview.created, 3)
  assert.equal(preview.backupPath, null)
  assert.equal(listTasks(project.id).length, 0)
  assert.equal(listNotes(project.id).length, 0)

  const first = applyReport(project.id, report, AGENT, { date })
  assert.equal(first.created, 3)
  assert.equal(first.noteTitle, 'Session report — 2026-11-08 — Ports')

  const tasks = listTasks(project.id)
  const decision = tasks.find((t) => t.title === 'Refuse 3000 outright?')!
  const deferred = tasks.find((t) => t.title === 'Tray icon')!
  assert.deepEqual(tagNames(decision), ['decision', 'needs-mikkel'])
  assert.deepEqual(tagNames(deferred), ['deferred', 'needs-mikkel'])
  assert.equal(deferred.body, 'Needs a design')
  assert.equal(decision.source, 'agent', 'a TTY run (source cli) is still recorded as agent')
  assert.equal(decision.updatedBy, 'test-agent')

  const notes = listNotes(project.id)
  assert.equal(notes.length, 1)
  assert.equal(notes[0].source, 'agent')
  assert.deepEqual(tagNames(notes[0]), ['session-report'])
  assert.match(notes[0].body, /Wire the tray menu/)

  // Mikkel edits a task's tags; re-running the identical report must not undo that.
  setItemTags('task', decision.id, ['needs-mikkel', 'decision', 'urgent'])
  const again = applyReport(project.id, report, AGENT, { date })
  assert.equal(again.created, 0)
  assert.equal(again.updated, 0)
  assert.equal(again.unchanged, 3)
  assert.equal(listTasks(project.id).length, 2)
  assert.equal(listNotes(project.id).length, 1)
  assert.deepEqual(tagNames(listTasks(project.id).find((t) => t.id === decision.id)!), [
    'decision',
    'needs-mikkel',
    'urgent'
  ])

  // A changed body updates in place; an archived match is not recreated.
  updateTask(deferred.id, { status: 'done' })
  archiveTask(decision.id, true)
  const third = applyReport(
    project.id,
    { ...report, deferred: [{ title: 'Tray icon', body: 'Needs a design, then icons' }] },
    AGENT,
    { date }
  )
  assert.equal(third.created, 0)
  assert.ok(third.warnings.some((w) => w.includes('archived')))
  assert.equal(listTasks(project.id, { includeArchived: true }).length, 2)
  const updatedDeferred = listTasks(project.id).find((t) => t.id === deferred.id)!
  assert.equal(updatedDeferred.body, 'Needs a design, then icons')
  assert.equal(updatedDeferred.status, 'done', 'status Mikkel set is left alone')
  assert.equal(listNotes(project.id).length, 1, 'same title → note updated, not duplicated')
})

test('applyReport rejects an invalid report before touching the database', () => {
  const project = createProject({ name: 'Report test 2', path: join(tmpdir(), 'report-test-project-2') })
  assert.throws(() => applyReport(project.id, { decisions: ['x'] }, AGENT), ReportError)
  assert.equal(listTasks(project.id).length, 0)
})
