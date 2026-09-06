import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Feature } from 'geojson'
import { createApp } from '../server/app'
import { clipBounds, normalizePoint, numberValue, tilesForBounds, yenValue } from '../server/data'
import { columnCollection, groupTransactions, median } from '../src/metrics'
import { type PricePoint, STUDY_BOUNDS } from '../src/types'

const feature = (properties: Record<string, unknown>): Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [139.48, 35.7] },
  properties,
})

test('Japanese numeric units are normalized without turning missing or censored values into zero', () => {
  assert.equal(yenValue('1億2,500万円'), 125_000_000)
  assert.equal(yenValue('４，０００万円'), 40_000_000)
  assert.equal(numberValue('3,100,000(円/㎡)'), 3_100_000)
  assert.equal(numberValue('-2.5'), -2.5)
  for (const value of ['', undefined, '—', '2,000㎡以上', '50㎡未満', Number.NaN]) {
    assert.equal(numberValue(value), undefined)
  }
})

test('land points preserve zero change and the reported units', () => {
  const point = normalizePoint(
    feature({
      point_id: 1,
      land_price_type: 0,
      u_current_years_price_ja: '450,000(円/㎡)',
      year_on_year_change_rate: '0.0',
      last_years_price: 450000,
      use_category_name_ja: '1,住宅地',
      u_cadastral_ja: '150(㎡)',
      residence_display_name_ja: '本町１丁目',
      ward_town_village_name_ja: '国分寺市',
    }),
    'land',
    0,
  )
  assert.equal(point?.price, 450_000)
  assert.equal(point?.change, 0)
  assert.equal(point?.category, '住宅地')
  assert.equal(point?.area, 150)
  assert.equal(normalizePoint(feature({ u_current_years_price_ja: '0' }), 'land', 0), undefined)
})

test('condominium unit prices divide total yen by uncensored area', () => {
  const point = normalizePoint(
    feature({ u_transaction_price_total_ja: '4,000万円', u_area_ja: '80㎡' }),
    'transactions',
    0,
  )
  assert.equal(point?.price, 500_000)
  assert.equal(point?.totalPrice, 40_000_000)
  assert.equal(
    normalizePoint(
      feature({ u_transaction_price_total_ja: '4,000万円', u_area_ja: '80㎡以上' }),
      'transactions',
      0,
    ),
    undefined,
  )
})

test('transaction groups use a median and keep the actual sample count', () => {
  const points = [100_000, 200_000, 9_000_000].map(
    (price, i): PricePoint => ({
      id: String(i),
      coordinates: [139.48, 35.7],
      price,
      address: '本町',
      municipality: '国分寺市',
      category: '中古マンション等',
    }),
  )
  const grouped = groupTransactions(points)
  assert.equal(grouped.length, 1)
  assert.equal(grouped[0].price, 200_000)
  assert.equal(grouped[0].count, 3)
  assert.equal(median([10, 20]), 15)
  assert.equal(median([]), undefined)
  const polygon = columnCollection(grouped, 'transactions').features[0].geometry.coordinates[0]
  assert.deepEqual(polygon[0], polygon[polygon.length - 1])
})

test('requests are bounded to Tokyo including Kokubunji and Tachikawa', () => {
  assert.deepEqual(clipBounds([0, 0, 180, 85]), STUDY_BOUNDS)
  assert.equal(clipBounds([130, 30, 131, 31]), undefined)
  const tiles = tilesForBounds([139.4, 35.68, 139.5, 35.72], 13)
  assert.ok(tiles.length > 0 && tiles.length < 20)
  assert.ok(tiles.every((tile) => tile.x >= 0 && tile.x < 8192 && tile.y >= 0 && tile.y < 8192))
})

test('the API validates inputs, rejects foreign origins, and never returns the server credential', async () => {
  const app = createApp(() => 'test-credential-only')
  const health = await app.request('/api/health')
  assert.deepEqual(await health.json(), { configured: true })
  for (const query of [
    'dataset=unknown',
    'year=1990',
    'bounds=nan,35,140,36',
    'bounds=140,35,139,36',
  ]) {
    const response = await app.request(`/api/data?${query}`)
    assert.equal(response.status, 400)
    assert.equal((await response.text()).includes('test-credential-only'), false)
  }
  const foreign = await app.request('/api/health', { headers: { Origin: 'https://example.com' } })
  assert.equal(foreign.status, 403)
  const noKey = createApp(() => undefined)
  assert.equal((await noKey.request('/api/data?bounds=139.4,35.6,139.5,35.7')).status, 503)
})
