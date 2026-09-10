import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { chromium, expect } from '@playwright/test'
import { Hono } from 'hono'
import { createApp } from '../server/app'
import { createEdgeTileStore, EdgeRequestGate } from '../server/edgeTileStore'
import { tileAt, tileBounds, tileKey } from '../src/tiles'

const cached = new Map<string, Response>()
const apiRequests = new Map<string, number>()
const upstreamRequests = new Map<string, number>()
const background: Promise<unknown>[] = []
const key = (request: RequestInfo | URL) =>
  request instanceof Request ? request.url : String(request)
const cache: Pick<Cache, 'match' | 'put'> = {
  match: async (request) => cached.get(key(request))?.clone(),
  put: async (request, response) => {
    cached.set(key(request), response.clone())
  },
}
const gate = new EdgeRequestGate(4, 0)
const app = new Hono()
app.use('/api/*', async (c) => {
  const requested = new URL(c.req.url)
  const requestKey = `${requested.pathname}?${requested.searchParams}`
  apiRequests.set(requestKey, (apiRequests.get(requestKey) ?? 0) + 1)
  return createApp(
    () => 'test-key',
    createEdgeTileStore({
      cache,
      origin: requested.origin,
      requestGate: gate,
      waitUntil: (promise) => {
        background.push(promise)
      },
      fetcher: async (input) => {
        const upstream = new URL(String(input))
        const tile = {
          z: Number(upstream.searchParams.get('z')),
          x: Number(upstream.searchParams.get('x')),
          y: Number(upstream.searchParams.get('y')),
        }
        const record = `${tileKey(tile)}/${upstream.searchParams.get('year')}`
        upstreamRequests.set(record, (upstreamRequests.get(record) ?? 0) + 1)
        const [west, south, east, north] = tileBounds(tile)
        return Response.json({
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [(west + east) / 2, (south + north) / 2] },
              properties: {
                point_id: tileKey(tile),
                land_price_type: 0,
                u_current_years_price_ja: '400000',
                location: '共有キャッシュ検証地点',
                use_category_name_ja: '住宅地',
              },
            },
          ],
        })
      },
    }),
  ).fetch(c.req.raw)
})
app.use('*', serveStatic({ root: './dist' }))
app.get('*', serveStatic({ path: './dist/index.html' }))
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
await once(server, 'listening')
const address = server.address()
assert.ok(address && typeof address !== 'string')
const origin = `http://127.0.0.1:${address.port}`
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const contextOptions = {
  viewport: { width: 1512, height: 982 },
  permissions: ['geolocation'],
  geolocation: { longitude: 139.7671, latitude: 35.6812 },
}
const center = tileKey(tileAt([139.7671, 35.6812]))
const apiKey = `/api/tiles/${center}?dataset=land&year=2025`
const errors: string[] = []

try {
  const firstUser = await browser.newContext(contextOptions)
  const firstPage = await firstUser.newPage()
  firstPage.on('pageerror', (error) => errors.push(error.message))
  await firstPage.goto(origin)
  await expect(firstPage.getByRole('status')).toContainText('地点を表示中', { timeout: 30_000 })
  assert.equal(apiRequests.get(apiKey), 1)
  assert.equal(upstreamRequests.get(`${center}/2025`), 1)
  await firstPage.close()

  const revisit = await firstUser.newPage()
  await revisit.goto(origin)
  await expect(revisit.getByRole('status')).toContainText('地点を表示中')
  assert.equal(apiRequests.get(apiKey), 1, 'Reopening the page should use the browser HTTP cache')

  const secondUser = await browser.newContext(contextOptions)
  const secondPage = await secondUser.newPage()
  secondPage.on('pageerror', (error) => errors.push(error.message))
  const response = secondPage.waitForResponse(
    (response) => new URL(response.url()).pathname === `/api/tiles/${center}`,
  )
  await secondPage.goto(origin)
  assert.equal((await response).headers()['x-price-cache'], 'HIT')
  await expect(secondPage.getByRole('status')).toContainText('地点を表示中')
  assert.equal(apiRequests.get(apiKey), 2, 'A separate user should contact the shared server cache')
  assert.equal(
    upstreamRequests.get(`${center}/2025`),
    1,
    'The second user must not trigger another upstream fetch',
  )
  await mkdir('tmp/screenshots', { recursive: true })
  await secondPage.screenshot({ path: 'tmp/screenshots/shared-cache-desktop.png', fullPage: true })
  await secondPage.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() =>
      secondPage.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0)
  await expect(secondPage.getByRole('status')).toHaveAttribute('data-loading', 'false')
  await secondPage.screenshot({ path: 'tmp/screenshots/shared-cache-mobile.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log(
    'PASS: browser reopening makes zero extra center-tile API requests; a separate user hits the shared cache; total upstream fetches stay at one.',
  )
} finally {
  await browser.close()
  await Promise.all(background)
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}
