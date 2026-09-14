import assert from 'node:assert/strict'
import { test } from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import { displayPeriodLabel, matchLandHistoryPoint } from '../src/history'
import { datasetsForYear, mergeLandPoints, normalizeLocation } from '../src/landPrices'
import { createTileQueries } from '../src/tileQueries'
import { tileAt } from '../src/tiles'
import type { PricePoint } from '../src/types'

const january: PricePoint = {
  id: '0-123',
  historyId: '0-123',
  source: 'land',
  location: '東京都千代田区１番２',
  address: '東京都千代田区１番２',
  municipality: '千代田区',
  coordinates: [139.76, 35.68],
  category: '住宅地',
  area: 200,
  price: 100_000,
  change: 3,
  previousPrice: 97_000,
}
const july: PricePoint = {
  ...january,
  id: '1-456',
  historyId: '1-456',
  source: 'survey',
  location: '東京都千代田区1番2',
  coordinates: [139.7601, 35.68],
  price: 110_000,
  change: 2,
  previousPrice: 107_000,
}

test('the same site retains July price and its own annual comparison regardless of response order', () => {
  assert.deepEqual(mergeLandPoints([january, july]), [july])
  assert.deepEqual(mergeLandPoints([july, january, july]), [july])
  assert.deepEqual(mergeLandPoints([january]), [january])
  assert.deepEqual(mergeLandPoints([july]), [july])
})

test('official cadastral locations match kanji chome numbers without rewriting place names', () => {
  assert.equal(
    normalizeLocation('東京都千代田区丸の内三丁目２番外'),
    '東京都千代田区丸の内3丁目2番外',
  )
  assert.equal(normalizeLocation('札幌市北区北二十一条西十一丁目'), '札幌市北区北二十一条西11丁目')
  assert.equal(normalizeLocation('八王子市十二丁目'), '八王子市12丁目')
  assert.equal(normalizeLocation('一宮市三条１番'), '一宮市三条1番')
  assert.equal(
    mergeLandPoints([
      { ...january, location: '東京都千代田区丸の内３丁目２番外' },
      { ...july, location: '東京都千代田区丸の内三丁目２番外' },
    ]).length,
    1,
  )
})

test('different, ambiguous, and unidentifiable sites remain separate even at identical coordinates', () => {
  for (const other of [
    { ...july, location: '東京都千代田区1番3' },
    { ...july, area: 201 },
    { ...july, category: '商業地' },
    { ...july, location: undefined },
    { ...july, area: undefined },
    { ...july, coordinates: [139.77, 35.68] as [number, number] },
    { ...july, source: 'land' as const },
  ]) {
    assert.equal(mergeLandPoints([january, other]).length, 2)
  }
  assert.equal(mergeLandPoints([january, july, { ...july, id: '1-789' }]).length, 3)
})

test('annual history follows a common site when the available source changes, without matching a neighbor', () => {
  assert.equal(matchLandHistoryPoint(january, [january, july]), july)
  assert.equal(matchLandHistoryPoint(july, [january]), january)
  assert.equal(matchLandHistoryPoint(july, []), undefined)
  assert.equal(
    matchLandHistoryPoint(january, [{ ...july, location: '東京都千代田区1番3' }]),
    undefined,
  )
  assert.equal(matchLandHistoryPoint(january, [{ ...january, historyId: '0-replaced' }]), undefined)
  assert.equal(matchLandHistoryPoint(january, [july, { ...july, id: '1-789' }]), undefined)
})

test('source requests respect historical coverage and the UI does not claim all prices have the same date', () => {
  assert.deepEqual(datasetsForYear('land', 1995), ['land'])
  assert.deepEqual(datasetsForYear('land', 1996), ['land'])
  assert.deepEqual(datasetsForYear('land', 1997), ['land', 'survey'])
  assert.deepEqual(datasetsForYear('transactions', 2025), ['transactions'])
  assert.equal(displayPeriodLabel('land', 'price', 1995), '1995年1月1日時点')
  assert.equal(displayPeriodLabel('land', 'price', 2025), '2025年の公開価格（1月・7月時点）')
  assert.equal(
    displayPeriodLabel('land', 'change', 2025),
    '2024年 → 2025年（同じ調査の前年と比較）',
  )
})

test('source metadata is attached to cached points without depending on source-specific ID formats', async () => {
  const client = new QueryClient()
  const requests = createTileQueries(async () =>
    Response.json({ points: [{ ...july, source: undefined }], fetchedAt: '2025-09-01' }),
  )
  try {
    const response = await client.fetchQuery(
      requests.options('survey', 2025, tileAt(july.coordinates)),
    )
    assert.equal(response.points[0].source, 'survey')
  } finally {
    client.clear()
  }
})
