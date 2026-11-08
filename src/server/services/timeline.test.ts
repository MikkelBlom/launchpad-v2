import { TEST_DATA_DIR } from '../test/tempDataDir.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { weekRange } from '../../shared/isoWeek.ts'
import { filterTimelineByAuthor } from '../../shared/timelineFilter.ts'
import { createProject } from '../repo/projects.ts'
import { clearTimelineCache, collectTimeline, getTimeline, parseLogOutput } from './timeline.ts'

process.env.TZ = 'Europe/Copenhagen'

// Sunday 8 Nov 2026, evening — week 45 (Mon 2 – Sun 8 Nov) is "this week".
const NOW = new Date('2026-11-08T20:00:00+01:00')
const ME = { name: 'Mikkel', email: 'mikkel@example.com' }
const OTHER = { name: 'Bot', email: 'bot@example.com' }

function git(cwd: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', ...env },
    encoding: 'utf8'
  })
}

function commit(cwd: string, subject: string, authored: string, opts: { who?: typeof ME; committed?: string } = {}): void {
  const who = opts.who ?? ME
  git(cwd, ['-c', `user.name=${who.name}`, '-c', `user.email=${who.email}`, 'commit', '-q', '--allow-empty', '-m', subject], {
    GIT_AUTHOR_DATE: authored,
    GIT_COMMITTER_DATE: opts.committed ?? authored
  })
}

function makeRepo(name: string): string {
  const dir = join(TEST_DATA_DIR, name)
  mkdirSync(dir, { recursive: true })
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['config', 'user.email', ME.email])
  git(dir, ['config', 'user.name', ME.name])
  git(dir, ['config', 'commit.gpgsign', 'false'])
  return dir
}

const alpha = makeRepo('alpha')
commit(alpha, 'before the week', '2026-10-30T12:00:00+01:00')
commit(alpha, 'just after Monday midnight', '2026-11-02T00:30:00+01:00')
commit(alpha, 'wednesday on main', '2026-11-04T10:00:00+01:00')
git(alpha, ['checkout', '-q', '-b', 'feature'])
commit(alpha, 'wednesday on a branch', '2026-11-04T14:00:00+01:00')
git(alpha, ['branch', 'feature-copy']) // same commit reachable from two refs
commit(alpha, 'written friday, rebased next tuesday', '2026-11-06T09:00:00+01:00', { committed: '2026-11-10T09:00:00+01:00' })
commit(alpha, 'the bot did this', '2026-11-07T11:00:00+01:00', { who: OTHER })
commit(alpha, 'late sunday', '2026-11-08T23:30:00+01:00')
commit(alpha, 'monday after', '2026-11-09T00:10:00+01:00')
// A stash is a ref too, and must not count as work.
writeFileSync(join(alpha, 'scratch.txt'), 'x')
git(alpha, ['add', 'scratch.txt'])
git(alpha, ['stash', '-q'], { GIT_AUTHOR_DATE: '2026-11-05T12:00:00+01:00', GIT_COMMITTER_DATE: '2026-11-05T12:00:00+01:00' })

const beta = makeRepo('beta')
commit(beta, 'beta thursday', '2026-11-05T16:00:00+01:00')

const quiet = makeRepo('quiet')
commit(quiet, 'old news', '2026-01-10T10:00:00+01:00')

const repos = [
  { projectId: 1, projectName: 'Alpha', path: alpha },
  { projectId: 2, projectName: 'Beta', path: beta },
  { projectId: 3, projectName: 'Quiet', path: quiet }
]

test('parses the record/field-separated log format', () => {
  const out = 'abc1234\x1f2026-11-04T10:00:00+01:00\x1fMikkel\x1fm@x\x1fHello\x1e\nbad\x1fnot-a-date\x1f\x1f\x1f\x1e'
  assert.deepEqual(parseLogOutput(out), [
    { hash: 'abc1234', at: '2026-11-04T09:00:00.000Z', subject: 'Hello', author: 'Mikkel', authorEmail: 'm@x' }
  ])
})

