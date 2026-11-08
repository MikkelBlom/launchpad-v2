import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { simpleGit } from 'simple-git'
import { listProjects } from '../repo/projects.ts'
import { dayLabel, localDateKey, parseWeek, shiftWeek, weekContaining, weekLabel, type WeekRange } from '../../shared/isoWeek.ts'
import type {
  Timeline,
  TimelineAuthor,
  TimelineCommit,
  TimelineDay,
  TimelineProjectTotal,
  TimelineWeek
} from '../../shared/types.ts'

// "What did I touch this week": one `git log` per registered repo, bucketed into the seven
// local days of an ISO week. Read-only — nothing here writes to the database or the repos.

const GIT_TIMEOUT_MS = 15_000
const CONCURRENCY = 4
// `--since/--until` filter on the COMMITTER date, but the timeline is bucketed by AUTHOR date
// (when the work was written). A commit authored on Friday and rebased on Monday has a
// committer date in the next week, so git is asked for a window that runs on past the end and
// the exact cut is made on author date afterwards.
const UNTIL_SLACK_DAYS = 7
const MAX_COMMITS_PER_REPO = 2000 // a runaway import/rewrite must not balloon the response
const CURRENT_TTL_MS = 60_000
const PAST_TTL_MS = 15 * 60_000
const MAX_CACHE_ENTRIES = 24

const FIELD = '\x1f'
const RECORD = '\x1e'
const FORMAT = ['%h', '%aI', '%an', '%ae', '%s'].join('%x1f') + '%x1e'

export interface TimelineRepo {
  projectId: number
  projectName: string
  path: string
  color?: string | null
}

export interface TimelineOptions {
  mine?: boolean
  now?: Date
}

interface RepoResult {
  repo: TimelineRepo
  commits: TimelineCommit[]
  error?: string
}

export function parseLogOutput(out: string): TimelineCommit[] {
  const commits: TimelineCommit[] = []
  for (const raw of out.split(RECORD)) {
    const record = raw.replace(/^[\r\n]+/, '')
    if (!record) continue
    const [hash, date, author, authorEmail, ...subject] = record.split(FIELD)
    const at = new Date(date ?? '')
    if (!hash || !Number.isFinite(at.getTime())) continue
    commits.push({
      hash,
      at: at.toISOString(),
      // A subject cannot contain the separator in practice, but rejoin rather than truncate.
      subject: subject.join(FIELD).trim(),
      author: author ?? '',
      authorEmail: authorEmail ?? ''
    })
  }
  return commits
}

