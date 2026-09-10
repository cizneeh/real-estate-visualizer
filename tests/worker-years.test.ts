import assert from 'node:assert/strict'
import { test } from 'node:test'

test('both APIs validate years at request time after Workers epoch-time initialization', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 })
  const { createApp } = await import('../server/app')
  let calls = 0
  const app = createApp(() => 'test-key', {
    get: async () => {
      calls++
      return { at: Date.now(), features: [] }
    },
  })

  for (const currentYear of [2026, 2027]) {
    t.mock.timers.setTime(Date.UTC(currentYear, 6, 1))
    for (const [dataset, firstYear] of [
      ['land', 1995],
      ['change', 1995],
      ['survey', 1997],
      ['transactions', 2005],
    ] as const) {
      for (const path of [
        '/api/tiles/13/7276/3225',
        '/api/data?bounds=139.766,35.68,139.768,35.682',
      ]) {
        const prefix = `${path}${path.includes('?') ? '&' : '?'}dataset=${dataset}&year=`
        for (const year of [firstYear, 2025, currentYear]) {
          const before = calls
          const response = await app.request(`${prefix}${year}`)
          assert.equal(response.status, 200, `${prefix}${year}`)
          assert.ok(calls > before)
        }
        const before = calls
        for (const year of [firstYear - 1, currentYear + 1, 2025.5, 'NaN', '']) {
          const response = await app.request(`${prefix}${year}`)
          assert.equal(response.status, 400, `${prefix}${year}`)
        }
        assert.equal(calls, before)
      }
    }
  }
})
