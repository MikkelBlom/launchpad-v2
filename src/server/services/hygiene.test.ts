import '../test/tempDataDir.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parsePorcelain, parseWorktrees, scanHygiene, sizeFolder } from './hygiene.ts'
import type { HygieneKind, ProjectHygiene } from '../../shared/types.ts'

// Real repositories in a temp folder. The identity and signing flags keep the user's global
// git config (gpg signing, hooks) from leaking into the fixture commits.
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid'
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', ...args], {
    cwd,
    env: GIT_ENV,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'launchpad-hygiene-'))
}

function newRepo(): string {
  const dir = tempDir()
  git(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'README.md'), '# fixture\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'initial')
  return dir
}

let nextId = 1
const scan = (path: string, budget?: { maxEntries: number; maxMs: number }): Promise<ProjectHygiene> =>
  scanHygiene({ id: nextId++, name: 'fixture', path }, budget ? { budget } : {})

const only = (r: ProjectHygiene, kind: HygieneKind) => r.findings.filter((f) => f.kind === kind)

test('a clean repo with no remote and one commit reports only the missing remote', async () => {
  const dir = newRepo()
  const r = await scan(dir)
  assert.equal(r.hasGit, true)
  assert.equal(r.error, null)
  assert.deepEqual(
    r.findings.map((f) => f.kind),
    ['no-remote']
  )
  assert.match(r.findings[0].title, /1 commit exists only on this disk/)
})

test('dirty files are counted and aged by their oldest mtime', async () => {
  const dir = newRepo()
  writeFileSync(join(dir, 'README.md'), '# changed\n')
  writeFileSync(join(dir, 'new.txt'), 'hello\n')
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  utimesSync(join(dir, 'new.txt'), old, old)

  const [dirty] = only(await scan(dir), 'uncommitted')
  assert.ok(dirty, 'expected an uncommitted finding')
  assert.match(dirty.title, /^2 uncommitted files/)
  assert.match(dirty.detail ?? '', /1 changed, 1 untracked/)
  assert.ok(dirty.since)
  const ageDays = (Date.now() - new Date(dirty.since).getTime()) / 86_400_000
  assert.ok(ageDays > 29 && ageDays < 31, `age was ${ageDays}`)
  assert.equal(dirty.command, 'git add -A; git commit -m "<message>"')
})

