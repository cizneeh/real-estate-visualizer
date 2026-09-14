import assert from 'node:assert/strict'
import { test } from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import type { Feature } from 'geojson'
import { createApp } from '../server/app'
import { normalizePoint } from '../server/data'
import { groupTransactions } from '../src/metrics'
import { createTileQueries, priceTileKey } from '../src/tileQueries'
import { tileAt, tileKey } from '../src/tiles'
import { transactionTypes } from '../src/transactions'
import type { PricePoint } from '../src/types'

const coordinates: [number, number] = [139.7671, 35.6812]
const tile = tileAt(coordinates)
const paths = [`/api/tiles/${tileKey(tile)}`, '/api/data?bounds=139.766,35.68,139.768,35.682']
const feature = (properties: Record<string, unknown>): Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates },
  properties,
})

test('both APIs request exactly the selected transaction type and keep the old default', async () => {
  const upstream: URL[] = []
  const app = createApp(() => 'test-key', {
    get: async (url) => {
      upstream.push(new URL(url))
      return {
        at: Date.now(),
        features: [feature({ u_transaction_price_total_ja: '6,000万円', u_area_ja: '200㎡' })],
      }
    },
  })
  for (const path of paths) {
    const prefix = `${path}${path.includes('?') ? '&' : '?'}dataset=transactions&year=2005`
    for (const [type, code, category] of [
      ['condominium', '07', '中古マンション等'],
      ['land', '01', '宅地（土地）'],
      ['land-building', '02', '宅地（土地と建物）'],
    ]) {
      const response = await app.request(`${prefix}&transactionType=${type}`)
      assert.equal(response.status, 200)
      const body = await response.json()
      assert.equal(body.points.length, 1)
      assert.equal(body.points[0].transactionType, type)
      assert.equal(body.points[0].category, category)
      assert.equal(body.points[0].price, 300_000)
      const url = upstream.at(-1)
      assert.ok(url)
      assert.ok(url.pathname.endsWith('/XPT001'))
      assert.equal(url.searchParams.get('landTypeCode'), code)
      assert.equal(url.searchParams.get('priceClassification'), '01')
      assert.equal(url.searchParams.get('from'), '20053')
      assert.equal(url.searchParams.get('to'), '20054')
    }
    assert.equal((await app.request(prefix)).status, 200)
    assert.equal(upstream.at(-1)?.searchParams.get('landTypeCode'), '07')
    const calls = upstream.length
    for (const invalid of ['', 'unknown', '01,02', '__proto__', 'toString']) {
      assert.equal((await app.request(`${prefix}&transactionType=${invalid}`)).status, 400)
    }
    assert.equal(upstream.length, calls)
  }
})

test('transaction unit prices use reported values or positive exact total/area, preserving the type', () => {
  for (const type of transactionTypes) {
    const point = normalizePoint(
      feature({
        u_transaction_price_total_ja: '6,000万円',
        u_area_ja: '200㎡',
        u_transaction_price_unit_price_square_meter_ja: '310,000円/㎡',
      }),
      'transactions',
      0,
      type,
    )
    assert.equal(point?.price, 310_000)
    assert.equal(point?.transactionType, type)
    assert.equal(
      normalizePoint(
        feature({ u_transaction_price_total_ja: '6,000万円', u_area_ja: '200㎡' }),
        'transactions',
        0,
        type,
      )?.price,
      300_000,
    )
    for (const properties of [
      { u_area_ja: '200㎡以上', u_transaction_price_total_ja: '6,000万円' },
      { u_area_ja: '200㎡', u_transaction_price_total_ja: '6,000万円以上' },
      { u_area_ja: '-200㎡', u_transaction_price_total_ja: '-6,000万円' },
      { u_area_ja: '200㎡', u_transaction_price_total_ja: '-6,000万円' },
      { u_transaction_price_unit_price_square_meter_ja: '-30万円' },
      { u_area_ja: '0㎡', u_transaction_price_total_ja: '6,000万円' },
      { u_area_ja: '200㎡', u_transaction_price_total_ja: '—' },
    ]) {
      assert.equal(normalizePoint(feature(properties), 'transactions', 0, type), undefined)
    }
    assert.equal(
      normalizePoint(
        feature({
          u_area_ja: '200㎡以上',
          u_transaction_price_unit_price_square_meter_ja: '30万円',
        }),
        'transactions',
        0,
        type,
      )?.price,
      300_000,
    )
  }
})

test('the same station never combines different transaction types into one median', () => {
  const points = transactionTypes.flatMap((transactionType, i) =>
    [100_000, 300_000, 8_000_000].map(
      (price, j): PricePoint => ({
        id: `${i}-${j}`,
        transactionType,
        coordinates,
        price: price * (i + 1),
        address: '丸の内',
        municipality: '千代田区',
        category: '取引',
      }),
    ),
  )
  const grouped = groupTransactions(points)
  assert.equal(grouped.length, 3)
  assert.equal(new Set(grouped.map((point) => point.id)).size, 3)
  assert.deepEqual(
    grouped.map((point) => point.price),
    [300_000, 600_000, 900_000],
  )
  assert.ok(grouped.every((point) => point.count === 3))
})

test('prefetch and cache reuse stay within each type and year; land valuation keys remain shared', async () => {
  const client = new QueryClient()
  const calls: URL[] = []
  const requests = createTileQueries(async (input) => {
    const url = new URL(String(input), 'http://localhost')
    calls.push(url)
    return Response.json({ points: [], fetchedAt: new Date().toISOString() })
  })
  try {
    for (const type of transactionTypes) {
      await client.prefetchQuery(requests.options('transactions', 2025, tile, type))
    }
    assert.deepEqual(
      calls.map((url) => url.searchParams.get('transactionType')),
      [null, 'land', 'land-building'],
    )
    for (const type of transactionTypes) {
      requests.setVisible([JSON.stringify(priceTileKey('transactions', 2025, tile, type))])
      await client.fetchQuery(requests.options('transactions', 2025, tile, type))
    }
    assert.equal(calls.length, 3)
    await client.fetchQuery(requests.options('transactions', 2024, tile, 'land'))
    assert.equal(calls.length, 4)
    assert.deepEqual(
      priceTileKey('land', 2025, tile, 'land'),
      priceTileKey('change', 2025, tile, 'condominium'),
    )
    assert.deepEqual(
      priceTileKey('transactions', 2025, tile),
      priceTileKey('transactions', 2025, tile, 'condominium'),
    )
  } finally {
    client.clear()
  }
})
