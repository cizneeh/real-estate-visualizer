import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import type { Feature } from 'geojson'
import { createApp } from '../server/app'
import { browserCacheControl, cachePolicy, cacheState, DAY, HOUR } from '../server/cachePolicy'
import { createEdgeTileStore, EdgeRequestGate } from '../server/edgeTileStore'
import { createTileStore, UpstreamError } from '../server/tileStore'
import { createTileQueries } from '../src/tileQueries'
import { tileAt, tileKey } from '../src/tiles'

const at = Date.UTC(2026, 8, 10)
const tile = tileAt([139.7671, 35.6812])
const url = 'https://www.reinfolib.mlit.go.jp/ex-api/external/XPT002?year=2024&z=13&x=7276&y=3225'
const features: Feature[] = [
  {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [139.7671, 35.6812] },
    properties: { land_price_type: 0, point_id: 123, u_current_years_price_ja: '100000' },
  },
]
const signal = () => new AbortController().signal

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

function edgeHarness(fetcher: typeof fetch) {
  let time = at
  const records = new Map<string, { response: Response; expires: number }>()
  const jobs: Promise<unknown>[] = []
  const key = (request: RequestInfo | URL) =>
    request instanceof Request ? request.url : String(request)
  const cache: Pick<Cache, 'match' | 'put'> = {
    match: async (request) => {
      const saved = records.get(key(request))
      return saved && saved.expires > time ? saved.response.clone() : undefined
    },
    put: async (request, response) => {
      const seconds = Number(response.headers.get('Cache-Control')?.match(/max-age=(\d+)/)?.[1])
      records.set(key(request), { response: response.clone(), expires: time + seconds * 1000 })
    },
  }
  const options = {
    cache,
    fetcher,
    now: () => time,
    refreshes: new Map<string, number>(),
    origin: 'https://prices.example',
    requestGate: new EdgeRequestGate(4, 0),
    waitUntil: (promise: Promise<unknown>) => {
      jobs.push(promise)
    },
  }
  return {
    request: (requestSignal = signal()) =>
      createEdgeTileStore(options).get(url, 'secret', requestSignal),
    advance: (ms: number) => {
      time += ms
    },
    settle: () => Promise.all(jobs),
    records,
  }
}

test('cache freshness follows dataset, fetch year, empty results, and a bounded stale window', () => {
  const entry = { at, features }
  assert.deepEqual(cachePolicy(url, entry), { fresh: 90 * DAY, stale: DAY })
  assert.deepEqual(cachePolicy(url.replace('2024', '2026'), entry), { fresh: DAY, stale: DAY })
  assert.deepEqual(cachePolicy(url.replace('XPT002', 'XPT001'), entry), { fresh: DAY, stale: DAY })
  assert.deepEqual(cachePolicy(url, { at, features: [] }), { fresh: HOUR, stale: 0 })
  assert.equal(cacheState(url, entry, at + 90 * DAY - 1), 'fresh')
  assert.equal(cacheState(url, entry, at + 90 * DAY), 'stale')
  assert.equal(cacheState(url, entry, at + 91 * DAY), 'expired')
  assert.equal(cacheState(url, { at: Number.NaN, features }, at), 'expired')
  assert.equal(cacheState(url, entry, at - 1), 'expired')
  const december = Date.UTC(2026, 11, 31)
  assert.equal(
    cacheState(url.replace('2024', '2026'), { at: december, features }, december + DAY),
    'stale',
  )
  assert.equal(browserCacheControl(url, entry, at), 'public, max-age=300')
  assert.equal(browserCacheControl(url, entry, at + 90 * DAY - 2000), 'public, max-age=2')
  assert.equal(browserCacheControl(url, entry, at + 90 * DAY), 'no-store')
})

test('separate edge requests share 90-day history and refresh stale results without waiting or cancelling', async () => {
  const refresh = deferred<Response>()
  const started = deferred<AbortSignal>()
  let calls = 0
  const harness = edgeHarness(async (_url, init) => {
    if (++calls === 1) return Response.json({ features })
    assert.ok(init?.signal)
    started.resolve(init.signal)
    return refresh.promise
  })
  const first = await harness.request()
  assert.equal(first.cacheStatus, 'MISS')
  harness.advance(89 * DAY)
  assert.equal((await harness.request()).cacheStatus, 'HIT')
  assert.equal(calls, 1)
  harness.advance(DAY)
  const controller = new AbortController()
  const stale = await harness.request(controller.signal)
  assert.equal(stale.cacheStatus, 'STALE')
  assert.equal(stale.at, first.at)
  const backgroundSignal = await started.promise
  controller.abort()
  assert.equal(backgroundSignal.aborted, false)
  assert.equal((await harness.request()).cacheStatus, 'STALE')
  assert.equal(calls, 2)
  refresh.resolve(Response.json({ features }))
  await harness.settle()
  const updated = await harness.request()
  assert.equal(updated.cacheStatus, 'HIT')
  assert.equal(updated.at, at + 90 * DAY)
  assert.equal(calls, 2)
})

