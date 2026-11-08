// ISO-8601 weeks (Monday–Sunday, week 1 = the week holding the year's first Thursday), in the
// LOCAL time zone of the process. Pure: no I/O, `now` is always injectable.
//
// Every date is built with the local `new Date(y, m, d)` constructor and never by adding
// 24-hour chunks of milliseconds: a DST-change week is 167 or 169 hours long, and stepping by
// milliseconds would land an hour off midnight and shift every day boundary after the change.

export interface WeekRange {
  // Canonical key, e.g. "2026-W45".
  key: string
  // ISO week-numbering year — differs from the calendar year around New Year.
  year: number
  week: number
  // Local Monday 00:00 (inclusive) and the following Monday 00:00 (exclusive).
  start: Date
  end: Date
  // The seven local calendar dates, Monday first, as YYYY-MM-DD.
  days: string[]
}

export class WeekParseError extends Error {}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

// Monday = 1 … Sunday = 7.
function isoWeekday(d: Date): number {
  return d.getDay() === 0 ? 7 : d.getDay()
}

// Day of year from calendar components only, so a DST shift inside the span cannot skew it.
function dayOfYear(d: Date): number {
  return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 1)) / 86_400_000 + 1
}

export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function isoWeekOf(date: Date): { year: number; week: number } {
  // The Thursday of this week decides both the ISO year and the week number.
  const thursday = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 4 - isoWeekday(date))
  return { year: thursday.getFullYear(), week: Math.floor((dayOfYear(thursday) - 1) / 7) + 1 }
}

// 52 or 53. Dec 28 always lies in the year's last ISO week.
export function weeksInYear(year: number): number {
  return isoWeekOf(new Date(year, 11, 28)).week
}

export function weekKey(year: number, week: number): string {
  return `${pad(year, 4)}-W${pad(week)}`
}

export function weekRange(year: number, week: number): WeekRange {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new WeekParseError(`Invalid year: ${year}`)
  const max = weeksInYear(year)
  if (!Number.isInteger(week) || week < 1 || week > max) {
    throw new WeekParseError(`${year} has weeks 1–${max}; there is no week ${week}`)
  }
  const jan4 = new Date(year, 0, 4)
  const offset = 4 - isoWeekday(jan4) + 1 + (week - 1) * 7 // Jan 4 is always in week 1
  const start = new Date(year, 0, offset)
  const end = new Date(year, 0, offset + 7)
  const days = Array.from({ length: 7 }, (_, i) => localDateKey(new Date(year, 0, offset + i)))
  return { key: weekKey(year, week), year, week, start, end, days }
}

export function weekContaining(date: Date): WeekRange {
  const { year, week } = isoWeekOf(date)
  return weekRange(year, week)
}

export function shiftWeek(range: WeekRange, delta: number): WeekRange {
  return weekContaining(
    new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate() + delta * 7)
  )
}

const WEEK_RE = /^(\d{4})-?W(\d{1,2})$/i
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

// Accepts "2026-W45" (also "2026W45", "2026-w5"), "this", "last", "next", or a calendar date
// ("2026-11-04" → the week containing it). Empty means this week.
export function parseWeek(input: string | null | undefined, now: Date = new Date()): WeekRange {
  const text = (input ?? '').trim().toLowerCase()
  const current = weekContaining(now)
  if (text === '' || text === 'this' || text === 'current') return current
  if (text === 'last' || text === 'prev' || text === 'previous') return shiftWeek(current, -1)
  if (text === 'next') return shiftWeek(current, 1)

  const w = WEEK_RE.exec(text)
  if (w) return weekRange(Number(w[1]), Number(w[2]))

  const d = DATE_RE.exec(text)
  if (d) {
    const [y, m, day] = [Number(d[1]), Number(d[2]), Number(d[3])]
    const date = new Date(y, m - 1, day)
    // The constructor rolls 2026-02-30 over to March; refuse rather than guess.
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== day) {
      throw new WeekParseError(`Not a real date: ${input}`)
    }
    return weekContaining(date)
  }

  throw new WeekParseError(`Unrecognised week "${input}" — use YYYY-Www (2026-W45), this, last, or a date (2026-11-04)`)
}

// "Week 45 · 2–8 Nov 2026", "Week 44 · 26 Oct – 1 Nov 2026", "Week 1 · 29 Dec 2025 – 4 Jan 2026".
export function weekLabel(range: WeekRange): string {
  const a = range.start
  const b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 6)
  let span: string
  if (a.getFullYear() !== b.getFullYear()) {
    span = `${a.getDate()} ${MONTHS[a.getMonth()]} ${a.getFullYear()} – ${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`
  } else if (a.getMonth() !== b.getMonth()) {
    span = `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`
  } else {
    span = `${a.getDate()}–${b.getDate()} ${MONTHS[a.getMonth()]} ${a.getFullYear()}`
  }
  return `Week ${range.week} · ${span}`
}

// "Mon 2 Nov" for a YYYY-MM-DD key.
export function dayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return `${WEEKDAYS[isoWeekday(date) - 1]} ${d} ${MONTHS[m - 1]}`
}
