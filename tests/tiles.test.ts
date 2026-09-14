import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { QueryClient } from '@tanstack/react-query'
import type { Feature } from 'geojson'
import { createApp } from '../server/app'
import { HOUR } from '../server/cachePolicy'
import { createTileStore, UpstreamError } from '../server/tileStore'
import { RequestQueue } from '../src/requestQueue'
import { createTileQueries, priceTileKey } from '../src/tileQueries'
import { surroundingTiles, tileAt, tileBounds, tileKey, tilesForBounds } from '../src/tiles'
import { JAPAN_BOUNDS } from '../src/types'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const signal = () => new AbortController().signal
const tile = tileAt([135.5023, 34.6937])

test('parallel requests overlap, respect the limit, and prioritize visible work over prefetch', async () => {
  const queue = new RequestQueue(2, 0, 1)
  const gates = Array.from({ length: 4 }, () => deferred<void>())
  const started: string[] = []
  const request = (index: number, name: string, priority = 0) =>
    queue.run(
      async () => {
        started.push(name)
        await gates[index].promise
      },
      signal(),
      () => priority,
    )
  const running = [
    request(0, 'visible-1'),
    request(1, 'background-1', 1),
    request(2, 'background-2', 1),
    request(3, 'visible-2'),
  ]
  await delay(0)
  assert.deepEqual(started, ['visible-1', 'background-1'])
  gates[0].resolve()
  await delay(0)
  assert.deepEqual(started, ['visible-1', 'background-1', 'visible-2'])
  gates[3].resolve()
  await delay(0)
  assert.equal(started.length, 3)
  gates[1].resolve()
  await delay(0)
  assert.equal(started[3], 'background-2')
  gates[2].resolve()
  await Promise.all(running)
})

test('start spacing does not serialize responses and aborted queued work never starts', {
  timeout: 2000,
}, async () => {
  const queue = new RequestQueue(3, 25)
  const starts: number[] = []
  const gate = deferred<void>()
  const allStarted = deferred<void>()
  const jobs = Array.from({ length: 3 }, () =>
    queue.run(async () => {
      starts.push(Date.now())
      if (starts.length === 3) allStarted.resolve()
      await gate.promise
    }, signal()),
  )
  const abort = new AbortController()
  const cancelled = queue.run(async () => assert.fail('Cancelled job started'), abort.signal)
  const rejected = assert.rejects(cancelled, { name: 'AbortError' })
  abort.abort()
  await rejected
  await allStarted.promise
  assert.equal(starts.length, 3)
  assert.ok(starts[1] - starts[0] >= 25)
  assert.ok(starts[2] - starts[1] >= 25)
  gate.resolve()
  await Promise.all(jobs)
})

test('tile store shares in-flight work without propagating one consumer cancellation to another', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'price-tiles-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const gate = deferred<Response>()
  const started = deferred<AbortSignal>()
  let calls = 0
  const store = createTileStore({
    directory,
    interval: 0,
    fetcher: async (_url, init) => {
      calls++
      assert.ok(init?.signal)
      started.resolve(init.signal)
      return gate.promise
    },
  })
  const first = new AbortController()
  const a = store.get('https://example.test/tile', 'secret', first.signal)
  const b = store.get('https://example.test/tile', 'secret', signal())
  const upstreamSignal = await started.promise
  const rejected = assert.rejects(a, { name: 'AbortError' })
  first.abort()
  await rejected
  assert.equal(upstreamSignal.aborted, false)
  gate.resolve(Response.json({ features: [] }))
  assert.deepEqual((await b).features, [])
  await store.get('https://example.test/tile', 'secret', signal())
  assert.equal(calls, 1)
})

test('tile store cancels unused upstream work and allows a fresh request for that tile', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'price-tiles-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const started = deferred<void>()
  let calls = 0
  const store = createTileStore({
    directory,
    interval: 0,
    fetcher: async (_url, init) => {
      if (++calls > 1) return Response.json([])
      started.resolve()
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
    },
  })
  const abort = new AbortController()
  const request = store.get('https://example.test/tile', 'secret', abort.signal)
  await started.promise
  const rejected = assert.rejects(request, { name: 'AbortError' })
  abort.abort()
  await rejected
  assert.deepEqual((await store.get('https://example.test/tile', 'secret', signal())).features, [])
  assert.equal(calls, 2)
})