test('buckets commits into the local days of the week, from every ref, once each', async () => {
  const t = await collectTimeline(weekRange(2026, 45), repos, { now: NOW })
  const subjects = t.days.flatMap((d) => d.projects.flatMap((p) => p.commits.map((c) => c.subject)))
  assert.deepEqual(subjects.sort(), [
    'beta thursday',
    'just after Monday midnight',
    'late sunday',
    'the bot did this',
    'wednesday on a branch',
    'wednesday on main',
    'written friday, rebased next tuesday'
  ])
  assert.equal(t.total, 7)
  assert.equal(t.reposScanned, 3)
  assert.deepEqual(t.skipped, [])
  assert.deepEqual(t.days.map((d) => d.total), [1, 0, 2, 1, 1, 1, 1])
  assert.equal(t.days[2].projects[0].commits[0].subject, 'wednesday on main') // chronological
  assert.deepEqual(
    t.projects.map((p) => [p.projectName, p.total, p.perDay]),
    [
      ['Alpha', 6, [1, 0, 2, 0, 1, 1, 1]],
      ['Beta', 1, [0, 0, 0, 1, 0, 0, 0]]
    ]
  )
  assert.deepEqual(t.authors.map((a) => [a.email, a.count]), [[ME.email, 6], [OTHER.email, 1]])
  assert.equal(t.week.label, 'Week 45 · 2–8 Nov 2026')
  assert.equal(t.week.isCurrent, true)
  assert.equal(t.week.prev, '2026-W44')
  assert.equal(t.week.next, '2026-W46')
})

test('mine=true keeps only the repo user.email', async () => {
  const t = await collectTimeline(weekRange(2026, 45), repos, { now: NOW, mine: true })
  assert.equal(t.total, 6)
  assert.ok(t.authors.every((a) => a.email === ME.email))
})

test('neighbouring weeks get the boundary commits', async () => {
  const before = await collectTimeline(weekRange(2026, 44), repos, { now: NOW })
  assert.deepEqual(before.days.flatMap((d) => d.projects.flatMap((p) => p.commits.map((c) => c.subject))), ['before the week'])
  const after = await collectTimeline(weekRange(2026, 46), repos, { now: new Date('2026-11-12T12:00:00+01:00') })
  assert.deepEqual(after.days.flatMap((d) => d.projects.flatMap((p) => p.commits.map((c) => c.subject))), ['monday after'])
  assert.equal(after.week.isCurrent, true)
})

test('an empty week and a future week are empty, not errors', async () => {
  const empty = await collectTimeline(weekRange(2026, 30), repos, { now: NOW })
  assert.equal(empty.total, 0)
  assert.deepEqual(empty.projects, [])
  assert.equal(empty.days.length, 7)
  const future = await collectTimeline(weekRange(2027, 10), repos, { now: NOW })
  assert.equal(future.week.isFuture, true)
  assert.equal(future.total, 0)
})

test('a folder that is not a readable repo is reported as skipped', async () => {
  const notRepo = join(TEST_DATA_DIR, 'not-a-repo')
  mkdirSync(notRepo, { recursive: true })
  const t = await collectTimeline(weekRange(2026, 45), [{ projectId: 9, projectName: 'Broken', path: notRepo }], { now: NOW })
  assert.equal(t.skipped.length, 1)
  assert.equal(t.skipped[0].projectName, 'Broken')
})

test('getTimeline reads registered, non-archived repo projects', async () => {
  createProject({ name: 'Alpha', path: alpha })
  createProject({ name: 'Beta', path: beta, status: 'archived' })
  createProject({ name: 'Plain folder', path: join(TEST_DATA_DIR, 'not-a-repo') })
  clearTimelineCache()
  const t = await getTimeline('2026-11-04', { now: NOW })
  assert.equal(t.reposScanned, 1)
  assert.deepEqual(t.projects.map((p) => p.projectName), ['Alpha'])
  assert.equal(t.week.key, '2026-W45')
  await assert.rejects(() => getTimeline('nonsense', { now: NOW }))
})

test('filtering by author recomputes every total', async () => {
  const t = await collectTimeline(weekRange(2026, 45), repos, { now: NOW })
  const bot = filterTimelineByAuthor(t, 'BOT@example.com')
  assert.equal(bot.total, 1)
  assert.deepEqual(bot.days.map((d) => d.total), [0, 0, 0, 0, 0, 1, 0])
  assert.deepEqual(bot.projects.map((p) => [p.projectName, p.total, p.perDay]), [['Alpha', 1, [0, 0, 0, 0, 0, 1, 0]]])
  assert.equal(filterTimelineByAuthor(t, ''), t)
})