test('empty edge tiles are shared for an hour, then fetched synchronously to discover new data', async () => {
  let calls = 0
  const harness = edgeHarness(async () =>
    Response.json({ features: ++calls === 1 ? [] : features }),
  )
  await harness.request()
  harness.advance(HOUR - 1)
  assert.equal((await harness.request()).cacheStatus, 'HIT')
  harness.advance(1)
  assert.equal((await harness.request()).features.length, 1)
  assert.equal(calls, 2)
})

test('a failed background refresh preserves data and its original age, but cannot extend it indefinitely', async () => {
  let calls = 0
  const harness = edgeHarness(async () =>
    ++calls === 1 ? Response.json({ features }) : new Response('', { status: 429 }),
  )
  await harness.request()
  harness.advance(90 * DAY)
  assert.equal((await harness.request()).cacheStatus, 'STALE')
  await harness.settle()
  assert.equal((await harness.request()).at, at)
  assert.equal(calls, 2)
  harness.advance(DAY)
  await assert.rejects(
    harness.request(),
    (error: unknown) => error instanceof UpstreamError && error.status === 429,
  )
})

test('Node disk cache uses the same long freshness and stale refresh across store restarts', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'price-policy-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let time = at
  let calls = 0
  const refresh = deferred<Response>()
  const started = deferred<void>()
  const options = {
    directory,
    interval: 0,
    now: () => time,
    fetcher: async () => {
      if (++calls === 1) return Response.json({ features })
      started.resolve()
      return refresh.promise
    },
  }
  await createTileStore(options).get(url, 'secret', signal())
  time += 89 * DAY
  const store = createTileStore(options)
  assert.equal((await store.get(url, 'secret', signal())).cacheStatus, 'HIT')
  time += DAY
  assert.equal((await store.get(url, 'secret', signal())).cacheStatus, 'STALE')
  await started.promise
  await store.get(url, 'secret', signal())
  assert.equal(calls, 2)
  refresh.resolve(Response.json({ features }))
  for (let attempt = 0; attempt < 100; attempt++) {
    const current = await store.get(url, 'secret', signal())
    if (current.cacheStatus === 'HIT') {
      assert.equal(current.at, time)
      await delay(20)
      return
    }
    await delay(5)
  }
  assert.fail('The background refresh did not become available')
})

test('only fresh successful tile responses permit browser storage; priority does not vary the content', async () => {
  let stale = false
  const priorities: number[] = []
  const app = createApp(() => 'secret', {
    get: async (_url, _key, _signal, priority) => {
      priorities.push(priority ?? 0)
      return { at: Date.now(), features, cacheStatus: stale ? 'STALE' : 'HIT' }
    },
  })
  const path = `/api/tiles/${tileKey(tile)}?dataset=land&year=2024`
  const first = await app.request(path, { headers: { 'X-Price-Priority': 'background' } })
  assert.equal(first.headers.get('Cache-Control'), 'public, max-age=300')
  assert.equal(first.headers.get('X-Price-Cache'), 'HIT')
  assert.equal(first.headers.get('Vary'), null)
  assert.equal((await first.json()).points.length, 1)
  assert.deepEqual(priorities, [1])
  stale = true
  const old = await app.request(path)
  assert.equal(old.headers.get('Cache-Control'), 'no-store')
  assert.equal((await old.json()).stale, true)
  for (const invalid of ['/api/health', `${path}&priority=invalid`, '/api/tiles/12/1/1'])
    assert.equal((await app.request(invalid)).headers.get('Cache-Control'), 'no-store')
  const failure = createApp(() => 'secret', {
    get: async () => {
      throw new UpstreamError(429, 60)
    },
  })
  const error = await failure.request(path)
  assert.equal(error.status, 502)
  assert.equal(error.headers.get('Cache-Control'), 'no-store')
})

test('visible and prefetched requests use the same browser-cache URL', async () => {
  const seen: { url: string; priority: string | null }[] = []
  const requests = createTileQueries(async (input, init) => {
    seen.push({ url: String(input), priority: new Headers(init?.headers).get('X-Price-Priority') })
    return Response.json({ points: [], fetchedAt: new Date().toISOString() })
  })
  const { QueryClient } = await import('@tanstack/react-query')
  const client = new QueryClient()
  try {
    const options = requests.options('land', 2024, tile)
    await client.fetchQuery(options)
    client.clear()
    requests.setVisible([JSON.stringify(options.queryKey)])
    await client.fetchQuery(requests.options('change', 2024, tile))
    assert.equal(seen[0].url, seen[1].url)
    assert.deepEqual(
      seen.map((entry) => entry.priority),
      ['background', 'visible'],
    )
  } finally {
    client.clear()
  }
})
