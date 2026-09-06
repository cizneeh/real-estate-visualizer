import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createApp } from '../server/app'
import { createEdgeTileStore, EdgeRequestGate } from '../server/edgeTileStore'
import { UpstreamError } from '../server/tileStore'

test('the public API accepts its own origin and rejects other websites', async () => {
  const app = createApp(() => 'server-only-secret')
  const url = 'https://real-estate-visualize.echizen.me/api/health'
  const response = await app.request(url, {
    headers: { Origin: 'https://real-estate-visualize.echizen.me' },
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { configured: true })
  const foreign = await app.request(url, { headers: { Origin: 'https://other.example' } })
  assert.equal(foreign.status, 403)
})

test('separate Worker requests reuse cached empty tiles without caching credentials', async () => {
  const entries = new Map<string, Response>()
  const writes: Promise<unknown>[] = []
  const keyOf = (request: RequestInfo | URL) =>
    request instanceof Request ? request.url : String(request)
  const cache: Pick<Cache, 'match' | 'put'> = {
    match: async (request) => entries.get(keyOf(request))?.clone(),
    put: async (request, response) => {
      entries.set(keyOf(request), response)
    },
  }
  let calls = 0
  const options = {
    cache,
    origin: 'https://real-estate-visualize.echizen.me',
    waitUntil: (promise: Promise<unknown>) => writes.push(promise),
    requestGate: new EdgeRequestGate(4, 0),
    fetcher: async () => {
      calls++
      return Response.json({ type: 'FeatureCollection', features: [] })
    },
  }
  const url = 'https://www.reinfolib.mlit.go.jp/ex-api/external/XPT002?year=2025&z=13&x=7276&y=3225'
  const signal = new AbortController().signal
  const first = await createEdgeTileStore(options).get(url, 'server-only-secret', signal)
  await Promise.all(writes)
  const second = await createEdgeTileStore(options).get(url, 'server-only-secret', signal, 1)
  assert.equal(calls, 1)
  assert.deepEqual(second, first)
  assert.deepEqual(second.features, [])
  for (const [key, response] of entries) {
    assert.equal(key.includes('server-only-secret'), false)
    assert.equal((await response.clone().text()).includes('server-only-secret'), false)
    assert.match(response.headers.get('Cache-Control') ?? '', /max-age=/)
  }
})

test('edge requests overlap with bounded concurrency and start spacing', async () => {
  const gate = new EdgeRequestGate(2, 20)
  const starts: number[] = []
  let active = 0
  let maximum = 0
  await Promise.all(
    Array.from({ length: 4 }, () =>
      gate.run(
        async () => {
          starts.push(Date.now())
          maximum = Math.max(maximum, ++active)
          await delay(70)
          active--
        },
        new AbortController().signal,
        0,
      ),
    ),
  )
  assert.equal(maximum, 2)
  assert.ok(starts.every((value, index) => index === 0 || value - starts[index - 1] >= 20))
})

test('edge backoff is shared across requests and a waiting request can be cancelled', async () => {
  const gate = new EdgeRequestGate(1, 100)
  const signal = new AbortController().signal
  await assert.rejects(
    gate.run(
      async () => {
        throw new UpstreamError(429, 60)
      },
      signal,
      0,
    ),
    (error: unknown) => error instanceof UpstreamError && error.retryAfter >= 60,
  )
  await assert.rejects(
    gate.run(async () => assert.fail('Backoff must prevent an upstream request'), signal, 0),
    (error: unknown) => error instanceof UpstreamError && error.status === 429,
  )
  const otherGate = new EdgeRequestGate(1, 100)
  await otherGate.run(async () => undefined, signal, 0)
  const controller = new AbortController()
  const pending = otherGate.run(
    async () => assert.fail('Cancelled task must not start'),
    controller.signal,
    0,
  )
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})
