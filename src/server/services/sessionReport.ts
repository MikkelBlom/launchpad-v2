import { listNotes } from '../repo/notes.ts'
import { listTasks } from '../repo/tasks.ts'
import { applyPush, fallbackTitle, key } from './agentPush.ts'
import type {
  Provenance,
  PushNote,
  PushPlan,
  PushTask,
  SessionReport,
  SessionReportItem,
  SessionReportResult
} from '../../shared/types.ts'

// A session report is an agent's end-of-session handoff (`launchpad report`). It is turned
// into an ordinary push plan and applied through applyPush, so it inherits everything batch
// push guarantees: one transaction, a pre-apply backup, dry-run on the same code path,
// match-by-normalized-title idempotency, and "an archived match is not recreated".
//
//   decision  → task tagged  needs-mikkel + decision
//   deferred  → task tagged  needs-mikkel + deferred
//   the whole report → ONE note tagged session-report, titled
//                      "Session report — <date> — <title or first line of summary>"
//
// Re-running the identical report on the same day creates nothing: the note matches on its
// title, the tasks on theirs.

export const TAG_NEEDS_MIKKEL = 'needs-mikkel'
export const TAG_DECISION = 'decision'
export const TAG_DEFERRED = 'deferred'
export const TAG_SESSION_REPORT = 'session-report'

const NOTE_TITLE_TOPIC_MAX = 60

export class ReportError extends Error {}

interface NormalizedItem {
  title: string
  body?: string
}

function normalizeItems(value: unknown, field: string): NormalizedItem[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new ReportError(`"${field}" must be an array`)
  return value.map((raw, i) => {
    if (typeof raw === 'string') {
      const title = raw.trim()
      if (!title) throw new ReportError(`"${field}[${i}]" is empty`)
      return { title }
    }
    if (raw && typeof raw === 'object' && typeof (raw as { title?: unknown }).title === 'string') {
      const { title, body } = raw as { title: string; body?: unknown }
      if (!title.trim()) throw new ReportError(`"${field}[${i}].title" is empty`)
      if (body !== undefined && typeof body !== 'string') {
        throw new ReportError(`"${field}[${i}].body" must be a string`)
      }
      const trimmedBody = typeof body === 'string' ? body.trim() : ''
      return trimmedBody ? { title: title.trim(), body: trimmedBody } : { title: title.trim() }
    }
    throw new ReportError(`"${field}[${i}]" must be a string or { "title": "…", "body"?: "…" }`)
  })
}

/** Validate an untrusted request body into a SessionReport. Throws ReportError. */
export function validateReport(input: unknown): SessionReport {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ReportError('A report must be a JSON object with at least a "summary"')
  }
  const raw = input as Record<string, unknown>
  if (typeof raw.summary !== 'string' || !raw.summary.trim()) {
    throw new ReportError('"summary" is required and must be a non-empty string')
  }
  if (raw.title !== undefined && typeof raw.title !== 'string') {
    throw new ReportError('"title" must be a string')
  }
  const next = raw.next
  if (next !== undefined && (!Array.isArray(next) || next.some((n) => typeof n !== 'string'))) {
    throw new ReportError('"next" must be an array of strings')
  }
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : undefined
  return {
    ...(title ? { title } : {}),
    summary: raw.summary.trim(),
    decisions: normalizeItems(raw.decisions, 'decisions'),
    deferred: normalizeItems(raw.deferred, 'deferred'),
    next: ((next as string[] | undefined) ?? []).map((n) => n.trim()).filter(Boolean)
  }
}

/** YYYY-MM-DD in local time — a report belongs to the day Mikkel sees it on. */
export function localDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function reportNoteTitle(report: SessionReport, date: string): string {
  let topic = report.title?.trim() ?? ''
  if (!topic) {
    // Without a title, the summary's first line names the note. Using the date alone would
    // make two different reports on the same day match each other and overwrite.
    const firstLine = report.summary.trim().split('\n')[0].trim()
    topic =
      firstLine.length > NOTE_TITLE_TOPIC_MAX
        ? `${firstLine.slice(0, NOTE_TITLE_TOPIC_MAX - 1).trimEnd()}…`
        : firstLine
  }
  return `Session report — ${date} — ${topic}`
}

function asItem(raw: SessionReportItem): NormalizedItem {
  return typeof raw === 'string' ? { title: raw } : raw
}

