import assert from 'node:assert/strict'
import { test } from 'node:test'
import { colorFor, MISSING_CHANGE_COLOR, transactionStationId } from '../src/metrics'
import {
  summarizeTransactions,
  transactionComparisonLabel,
  transactionQuarter,
} from '../src/transactionComparison'
import type { PricePoint } from '../src/types'

function trades(year: number, price = 100_000, count = 5, quarter = 2): PricePoint[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${year}-${quarter}-${i}`,
    transactionType: 'land',
    coordinates: [139.76, 35.68],
    price,
    address: '丸の内',
    municipality: '千代田区',
    category: '宅地（土地）',
    period: `${year}年第${quarter}四半期`,
  }))
}

test('compares medians through the latest observed quarter, excluding later quarters of the previous year', () => {
  const current = trades(2025, 120_000)
  const previous = [...trades(2024), ...trades(2024, 9_000_000, 8, 4)]
  const result = summarizeTransactions(current, previous, 2025, 'ready')
  const summary = result.summaries.get(transactionStationId(current[0]))
  assert.ok(summary)
  assert.equal(summary.currentMedian, 120_000)
  assert.equal(summary.previousMedian, 100_000)
  assert.equal(summary.previous.length, 5)
  assert.equal(summary.status, 'ready')
  assert.ok(Math.abs((summary.change ?? 0) - 20) < 1e-10)
  assert.equal(result.points[0].change, summary.change)
  assert.equal(transactionComparisonLabel(result.period), '2025年1〜6月 / 2024年1〜6月')
  assert.deepEqual(summary.records, current)
})

test('compares each station and property type separately; missing and low counts are not zero change', () => {
  const current = [
    ...trades(2025, 120_000),
    ...trades(2025, 200_000).map((point) => ({
      ...point,
      transactionType: 'condominium' as const,
    })),
    ...trades(2025, 300_000, 4).map((point) => ({
      ...point,
      coordinates: [139.77, 35.68] as [number, number],
    })),
  ]
  const result = summarizeTransactions(current, trades(2024), 2025, 'ready')
  assert.equal(result.points.length, 3)
  assert.equal(result.points.filter((point) => point.change !== undefined).length, 1)
  assert.deepEqual(
    [...result.summaries.values()].map((item) => item.status),
    ['ready', 'insufficient', 'insufficient'],
  )
  assert.equal(colorFor(result.points[1], 'change'), MISSING_CHANGE_COLOR)
  const insufficientPrevious = summarizeTransactions(
    trades(2025),
    trades(2024, 100_000, 4),
    2025,
    'ready',
  )
  assert.equal(insufficientPrevious.points[0].change, undefined)
})

test('the same quarter window applies to stations with no trades in its final quarter', () => {
  const other = trades(2025, 100_000, 1, 4).map((point) => ({
    ...point,
    coordinates: [139.77, 35.68] as [number, number],
  }))
  const result = summarizeTransactions(
    [...trades(2025), ...other],
    [...trades(2024), ...trades(2024, 200_000, 8, 4)],
    2025,
    'ready',
  )
  const summary = result.summaries.get(transactionStationId(result.points[0]))
  assert.equal(result.period?.endQuarter, 4)
  assert.equal(summary?.previous.length, 13)
  assert.equal(summary?.change, -50)
})

test('zero and negative changes are valid, and annual price stays separate from comparison price', () => {
  assert.equal(summarizeTransactions(trades(2025), trades(2024), 2025, 'ready').points[0].change, 0)
  const falling = summarizeTransactions(trades(2025, 80_000), trades(2024), 2025, 'ready')
  assert.ok(Math.abs((falling.points[0].change ?? 0) + 20) < 1e-10)
  const current = [...trades(2006, 900_000, 8, 1), ...trades(2006, 100_000, 5, 4)]
  const result = summarizeTransactions(current, trades(2005, 100_000, 5, 4), 2006, 'ready')
  assert.equal(result.points[0].price, 900_000)
  assert.equal(result.points[0].count, 13)
  assert.equal(result.points[0].change, 0)
  assert.equal([...result.summaries.values()][0].current.length, 5)
  assert.equal(transactionComparisonLabel(result.period), '2006年7〜12月 / 2005年7〜12月')
})

test('the first year cannot compare to pre-release data; absent current year never creates a point', () => {
  const earliest = summarizeTransactions(trades(2005, 100_000, 5, 4), [], 2005, 'ready')
  assert.equal([...earliest.summaries.values()][0].status, 'earliest')
  assert.equal(earliest.points[0].change, undefined)
  assert.equal(summarizeTransactions([], trades(2024), 2025, 'ready').points.length, 0)
  assert.equal(
    summarizeTransactions(trades(2006), trades(2005, 100_000, 5, 4), 2006, 'ready').period,
    undefined,
  )
})

test('pending or partial failures suppress comparisons even with enough cached data', () => {
  for (const status of ['loading', 'error'] as const) {
    const result = summarizeTransactions(trades(2025), trades(2024), 2025, status)
    assert.equal(result.points[0].change, undefined)
    assert.equal(result.period, undefined)
    assert.equal([...result.summaries.values()][0].status, status)
  }
})

test('unknown periods stay in the records and price, but cannot create a comparison', () => {
  const current = trades(2025).map((point) => ({ ...point, period: undefined }))
  const result = summarizeTransactions(current, trades(2024), 2025, 'ready')
  const summary = [...result.summaries.values()][0]
  assert.equal(summary.status, 'no-period')
  assert.equal(summary.records.length, 5)
  assert.equal(summary.excludedCount, 5)
  assert.equal(result.points[0].price, 100_000)
  const mixed = summarizeTransactions([...trades(2025), ...current], trades(2024), 2025, 'ready')
  assert.equal([...mixed.summaries.values()][0].current.length, 5)
  for (const period of ['2024年第2四半期', '2025年第5四半期', '不明', '2025年']) {
    assert.equal(transactionQuarter({ ...current[0], period }, 2025), undefined)
  }
  assert.equal(transactionQuarter({ ...current[0], period: '２０２５年 第２四半期' }, 2025), 2)
})