test('disk cache survives a new store and empty tiles expire after an hour', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'price-tiles-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let calls = 0
  const options = {
    directory,
    interval: 0,
    fetcher: async () => {
      calls++
      return Response.json([])
    },
  }
  const url = 'https://example.test/tile'
  const initial = await createTileStore(options).get(url, 'secret', signal())
  const cached = await createTileStore(options).get(url, 'secret', signal())
  assert.equal(initial.cacheStatus, 'MISS')
  assert.equal(cached.cacheStatus, 'HIT')
  assert.equal(initial.at, cached.at)
  assert.deepEqual(initial.features, cached.features)
  assert.equal(calls, 1)
  const key = createHash('sha256').update(url).digest('hex')
  await writeFile(
    join(directory, `${key}.json`),
    JSON.stringify({ at: Date.now() - HOUR - 1, features: [] }),
  )
  await createTileStore(options).get(url, 'secret', signal())
  assert.equal(calls, 2)
})

test('upstream fetches are parallel and 429 backoff blocks further misses but allows cached data', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'price-tiles-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let active = 0
  let maximum = 0
  let calls = 0
  let limited = false
  const store = createTileStore({
    directory,
    concurrency: 4,
    interval: 0,
    fetcher: async () => {
      calls++
      maximum = Math.max(maximum, ++active)
      await delay(30)
      active--
      return limited
        ? new Response('', { status: 429, headers: { 'Retry-After': '60' } })
        : Response.json([])
    },
  })
  await Promise.all(
    Array.from({ length: 7 }, (_, i) => store.get(`https://example.test/${i}`, 'secret', signal())),
  )
  assert.equal(maximum, 4)
  limited = true
  await assert.rejects(
    store.get('https://example.test/limited', 'secret', signal()),
    (error: unknown) =>
      error instanceof UpstreamError && error.status === 429 && error.retryAfter === 60,
  )
  await assert.rejects(
    store.get('https://example.test/blocked', 'secret', signal()),
    (error: unknown) => error instanceof UpstreamError && error.status === 429,
  )
  await store.get('https://example.test/0', 'secret', signal())
  assert.equal(calls, 8)
})

test('tile API returns the whole tile with stable IDs, rejects invalid tiles, and excludes adjacent tile data', async () => {
  const bounds = tileBounds(tile)
  const center = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]
  const features: Feature[] = [center, [bounds[2] + 0.00001, center[1]]].map((coordinates) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates },
    properties: { u_transaction_price_total_ja: '4,000万円', u_area_ja: '80㎡' },
  }))
  let calls = 0
  let stationCalls = 0
  const app = createApp(() => 'secret', {
    get: async (url) => {
      if (new URL(url).pathname.endsWith('/XKT015')) {
        stationCalls++
        return { at: 1000, features: [] }
      }
      calls++
      return { at: 1000, features }
    },
  })
  const path = `/api/tiles/${tileKey(tile)}?dataset=transactions&year=2025`
  const result = await (await app.request(path)).json()
  assert.equal(result.points.length, 1)
  assert.equal(result.fetchedAt, new Date(1000).toISOString())
  const again = await (await app.request(`${path}&priority=background`)).json()
  assert.deepEqual(again, result)
  for (const invalid of [
    '/api/tiles/12/1/1',
    '/api/tiles/13/8192/1',
    '/api/tiles/13/0/0',
    `/api/tiles/${tileKey(tile)}?year=1994`,
    `/api/tiles/${tileKey(tile)}?dataset=bad`,
    `/api/tiles/${tileKey(tile)}?priority=bad`,
  ]) {
    assert.equal((await app.request(invalid)).status, 400)
  }
  assert.equal(calls, 2)
  assert.equal(stationCalls, 2)
})

test('neighbor tiles form a bounded outer ring and overview requests have no tile work', () => {
  const neighbors = surroundingTiles([tile])
  assert.equal(neighbors.length, 8)
  assert.ok(neighbors.every((neighbor) => tileKey(neighbor) !== tileKey(tile)))
  const large = tilesForBounds([135.3, 34.5, 135.65, 34.85])
  assert.ok(large)
  assert.equal(surroundingTiles(large).length, 32)
  assert.equal(tilesForBounds(JAPAN_BOUNDS), undefined)
  assert.deepEqual(surroundingTiles([]), [])
})

test('TanStack Query reuses prefetched tiles, separates years, shares land/change, and preserves empty results', async () => {
  const client = new QueryClient()
  let calls = 0
  const requests = createTileQueries(async () => {
    calls++
    return Response.json({ points: [], fetchedAt: new Date().toISOString() })
  })
  try {
    await client.prefetchQuery(requests.options('land', 2025, tile))
    requests.setVisible([JSON.stringify(priceTileKey('land', 2025, tile))])
    await client.fetchQuery(requests.options('land', 2025, tile))
    await client.fetchQuery(requests.options('change', 2025, tile))
    assert.equal(calls, 1)
    await client.fetchQuery(requests.options('land', 2024, tile))
    await client.fetchQuery(requests.options('survey', 2025, tile))
    assert.equal(calls, 3)
  } finally {
    client.clear()
  }
})
