// Week maths is local-time maths, so pin the zone the user actually lives in (Denmark) —
// including its DST changes. Node re-reads TZ when it is assigned at runtime.
process.env.TZ = 'Europe/Copenhagen'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isoWeekOf, parseWeek, shiftWeek, weekLabel, weekRange, weeksInYear, WeekParseError, dayLabel } from './isoWeek.ts'

const NOW = new Date(2026, 10, 8, 15, 0) // Sunday 8 Nov 2026, afternoon

test('the zone is really Copenhagen', () => {
  assert.equal(new Date(2026, 6, 1).getTimezoneOffset(), -120)
  assert.equal(new Date(2026, 0, 1).getTimezoneOffset(), -60)
})

test('this week, last week and a named week', () => {
  const w = parseWeek('this', NOW)
  assert.equal(w.key, '2026-W45')
  assert.deepEqual(w.days, ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'])
  assert.equal(parseWeek(undefined, NOW).key, '2026-W45')
  assert.equal(parseWeek('', NOW).key, '2026-W45')
  assert.equal(parseWeek('last', NOW).key, '2026-W44')
  assert.equal(parseWeek('next', NOW).key, '2026-W46')
  assert.equal(parseWeek('2026-W45', NOW).key, '2026-W45')
  assert.equal(parseWeek('2026w5', NOW).key, '2026-W05')
  assert.equal(parseWeek(' 2026-W05 ', NOW).key, '2026-W05')
})

test('a date picks the week containing it', () => {
  assert.equal(parseWeek('2026-11-04', NOW).key, '2026-W45')
  assert.equal(parseWeek('2026-11-02', NOW).key, '2026-W45') // Monday
  assert.equal(parseWeek('2026-11-08', NOW).key, '2026-W45') // Sunday
  assert.equal(parseWeek('2026-11-09', NOW).key, '2026-W46')
})

test('week boundaries are local midnight, Monday to Monday', () => {
  const w = weekRange(2026, 45)
  assert.equal(w.start.getTime(), new Date(2026, 10, 2).getTime())
  assert.equal(w.end.getTime(), new Date(2026, 10, 9).getTime())
  assert.equal(w.start.getDay(), 1)
  assert.equal(w.start.getHours(), 0)
})

test('year boundaries: ISO year differs from calendar year', () => {
  // 1 Jan 2026 is a Thursday → week 1 of 2026 starts Mon 29 Dec 2025.
  assert.deepEqual(isoWeekOf(new Date(2025, 11, 29)), { year: 2026, week: 1 })
  assert.equal(parseWeek('2025-12-31', NOW).key, '2026-W01')
  assert.equal(weekRange(2026, 1).days[0], '2025-12-29')
  // 1 Jan 2027 is a Friday → it belongs to 2026-W53.
  assert.deepEqual(isoWeekOf(new Date(2027, 0, 1)), { year: 2026, week: 53 })
  assert.deepEqual(isoWeekOf(new Date(2027, 0, 3)), { year: 2026, week: 53 })
  assert.deepEqual(isoWeekOf(new Date(2027, 0, 4)), { year: 2027, week: 1 })
  // 1 Jan 2021 was a Friday → 2020-W53.
  assert.deepEqual(isoWeekOf(new Date(2021, 0, 1)), { year: 2020, week: 53 })
})

test('week 53 exists only in long years', () => {
  assert.equal(weeksInYear(2026), 53)
  assert.equal(weeksInYear(2020), 53)
  assert.equal(weeksInYear(2025), 52)
  assert.equal(weeksInYear(2027), 52)
  assert.equal(weekRange(2026, 53).days[6], '2027-01-03')
  assert.throws(() => parseWeek('2025-W53', NOW), WeekParseError)
  assert.throws(() => parseWeek('2026-W00', NOW), WeekParseError)
  assert.throws(() => parseWeek('2026-W54', NOW), WeekParseError)
})

test('shifting across a year boundary', () => {
  assert.equal(shiftWeek(weekRange(2026, 53), 1).key, '2027-W01')
  assert.equal(shiftWeek(weekRange(2027, 1), -1).key, '2026-W53')
  assert.equal(shiftWeek(weekRange(2026, 1), -1).key, '2025-W52')
})

test('DST weeks: day boundaries stay on local midnight', () => {
  // Summer time ends Sun 25 Oct 2026 → week 43 is 169 hours long.
  const autumn = weekRange(2026, 43)
  assert.equal((autumn.end.getTime() - autumn.start.getTime()) / 3_600_000, 169)
  assert.equal(autumn.end.getHours(), 0)
  assert.deepEqual(autumn.days.slice(-2), ['2026-10-24', '2026-10-25'])
  assert.equal(shiftWeek(autumn, 1).start.getHours(), 0)
  // Summer time starts Sun 29 Mar 2026 → week 13 is 167 hours long.
  const spring = weekRange(2026, 13)
  assert.equal((spring.end.getTime() - spring.start.getTime()) / 3_600_000, 167)
  assert.equal(spring.end.getTime(), new Date(2026, 2, 30).getTime())
  assert.equal(parseWeek('2026-03-29', NOW).key, '2026-W13')
  assert.equal(parseWeek('2026-03-30', NOW).key, '2026-W14')
})

test('rejects things that are not weeks', () => {
  assert.throws(() => parseWeek('yesterday', NOW), WeekParseError)
  assert.throws(() => parseWeek('2026-02-30', NOW), WeekParseError)
  assert.throws(() => parseWeek('2026-13-01', NOW), WeekParseError)
  assert.throws(() => parseWeek('W45', NOW), WeekParseError)
})

test('labels', () => {
  assert.equal(weekLabel(weekRange(2026, 45)), 'Week 45 · 2–8 Nov 2026')
  assert.equal(weekLabel(weekRange(2026, 44)), 'Week 44 · 26 Oct – 1 Nov 2026')
  assert.equal(weekLabel(weekRange(2026, 1)), 'Week 1 · 29 Dec 2025 – 4 Jan 2026')
  assert.equal(dayLabel('2026-11-02'), 'Mon 2 Nov')
  assert.equal(dayLabel('2026-11-08'), 'Sun 8 Nov')
})
