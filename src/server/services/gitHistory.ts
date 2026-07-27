import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { simpleGit, type SimpleGit } from 'simple-git'
import type { DiffFile, GitCommit, ProjectDiff } from '../../shared/types.ts'

export async function recentCommits(projectPath: string, limit = 20): Promise<GitCommit[]> {
  if (!existsSync(join(projectPath, '.git'))) return []
  try {
    const git = simpleGit(projectPath)
    const log = await git.log({ maxCount: limit })
    return log.all.map((c) => {
      const parsed = new Date(c.date)
      return {
        hash: c.hash.slice(0, 8),
        date: Number.isFinite(parsed.getTime()) ? parsed.toISOString() : c.date,
        message: c.message,
        author: c.author_name
      }
    })
  } catch {
    return []
  }
}

// ---- Working-tree diff ----

// A diff view is a convenience, not an archive. A repo mid-rebase, with a regenerated
// lockfile or a rebuilt `dist/`, can produce hundreds of megabytes of patch text — enough to
// stall the service and wedge the browser tab. Every limit below is applied *before* any
// patch text is read: `--numstat` tells us how big each file's diff is for a few bytes of
// output, so oversized files are dropped without git ever printing them.
const MAX_FILES = 200 // files listed at all (tracked + untracked)
const MAX_FILE_PATCH_LINES = 2000 // lines kept per file
const MAX_FILE_PATCH_CHARS = 160_000 // guards single files of minified one-liners
const MAX_TOTAL_PATCH_CHARS = 1_500_000 // ceiling on the whole response body
const MAX_PATCH_BUDGET_LINES = 20_000 // changed lines we are willing to ask git to print
const MAX_BLOB_BYTES = 1_000_000 // skip the patch for working-tree blobs this large
const MAX_UNTRACKED_BYTES = 128 * 1024 // untracked files bigger than this are not inlined
const PATHSPEC_BATCH = 40 // keeps the Windows command line far below its length limit
const GIT_TIMEOUT_MS = 20_000

const DIFF_HEADER = 'diff --git '

interface NumStatRow {
  path: string
  oldPath: string | null
  additions: number
  deletions: number
  binary: boolean
}