test('commits ahead of a local bare remote are reported with their subjects', async () => {
  const remote = tempDir()
  git(remote, 'init', '-q', '--bare', '-b', 'main')
  const dir = newRepo()
  git(dir, 'remote', 'add', 'origin', remote)
  git(dir, 'push', '-q', '-u', 'origin', 'main')
  assert.equal(only(await scan(dir), 'unpushed').length, 0)

  writeFileSync(join(dir, 'a.txt'), 'a\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'add a')
  writeFileSync(join(dir, 'b.txt'), 'b\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'add b')

  const [ahead] = only(await scan(dir), 'unpushed')
  assert.ok(ahead)
  assert.equal(ahead.title, '2 commits ahead of origin/main')
  assert.deepEqual(ahead.items, ['add b', 'add a'])
  assert.equal(ahead.command, 'git push')

  // A branch that was never pushed has no upstream: say so, and count what no remote has.
  git(dir, 'checkout', '-q', '-b', 'local-only')
  writeFileSync(join(dir, 'c.txt'), 'c\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'add c')
  const [noUpstream] = only(await scan(dir), 'unpushed')
  assert.match(noUpstream.title, /local-only has no upstream — 3 commits not on any remote/)
  assert.equal(noUpstream.command, 'git push -u origin local-only')
})

test('merged local branches are listed, the current and default branch are not', async () => {
  const dir = newRepo()
  git(dir, 'checkout', '-q', '-b', 'feature')
  writeFileSync(join(dir, 'f.txt'), 'f\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'feature work')
  git(dir, 'checkout', '-q', 'main')
  git(dir, 'merge', '-q', '--no-ff', '-m', 'merge feature', 'feature')
  git(dir, 'branch', 'unmerged')
  git(dir, 'checkout', '-q', 'unmerged')
  writeFileSync(join(dir, 'u.txt'), 'u\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'not merged')
  git(dir, 'checkout', '-q', 'main')

  const [merged] = only(await scan(dir), 'merged-branches')
  assert.ok(merged)
  assert.deepEqual(merged.items, ['feature'])
  assert.equal(merged.command, 'git branch -d feature')
})

test('stale and missing worktrees are reported; worktree folders are not sized as part of the project', async () => {
  const dir = newRepo()
  const parent = tempDir()
  const merged = join(parent, 'wt-merged')
  const gone = join(parent, 'wt-gone')
  // Both branches sit on main's tip, so git counts them as merged.
  git(dir, 'worktree', 'add', '-q', '-b', 'wt-merged', merged)
  git(dir, 'worktree', 'add', '-q', '-b', 'wt-gone', gone)
  rmSync(gone, { recursive: true, force: true })
  const inside = join(dir, '.claude', 'worktrees', 'inner')
  git(dir, 'worktree', 'add', '-q', '-b', 'inner', inside)
  mkdirSync(join(inside, 'node_modules'))
  writeFileSync(join(inside, 'node_modules', 'big.bin'), Buffer.alloc(2 * 1024 * 1024))

  const r = await scan(dir)
  const worktrees = only(r, 'worktree')
  const missing = worktrees.find((f) => f.command === 'git worktree prune')
  assert.ok(missing, 'expected a prune suggestion for the deleted worktree')
  const stale = worktrees.find((f) => f.items.includes('wt-merged'))
  assert.ok(stale, 'expected the merged worktree to be stale')
  assert.match(stale.detail ?? '', /merged into main/)
  assert.match(stale.command ?? '', /^git worktree remove /)
  // The worktree branches are checked out, so they are not offered for `git branch -d`.
  assert.equal(only(r, 'merged-branches').length, 0)
  assert.equal(only(r, 'regenerable').length, 0, 'a worktree nested in the project is its own checkout')
})

test('node_modules is found, sized exactly, and junctions inside it are not followed', async () => {
  const dir = newRepo()
  writeFileSync(join(dir, 'package.json'), '{}\n')
  const nm = join(dir, 'node_modules')
  mkdirSync(join(nm, 'pkg'), { recursive: true })
  writeFileSync(join(nm, 'pkg', 'index.js'), Buffer.alloc(1024 * 1024))
  writeFileSync(join(nm, 'pkg', 'extra.js'), Buffer.alloc(512 * 1024))
  // pnpm on Windows: node_modules entries are junctions into a store. Counting through one
  // would report the store, so it must not be followed.
  const store = tempDir()
  writeFileSync(join(store, 'huge.bin'), Buffer.alloc(4 * 1024 * 1024))
  symlinkSync(store, join(nm, 'linked'), 'junction')
  // A monorepo package one level down.
  mkdirSync(join(dir, 'packages', 'web', 'node_modules'), { recursive: true })
  writeFileSync(join(dir, 'packages', 'web', 'node_modules', 'x.js'), Buffer.alloc(2 * 1024 * 1024))
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n')

  const folders = only(await scan(dir), 'regenerable')
  const root = folders.find((f) => f.path === 'node_modules')
  assert.ok(root, 'expected node_modules')
  assert.equal(root.bytes, 1024 * 1024 + 512 * 1024)
  assert.equal(root.bytesExact, true)
  assert.match(root.command ?? '', /node_modules/)
  assert.ok(folders.some((f) => f.path === 'packages/web/node_modules'))
  assert.ok(existsSync(join(store, 'huge.bin')), 'scanning never deletes anything')
})

test('build output is only reported when untracked and next to a manifest', async () => {
  const dir = newRepo()
  writeFileSync(join(dir, 'package.json'), '{}\n')
  mkdirSync(join(dir, 'dist'))
  writeFileSync(join(dir, 'dist', 'bundle.js'), Buffer.alloc(2 * 1024 * 1024))
  mkdirSync(join(dir, 'docs', 'build'), { recursive: true }) // no manifest beside it
  writeFileSync(join(dir, 'docs', 'build', 'page.html'), Buffer.alloc(2 * 1024 * 1024))
  assert.ok(only(await scan(dir), 'regenerable').some((f) => f.path === 'dist'))

  git(dir, 'add', 'dist')
  git(dir, 'commit', '-q', '-m', 'commit dist on purpose')
  const after = only(await scan(dir), 'regenerable')
  assert.equal(after.length, 0, 'tracked dist/ is source, and docs/build has no manifest')
})

test('the size budget stops early and reports a lower bound', async () => {
  const dir = tempDir()
  for (let i = 0; i < 40; i++) writeFileSync(join(dir, `f${i}.bin`), Buffer.alloc(1000))
  const full = await sizeFolder(dir)
  assert.deepEqual(full, { bytes: 40_000, entries: 40, exact: true })

  const capped = await sizeFolder(dir, { maxEntries: 10, maxMs: 10_000 })
  assert.equal(capped.exact, false)
  assert.ok(capped.bytes <= 10_000)

  const r = await scan(dir, { maxEntries: 10, maxMs: 10_000 })
  assert.equal(r.findings.length, 0, 'a plain folder has nothing regenerable')
})

test('a project folder that is gone yields an error, not a throw', async () => {
  const r = await scan(join(tmpdir(), 'launchpad-hygiene-does-not-exist-' + Date.now()))
  assert.equal(r.error, 'Project folder not found on disk')
  assert.deepEqual(r.findings, [])
})

test('porcelain and worktree parsers', () => {
  assert.deepEqual(parsePorcelain(' M a.txt\0R  new.txt\0old.txt\0?? dir/\0'), [
    { code: ' M', path: 'a.txt' },
    { code: 'R ', path: 'new.txt' },
    { code: '??', path: 'dir/' }
  ])
  const wts = parseWorktrees(
    'worktree C:/repo\nHEAD abc\nbranch refs/heads/main\n\nworktree C:/wt\nHEAD def\ndetached\nprunable gitdir file points to non-existent location\n'
  )
  assert.equal(wts.length, 2)
  assert.equal(wts[0].branch, 'main')
  assert.equal(wts[1].detached, true)
  assert.equal(wts[1].prunable, true)
})