function renderItems(items: NormalizedItem[]): string {
  return items
    .map((item) => {
      if (!item.body) return `- ${item.title}`
      const body = item.body
        .split('\n')
        .map((line) => (line ? `  ${line}` : ''))
        .join('\n')
      return `- **${item.title}**\n${body}`
    })
    .join('\n')
}

export function renderReportNote(report: SessionReport): string {
  const decisions = (report.decisions ?? []).map(asItem)
  const deferred = (report.deferred ?? []).map(asItem)
  const next = report.next ?? []
  const sections = [`## Summary\n\n${report.summary.trim()}`]
  if (decisions.length) sections.push(`## Decisions for Mikkel\n\n${renderItems(decisions)}`)
  if (deferred.length) sections.push(`## Deferred / not done\n\n${renderItems(deferred)}`)
  if (next.length) sections.push(`## Suggested next steps\n\n${next.map((n) => `- ${n}`).join('\n')}`)
  if (decisions.length || deferred.length) {
    sections.push(`_Decisions and deferred items are also tasks tagged \`${TAG_NEEDS_MIKKEL}\`._`)
  }
  return sections.join('\n\n')
}

export interface BuildReportOptions {
  date: string
  // Normalized titles (agentPush `key`) of the project's live tasks / notes. An item that
  // already exists is sent without `tags`, because a push item's tags REPLACE its tag set:
  // re-sending them would wipe tags Mikkel added and re-flag a task he un-flagged.
  existingTaskKeys?: Set<string>
  existingNoteKeys?: Set<string>
}

export interface BuiltReport {
  plan: PushPlan
  noteTitle: string
  warnings: string[]
}

/** Pure: report → push plan. No database access. */
export function buildReportPlan(report: SessionReport, options: BuildReportOptions): BuiltReport {
  const existingTasks = options.existingTaskKeys ?? new Set<string>()
  const existingNotes = options.existingNoteKeys ?? new Set<string>()
  const warnings: string[] = []
  const seen = new Set<string>()
  const tasks: PushTask[] = []

  const addTasks = (items: SessionReportItem[] | undefined, kindTag: string) => {
    for (const raw of items ?? []) {
      const item = asItem(raw)
      const k = key(item.title)
      if (!k) continue
      if (seen.has(k)) {
        warnings.push(`"${item.title}" appears more than once in the report — kept the first`)
        continue
      }
      seen.add(k)
      const task: PushTask = { title: item.title }
      if (item.body) task.body = item.body
      if (!existingTasks.has(k)) task.tags = [TAG_NEEDS_MIKKEL, kindTag]
      tasks.push(task)
    }
  }
  addTasks(report.decisions, TAG_DECISION)
  addTasks(report.deferred, TAG_DEFERRED)

  const noteTitle = reportNoteTitle(report, options.date)
  const note: PushNote = { title: noteTitle, body: renderReportNote(report) }
  if (!existingNotes.has(key(noteTitle))) note.tags = [TAG_SESSION_REPORT]

  const plan: PushPlan = { notes: [note] }
  if (tasks.length) plan.tasks = tasks
  return { plan, noteTitle, warnings }
}

/**
 * Validate, plan and apply a session report.
 *
 * The write is always attributed to source `agent` (the caller's actor is kept). The CLI
 * labels a TTY run `cli`, but a session report is by definition an agent's handoff, and its
 * note must show up as agent-written whoever pressed Enter. The UI never calls this.
 */
export function applyReport(
  projectId: number,
  input: unknown,
  provenance: Provenance,
  options: { dryRun?: boolean; date?: string } = {}
): SessionReportResult {
  const report = validateReport(input)
  const existingTaskKeys = new Set(listTasks(projectId).map((t) => key(fallbackTitle(t))))
  const existingNoteKeys = new Set(listNotes(projectId).map((n) => key(fallbackTitle(n))))
  const built = buildReportPlan(report, {
    date: options.date ?? localDate(),
    existingTaskKeys,
    existingNoteKeys
  })
  const result = applyPush(
    projectId,
    built.plan,
    { ...provenance, source: 'agent' },
    { dryRun: options.dryRun }
  )
  return { ...result, warnings: [...built.warnings, ...result.warnings], noteTitle: built.noteTitle }
}