export async function projectDiff(projectPath: string, staged = false): Promise<ProjectDiff> {
  const empty: ProjectDiff = {
    staged,
    files: [],
    totalAdditions: 0,
    totalDeletions: 0,
    truncated: false
  }
  if (!existsSync(join(projectPath, '.git'))) return empty

  try {
    const git = simpleGit({
      baseDir: projectPath,
      // `core.quotePath=false` keeps non-ASCII paths verbatim, so the `diff --git` header
      // lines match the paths `--numstat -z` handed us and the per-file split stays exact.
      // The block timeout stops a wedged git from holding the request open forever.
      config: ['core.quotePath=false'],
      timeout: { block: GIT_TIMEOUT_MS }
    })

    // An empty repo has no HEAD; `git diff HEAD` would just error there.
    const hasHead = await headExists(git)
    const base = staged ? ['--cached'] : hasHead ? ['HEAD'] : []
    // `--no-ext-diff` keeps a user-configured difftool/textconv out of the pipeline.
    const scope = [...base, '-M', '--no-color', '--no-ext-diff']

    const [numstatOut, nameStatusOut] = await Promise.all([
      git.diff([...scope, '--numstat', '-z']),
      git.diff([...scope, '--name-status', '-z'])
    ])

    const rows = parseNumstat(numstatOut)
    const statuses = parseNameStatus(nameStatusOut)
    let truncated = rows.length > MAX_FILES
    const listed = rows.slice(0, MAX_FILES)

    const files: DiffFile[] = listed.map((row) => ({
      path: row.path,
      status: statuses.get(row.path) ?? (row.oldPath ? 'renamed' : 'modified'),
      additions: row.additions,
      deletions: row.deletions,
      patch: '',
      binary: row.binary,
      truncated: false
    }))
    const byPath = new Map(files.map((f) => [f.path, f]))

    // Decide up front which files we will ask for patch text for, so the size of git's
    // output is bounded before it is produced.
    const byHeader = new Map<string, string>()
    const wanted: NumStatRow[] = []
    let budget = MAX_PATCH_BUDGET_LINES
    listed.forEach((row, i) => {
      const file = files[i]
      if (row.binary) return
      const changed = row.additions + row.deletions
      // 0/0 means a pure rename or a mode change — there is no hunk to fetch.
      if (changed === 0) return
      if (changed > MAX_FILE_PATCH_LINES || blobTooBig(projectPath, row.path)) {
        file.truncated = true
        return
      }
      if (changed > budget) {
        file.truncated = true
        truncated = true
        return
      }
      budget -= changed
      wanted.push(row)
      // Rename detection only fires when both ends are inside the pathspec, so the header
      // for a rename stays `a/<old> b/<new>` — which is exactly the key we build here.
      byHeader.set(`${DIFF_HEADER}a/${row.oldPath ?? row.path} b/${row.path}`, row.path)
    })

    let totalChars = 0
    for (let i = 0; i < wanted.length; i += PATHSPEC_BATCH) {
      if (totalChars >= MAX_TOTAL_PATCH_CHARS) {
        truncated = true
        break
      }
      const batch = wanted.slice(i, i + PATHSPEC_BATCH)
      const paths = batch.flatMap((row) => (row.oldPath ? [row.oldPath, row.path] : [row.path]))
      const patches = splitPatches(await git.diff([...scope, '--', ...paths]), byHeader)
      for (const [path, body] of patches) {
        const file = byPath.get(path)
        if (!file) continue
        const capped = capPatch(body)
        let text = capped.patch
        let cut = capped.truncated
        const remaining = MAX_TOTAL_PATCH_CHARS - totalChars
        if (text.length > remaining) {
          text = text.slice(0, Math.max(0, remaining))
          cut = true
          truncated = true
        }
        file.patch = text
        file.truncated = cut
        totalChars += text.length
      }
    }

    // Untracked files never show up in `git diff`, and in a dirty repo they are usually the
    // most interesting thing in it — so list them explicitly on the working-tree view.
    if (!staged) {
      const untracked = (await git.raw(['ls-files', '--others', '--exclude-standard', '-z']))
        .split('\0')
        .filter(Boolean)
      for (const rel of untracked) {
        if (files.length >= MAX_FILES) {
          truncated = true
          break
        }
        files.push(readUntracked(projectPath, rel))
      }
    }

    return {
      staged,
      files,
      totalAdditions: files.reduce((n, f) => n + f.additions, 0),
      totalDeletions: files.reduce((n, f) => n + f.deletions, 0),
      // Top-level flag means "something was left out of this response", whether that was a
      // whole file or the tail of one — the UI says so rather than quietly showing less.
      truncated: truncated || files.some((f) => f.truncated)
    }
  } catch {
    return empty
  }
}

async function headExists(git: SimpleGit): Promise<boolean> {
  try {
    await git.raw(['rev-parse', '--verify', 'HEAD'])
    return true
  } catch {
    return false
  }
}

function blobTooBig(projectPath: string, relPath: string): boolean {
  try {
    return statSync(join(projectPath, relPath)).size > MAX_BLOB_BYTES
  } catch {
    // Deleted files have no working copy — nothing to guard against.
    return false
  }
}

// `--numstat -z` emits `<add>\t<del>\t<path>\0`, and for a rename `<add>\t<del>\t\0<old>\0<new>\0`.
// Binary files report `-` for both counts.
function parseNumstat(out: string): NumStatRow[] {
  const tokens = out.split('\0')
  const rows: NumStatRow[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) continue
    const firstTab = token.indexOf('\t')
    const secondTab = token.indexOf('\t', firstTab + 1)
    if (firstTab < 0 || secondTab < 0) continue
    const added = token.slice(0, firstTab)
    const removed = token.slice(firstTab + 1, secondTab)
    const inlinePath = token.slice(secondTab + 1)
    const binary = added === '-' || removed === '-'
    let oldPath: string | null = null
    let path = inlinePath
    if (!inlinePath) {
      oldPath = tokens[++i] ?? ''
      path = tokens[++i] ?? ''
    }
    if (!path) continue
    rows.push({
      path,
      oldPath,
      additions: binary ? 0 : Number(added) || 0,
      deletions: binary ? 0 : Number(removed) || 0,
      binary
    })
  }
  return rows
}

