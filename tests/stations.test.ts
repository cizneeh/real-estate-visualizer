import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Feature, Geometry } from 'geojson'
import { createApp } from '../server/app'
import { DAY } from '../server/cachePolicy'
import { normalizePoint } from '../server/data'
import { stationNameAt } from '../server/stations'
import { groupTransactions, stationAreaLabel } from '../src/metrics'
import { tileAt, tileKey } from '../src/tiles'

const coordinates: [number, number] = [139.44617986679077, 35.69923323720904]
const station = (name: string, geometry: Geometry): Feature => ({
  type: 'Feature',
  geometry,
  properties: { S12_001_ja: name },
})
const kunitachi = station('国立', {
  type: 'LineString',
  coordinates: [
    [139.44772481918335, 35.69923323720904],
    [139.44509625434875, 35.6991635348201],
  ],
})
const transaction: Feature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates },
  properties: {
    city_name_ja: '国立市',
    land_type_name_ja: '中古マンション等',
    u_transaction_price_total_ja: '4,000万円',
    u_area_ja: '80㎡',
  },
}

test('station matching uses platform segments and merges duplicate names across lines', () => {
  assert.equal(stationNameAt(coordinates, [kunitachi, kunitachi]), '国立')
  assert.equal(
    stationNameAt(coordinates, [
      station(' 国立駅 ', {
        type: 'MultiLineString',
        coordinates: [
          [coordinates, coordinates],
          [
            [140, 36],
            [140.01, 36],
          ],
        ],
      }),
    ]),
    '国立',
  )
  assert.equal(stationNameAt(coordinates, [station('', kunitachi.geometry)]), undefined)
  assert.equal(stationNameAt([140, 36], [kunitachi]), undefined)
  assert.equal(
    stationNameAt(coordinates, [kunitachi, station('別の駅', kunitachi.geometry)]),
    undefined,
  )
  assert.equal(stationAreaLabel('国立'), '国立駅周辺')
  assert.equal(stationAreaLabel(' 国立駅 '), '国立駅周辺')
  assert.equal(stationAreaLabel(), '駅周辺（駅名不明）')
})

test('the transaction API resolves the station and preserves mixed municipalities and prices', async () => {
  const calls: URL[] = []
  const app = createApp(() => 'test-key', {
    get: async (url) => {
      const source = new URL(url)
      calls.push(source)
      return {
        at: Date.now(),
        features: source.pathname.endsWith('/XKT015')
          ? [kunitachi]
          : [
              transaction,
              {
                ...transaction,
                properties: {
                  ...transaction.properties,
                  city_name_ja: '国分寺市',
                  u_transaction_price_total_ja: '6,000万円',
                },
              },
            ],
      }
    },
  })
  const response = await app.request(
    `/api/tiles/${tileKey(tileAt(coordinates))}?dataset=transactions&year=2025`,
  )
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(calls.length, 2)
  assert.equal(calls[0].searchParams.get('priceClassification'), '01')
  assert.equal(calls[0].searchParams.get('landTypeCode'), '07')
  assert.equal(calls[1].pathname.endsWith('/XKT015'), true)
  assert.equal(calls[1].searchParams.has('year'), false)
  assert.equal(calls[1].searchParams.has('from'), false)
  assert.equal(data.points.length, 2)
  const [group] = groupTransactions(data.points)
  assert.equal(group.address, '国立駅周辺')
  assert.equal(group.station, '国立')
  assert.equal(group.municipality, '国分寺市・国立市')
  assert.equal(group.count, 2)
  assert.equal(group.price, 625_000)
})

test('missing station data does not lose prices or assign a municipality as a station name', async () => {
  const app = createApp(() => 'test-key', {
    get: async (url) => {
      if (new URL(url).pathname.endsWith('/XKT015')) throw new Error('Station API unavailable')
      return { at: Date.now(), features: [transaction] }
    },
  })
  const response = await app.request(
    `/api/tiles/${tileKey(tileAt(coordinates))}?dataset=transactions&year=2025`,
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  const [group] = groupTransactions((await response.json()).points)
  assert.equal(group.price, 500_000)
  assert.equal(group.count, 1)
  assert.equal(group.address, '駅周辺（駅名不明）')
  assert.equal(group.station, undefined)
  assert.equal(normalizePoint(transaction, 'transactions', 0)?.price, group.price)
})

test('empty transaction tiles and land prices do not request station data', async () => {
  const calls: string[] = []
  const app = createApp(() => 'test-key', {
    get: async (url) => {
      calls.push(url)
      return { at: Date.now(), features: [] }
    },
  })
  for (const dataset of ['transactions', 'land']) {
    const response = await app.request(
      `/api/tiles/${tileKey(tileAt(coordinates))}?dataset=${dataset}&year=2025`,
    )
    assert.equal(response.status, 200)
  }
  assert.equal(calls.length, 2)
  assert.ok(calls.every((url) => !url.includes('XKT015')))
})

test('HTTP caching never outlives the station data freshness', async () => {
  const app = createApp(() => 'test-key', {
    get: async (url) => {
      const stations = url.includes('XKT015')
      return {
        at: Date.now() - (stations ? DAY - 30_000 : 0),
        features: stations ? [kunitachi] : [transaction],
      }
    },
  })
  const response = await app.request(
    `/api/tiles/${tileKey(tileAt(coordinates))}?dataset=transactions&year=2025`,
  )
  const maxAge = Number(response.headers.get('Cache-Control')?.split('max-age=')[1])
  assert.ok(maxAge > 0 && maxAge <= 30)
})
