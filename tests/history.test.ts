import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApp } from '../server/app'
import { normalizePoint } from '../server/data'
import { historySegments, historyYears, matchHistoryPoint, periodLabel } from '../src/history'
import { columnHeight } from '../src/metrics'
import { tileAt, tileKey } from '../src/tiles'
import type { PricePoint } from '../src/types'

const anchor: PricePoint = {
  id: '0-1',
  historyId: '0-1',
  location: '東京都千代田区１番',
  coordinates: [139.76, 35.68],
  price: 100_000,
  address: '東京都千代田区１番',
  municipality: '千代田区',
  category: '住宅地',
}

test('history spans five elapsed years, includes pre-2020 prices, and respects dataset coverage', () => {
  assert.deepEqual(historyYears('land', 2023, 5), [2018, 2019, 2020, 2021, 2022, 2023])
  assert.deepEqual(historyYears('land', 1997, 5), [1995, 1996, 1997])
  assert.deepEqual(historyYears('survey', 1999, 'all'), [1997, 1998, 1999])
  assert.equal(historyYears('land', 2023, 10)[0], 2013)
  assert.equal(periodLabel('land', 'change', 2023), '2022年1月1日 → 2023年1月1日')
  assert.equal(periodLabel('survey', 'change', 2023), '2022年7月1日 → 2023年7月1日')
  assert.equal(periodLabel('transactions', 'price', 2023), '2023年1〜12月の取引')
  assert.equal(periodLabel('transactions', 'price', 2005), '2005年7〜12月の取引')
})

test('history requires a durable ID, cadastral location, and proximity, never an index or nearby address alone', () => {
  assert.equal(matchHistoryPoint(anchor, [{ ...anchor, price: 90_000 }])?.price, 90_000)
  assert.ok(matchHistoryPoint(anchor, [{ ...anchor, location: '東京都千代田区1番' }]))
  assert.equal(matchHistoryPoint(anchor, [{ ...anchor, historyId: '0-2' }]), undefined)
  assert.equal(
    matchHistoryPoint(anchor, [{ ...anchor, location: '東京都千代田区２番' }]),
    undefined,
  )
  assert.equal(matchHistoryPoint(anchor, [{ ...anchor, coordinates: [139.8, 35.68] }]), undefined)
  assert.equal(matchHistoryPoint({ ...anchor, historyId: undefined }, [anchor]), undefined)
  assert.equal(matchHistoryPoint({ ...anchor, location: undefined }, [anchor]), undefined)
  const point = normalizePoint(
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: anchor.coordinates },
      properties: { u_current_years_price_ja: '100,000', land_price_type: 0 },
    },
    'land',
    1,
  )
  assert.equal(point?.historyId, undefined)
})

test('missing, failed, and replaced observations break the line, while zero annual change is retained', () => {
  const entries = [
    { year: 2018, status: 'ready' as const, point: anchor },
    { year: 2019, status: 'missing' as const },
    { year: 2020, status: 'ready' as const, point: { ...anchor, change: 0 } },
    { year: 2021, status: 'ready' as const, point: anchor },
    { year: 2022, status: 'error' as const },
    { year: 2023, status: 'changed' as const },
    { year: 2024, status: 'ready' as const, point: anchor },
  ]
  assert.deepEqual(
    historySegments(entries).map((segment) => segment.map((entry) => entry.year)),
    [[2018], [2020, 2021], [2024]],
  )
  assert.equal(entries[2].point?.change, 0)
  assert.notEqual(columnHeight({ ...anchor, change: -5 }, 'change'), columnHeight(anchor, 'price'))
})

test('the tile API allows historical coverage per dataset and rejects future or unsupported years', async () => {
  const requests: string[] = []
  const app = createApp(() => 'test-key', {
    get: async (url: string) => {
      requests.push(url)
      return { at: Date.now(), features: [] }
    },
  })
  const path = `/api/tiles/${tileKey(tileAt(anchor.coordinates))}`
  for (const [dataset, first] of [
    ['land', 1995],
    ['survey', 1997],
    ['transactions', 2005],
  ] as const) {
    assert.equal((await app.request(`${path}?dataset=${dataset}&year=${first}`)).status, 200)
    assert.equal((await app.request(`${path}?dataset=${dataset}&year=${first - 1}`)).status, 400)
    assert.equal(
      (await app.request(`${path}?dataset=${dataset}&year=${new Date().getFullYear() + 1}`)).status,
      400,
    )
  }
  assert.equal(requests.length, 3)
  assert.equal(new URL(requests[0]).searchParams.get('year'), '1995')
  assert.equal(new URL(requests[1]).searchParams.get('priceClassification'), '1')
})