// `--name-status -z` emits `<code>\0<path>\0`, and `R<score>\0<old>\0<new>\0` for renames.
function parseNameStatus(out: string): Map<string, DiffFile['status']> {
  const tokens = out.split('\0').filter(Boolean)
  const statuses = new Map<string, DiffFile['status']>()
  for (let i = 0; i < tokens.length; ) {
    const code = tokens[i++]
    const letter = code[0]
    if (letter === 'R' || letter === 'C') {
      i++ // the old path, which we already have from numstat
      const to = tokens[i++]
      if (to) statuses.set(to, 'renamed')
      continue
    }
    const path = tokens[i++]
    if (!path) continue
    statuses.set(path, letter === 'A' ? 'added' : letter === 'D' ? 'deleted' : 'modified')
  }
  return statuses
}

// Splits a multi-file patch back into per-file bodies. Only a real header sits at column 0
// (content lines always carry a `+`/`-`/space prefix), and every header is matched against
// the exact key we built from numstat rather than parsed — paths with spaces make
// `diff --git a/x b/y` genuinely ambiguous to parse.
function splitPatches(out: string, byHeader: Map<string, string>): Map<string, string> {
  const patches = new Map<string, string>()
  let current: string | null = null
  let body: string[] = []
  let seenHunk = false

  const flush = (): void => {
    if (current) patches.set(current, body.join('\n'))
    current = null
    body = []
    seenHunk = false
  }

  for (const raw of out.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.startsWith(DIFF_HEADER)) {
      flush()
      current = byHeader.get(line) ?? null
      continue
    }
    if (!current) continue
    if (!seenHunk) {
      // Drop the per-file preamble (index/mode/---/+++): the UI already shows the path.
      if (!line.startsWith('@@')) continue
      seenHunk = true
    }
    body.push(line)
  }
  flush()
  return patches
}

function capPatch(text: string): { patch: string; truncated: boolean } {
  let patch = text.replace(/\n+$/, '')
  let truncated = false
  const lines = patch.split('\n')
  if (lines.length > MAX_FILE_PATCH_LINES) {
    patch = lines.slice(0, MAX_FILE_PATCH_LINES).join('\n')
    truncated = true
  }
  if (patch.length > MAX_FILE_PATCH_CHARS) {
    patch = patch.slice(0, MAX_FILE_PATCH_CHARS)
    truncated = true
  }
  return { patch, truncated }
}

// A NUL byte in the first few KB is the same heuristic git itself uses to call a file binary.
function looksBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0)
}

// Untracked files have no blob to diff against, so we synthesise an all-additions hunk —
// but only when the file is small and clearly text. Anything else is reported honestly
// rather than inlined.
function readUntracked(projectPath: string, relPath: string): DiffFile {
  const file: DiffFile = {
    path: relPath,
    status: 'untracked',
    additions: 0,
    deletions: 0,
    patch: '',
    binary: false,
    truncated: false
  }
  const full = join(projectPath, relPath)
  let buf: Buffer
  try {
    if (statSync(full).size > MAX_UNTRACKED_BYTES) return { ...file, truncated: true }
    buf = readFileSync(full)
  } catch {
    return { ...file, truncated: true }
  }
  if (looksBinary(buf)) return { ...file, binary: true }

  const text = buf.toString('utf8').replace(/\r?\n$/, '')
  const lines = text === '' ? [] : text.split(/\r?\n/)
  const kept = lines.slice(0, MAX_FILE_PATCH_LINES)
  return {
    ...file,
    additions: lines.length,
    patch: [`@@ -0,0 +1,${lines.length} @@`, ...kept.map((l) => `+${l}`)].join('\n'),
    truncated: kept.length < lines.length
  }
}