async function readRepo(repo: TimelineRepo, range: WeekRange, mine: boolean): Promise<RepoResult> {
  try {
    const git = simpleGit({
      baseDir: repo.path,
      config: ['core.quotePath=false', 'log.showSignature=false', 'i18n.logOutputEncoding=UTF-8'],
      timeout: { block: GIT_TIMEOUT_MS }
    })
    let email: string | null = null
    if (mine) {
      email = (await git.raw(['config', '--get', 'user.email']).catch(() => '')).trim().toLowerCase() || null
      if (!email) return { repo, commits: [], error: 'no git user.email configured, so "mine" cannot be decided' }
    }
    const until = new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate() + UNTIL_SLACK_DAYS)
    const out = await git.raw([
      'log',
      // `--all` reads every ref once (a commit on three branches is listed once), but the stash
      // and git-notes refs are bookkeeping, not work: "WIP on master" is not something you did.
      '--exclude=refs/stash',
      '--exclude=refs/notes/*',
      '--all',
      '--no-color',
      `--max-count=${MAX_COMMITS_PER_REPO}`,
      `--since=${range.start.toISOString()}`,
      `--until=${until.toISOString()}`,
      `--format=${FORMAT}`
    ])
    const startMs = range.start.getTime()
    const endMs = range.end.getTime()
    const commits = parseLogOutput(out).filter((c) => {
      const t = new Date(c.at).getTime()
      if (t < startMs || t >= endMs) return false
      return !email || c.authorEmail.toLowerCase() === email
    })
    return { repo, commits }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { repo, commits: [], error: /timed? ?out|block timeout/i.test(message) ? 'git log timed out' : `git log failed: ${message.split('\n')[0]}` }
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export function describeWeek(range: WeekRange, now: Date): TimelineWeek {
  const current = weekContaining(now)
  return {
    key: range.key,
    year: range.year,
    week: range.week,
    start: range.start.toISOString(),
    end: range.end.toISOString(),
    days: range.days,
    label: weekLabel(range),
    prev: shiftWeek(range, -1).key,
    next: shiftWeek(range, 1).key,
    isCurrent: range.key === current.key,
    isFuture: range.start.getTime() > now.getTime()
  }
}

// Pure aggregation: repo results → per-day/per-project buckets and totals.
export function aggregate(range: WeekRange, results: RepoResult[], now: Date, mine: boolean): Timeline {
  const dayIndex = new Map(range.days.map((d, i) => [d, i]))
  const days: TimelineDay[] = range.days.map((date) => ({ date, label: dayLabel(date), total: 0, projects: [] }))
  const projects: TimelineProjectTotal[] = []
  const authors = new Map<string, TimelineAuthor>()
  let total = 0

  for (const { repo, commits } of results) {
    if (commits.length === 0) continue
    const perDay = [0, 0, 0, 0, 0, 0, 0]
    const byDay = new Map<number, TimelineCommit[]>()
    for (const commit of commits) {
      const i = dayIndex.get(localDateKey(new Date(commit.at)))
      if (i === undefined) continue
      perDay[i]++
      const list = byDay.get(i) ?? []
      list.push(commit)
      byDay.set(i, list)
      const key = (commit.authorEmail || commit.author).toLowerCase()
      const author = authors.get(key) ?? { name: commit.author, email: commit.authorEmail, count: 0 }
      author.count++
      authors.set(key, author)
    }
    const repoTotal = perDay.reduce((a, b) => a + b, 0)
    if (repoTotal === 0) continue
    total += repoTotal
    projects.push({ projectId: repo.projectId, projectName: repo.projectName, color: repo.color ?? null, total: repoTotal, perDay })
    for (const [i, list] of byDay) {
      list.sort((a, b) => a.at.localeCompare(b.at))
      days[i].projects.push({ projectId: repo.projectId, projectName: repo.projectName, commits: list })
      days[i].total += list.length
    }
  }

  for (const day of days) {
    day.projects.sort((a, b) => b.commits.length - a.commits.length || a.projectName.localeCompare(b.projectName))
  }
  projects.sort((a, b) => b.total - a.total || a.projectName.localeCompare(b.projectName))

  return {
    week: describeWeek(range, now),
    days,
    projects,
    total,
    authors: [...authors.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    mine,
    skipped: results
      .filter((r) => r.error)
      .map((r) => ({ projectId: r.repo.projectId, projectName: r.repo.projectName, reason: r.error as string })),
    reposScanned: results.length,
    generatedAt: now.toISOString()
  }
}

export async function collectTimeline(range: WeekRange, repos: TimelineRepo[], options: TimelineOptions = {}): Promise<Timeline> {
  const now = options.now ?? new Date()
  const mine = options.mine === true
  // A week that has not started has no commits; don't spawn a git per repo to learn that.
  const results =
    range.start.getTime() > now.getTime()
      ? repos.map((repo) => ({ repo, commits: [] }))
      : await mapLimit(repos, CONCURRENCY, (repo) => readRepo(repo, range, mine))
  return aggregate(range, results, now, mine)
}

// Registered, non-archived projects whose folder is itself a repo root. `.git` must sit in the
// project folder (a file for worktrees, a directory otherwise): a project registered inside
// another repo would otherwise list its parent's commits a second time.
export function timelineRepos(): TimelineRepo[] {
  return listProjects()
    .filter((p) => p.status !== 'archived' && p.pathExists && existsSync(join(p.path, '.git')))
    .map((p) => ({ projectId: p.id, projectName: p.name, path: p.path, color: p.color }))
}

const cache = new Map<string, { expires: number; value: Promise<Timeline> }>()

export function clearTimelineCache(): void {
  cache.clear()
}

// Throws WeekParseError for an input that is not a week.
export async function getTimeline(
  weekInput: string | undefined,
  options: TimelineOptions & { refresh?: boolean } = {}
): Promise<Timeline> {
  const now = options.now ?? new Date()
  const range = parseWeek(weekInput, now)
  const key = `${range.key}|${options.mine ? 'mine' : 'all'}`
  const hit = cache.get(key)
  if (hit && !options.refresh && hit.expires > Date.now()) return hit.value

  const value = collectTimeline(range, timelineRepos(), { mine: options.mine, now })
  // A finished week only changes if someone rewrites history, so it can stay cached longer.
  const ttl = range.end.getTime() <= now.getTime() ? PAST_TTL_MS : CURRENT_TTL_MS
  cache.set(key, { expires: Date.now() + ttl, value })
  value.catch(() => cache.delete(key))
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string)
  return value
}
