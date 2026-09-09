import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApp } from '../server/app'
import { tileAt, tileKey } from '../src/tiles'
import { LAST_YEAR } from '../src/years'

const tile = tileKey(tileAt([139.7671, 35.6812]))
const bounds = '139.766,35.68,139.768,35.682'

test('both APIs enforce each dataset’s historical coverage before contacting upstream', async () => {
  let calls = 0
  const app = createApp(() => 'test-key', {
    get: async () => {
      calls++
      return { at: 1000, features: [] }
    },
  })
  for (const [dataset, firstYear] of [
    ['land', 1995],
    ['change', 1995],
    ['survey', 1997],
    ['transactions', 2005],
  ] as const) {
    for (const path of [`/api/tiles/${tile}`, `/api/data?bounds=${bounds}`]) {
      const prefix = `${path}${path.includes('?') ? '&' : '?'}dataset=${dataset}&year=`
      for (const year of [firstYear, 2010, 2019, LAST_YEAR]) {
        const before = calls
        assert.equal((await app.request(`${prefix}${year}`)).status, 200)
        assert.ok(calls > before)
      }
      const before = calls
      for (const year of [firstYear - 1, LAST_YEAR + 1, 2005.5, 'NaN', '']) {
        assert.equal((await app.request(`${prefix}${year}`)).status, 400)
      }
      assert.equal(calls, before)
    }
  }
})

test('historical requests keep the year and classification, and start 2005 transactions in Q3', async () => {
  const requests: URL[] = []
  const app = createApp(() => 'test-key', {
    get: async (url) => {
      requests.push(new URL(url))
      return { at: 1000, features: [] }
    },
  })
  for (const dataset of ['land', 'change', 'survey', 'transactions']) {
    const year = dataset === 'survey' ? 1997 : dataset === 'transactions' ? 2005 : 1995
    for (const path of [`/api/tiles/${tile}`, `/api/data?bounds=${bounds}`]) {
      await app.request(`${path}${path.includes('?') ? '&' : '?'}dataset=${dataset}&year=${year}`)
      const url = requests.at(-1)
      assert.ok(url)
      if (dataset === 'transactions') {
        assert.ok(url.pathname.endsWith('/XPT001'))
        assert.equal(url.searchParams.get('from'), '20053')
        assert.equal(url.searchParams.get('to'), '20054')
        assert.equal(url.searchParams.get('priceClassification'), '01')
        assert.equal(url.searchParams.get('landTypeCode'), '07')
      } else {
        assert.ok(url.pathname.endsWith('/XPT002'))
        assert.equal(url.searchParams.get('year'), String(year))
        assert.equal(url.searchParams.get('priceClassification'), dataset === 'survey' ? '1' : '0')
      }
    }
  }
  await app.request(`/api/tiles/${tile}?dataset=transactions&year=2006`)
  assert.equal(requests.at(-1)?.searchParams.get('from'), '20061')
  assert.equal(requests.at(-1)?.searchParams.get('to'), '20064')
})
