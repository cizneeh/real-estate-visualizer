import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HistoryEntry } from '../src/history'
import { historyLineReveals } from '../src/historyAnimation'

const ready = (year: number): HistoryEntry => ({
  year,
  status: 'ready',
  point: {
    id: 'test-point',
    coordinates: [139.7671, 35.6812],
    price: 100_000,
    address: '東京都千代田区',
    municipality: '千代田区',
    category: '住宅地',
  },
})

test('new years grow away from the existing plot in either direction', () => {
  const entries = [ready(2024), ready(2025), ready(2026)]
  const older = historyLineReveals(entries, new Set([2026]))
  assert.deepEqual(
    older.map(({ startYear, reverse }) => [startYear, reverse]),
    [
      [2025, true],
      [2024, true],
    ],
  )
  assert.equal(older[1].delay, older[0].duration)
  const newer = historyLineReveals(entries, new Set([2024]))
  assert.deepEqual(
    newer.map(({ startYear, reverse }) => [startYear, reverse]),
    [
      [2024, false],
      [2025, false],
    ],
  )
  assert.equal(newer[1].delay, newer[0].duration)
})

test('a filled year connects from both existing neighbors without replaying existing lines', () => {
  const reveals = historyLineReveals(
    [2022, 2023, 2024, 2025, 2026].map(ready),
    new Set([2022, 2023, 2025, 2026]),
  )
  assert.deepEqual(
    reveals.map(({ startYear, reverse, delay }) => [startYear, reverse, delay]),
    [
      [2023, false, 0],
      [2024, true, 0],
    ],
  )
})

test('loading, missing, failed and changed years never acquire connecting lines', () => {
  for (const status of ['loading', 'missing', 'error', 'changed'] as const) {
    assert.deepEqual(
      historyLineReveals([ready(2024), { year: 2025, status }, ready(2026)], new Set([2026])),
      [],
    )
  }
  assert.deepEqual(historyLineReveals([ready(2024), ready(2026)], new Set([2026])), [])
})

test('cached data stays immediate, while an isolated newly fetched segment can draw on its own', () => {
  assert.deepEqual(
    historyLineReveals([2024, 2025, 2026].map(ready), new Set([2024, 2025, 2026])),
    [],
  )
  const reveals = historyLineReveals(
    [ready(2021), ready(2022), { year: 2023, status: 'missing' }, ready(2024)],
    new Set([2024]),
  )
  assert.equal(reveals.length, 1)
  assert.equal(reveals[0].startYear, 2021)
  assert.equal(reveals[0].endYear, 2022)
  assert.equal(reveals[0].reverse, false)
})

test('a large batch finishes within one short reveal instead of making users wait per year', () => {
  const reveals = historyLineReveals(
    Array.from({ length: 31 }, (_, i) => ready(1995 + i)),
    new Set([2025]),
  )
  assert.equal(reveals.length, 30)
  assert.ok(reveals.every(({ duration, delay }) => duration > 0 && delay + duration <= 300))
})
