import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import type { Feature, FeatureCollection } from 'geojson'
import { Hono } from 'hono'
import type { Bounds, DataResponse, Dataset } from '../src/types'
import { clipBounds, inBounds, normalizePoint, tilesForBounds } from './data'

const BASE_URL = 'https://www.reinfolib.mlit.go.jp/ex-api/external/'
const CACHE_TTL = 24 * 60 * 60 * 1000
const pending = new Map<string, Promise<Feature[]>>()
const memory = new Map<string, { at: number; features: Feature[] }>()
let queue: Promise<unknown> = Promise.resolve()
let upstreamBackoff: { until: number; status: number } | undefined

class UpstreamError extends Error {
  constructor(public status: number) {
    super('Upstream request failed')
  }
}

export function createApp(getApiKey: () => string | undefined) {
  const app = new Hono()
  app.use('/api/*', async (c, next) => {
    const origin = c.req.header('Origin')
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return c.json({ error: 'このAPIはローカルから利用してください。' }, 403)
    }
    c.header('Cache-Control', 'no-store')
    await next()
  })
  app.get('/api/health', (c) => c.json({ configured: Boolean(getApiKey()) }))
  app.get('/api/data', async (c) => {
    const dataset = c.req.query('dataset') ?? 'land'
    const year = Number(c.req.query('year') ?? 2025)
    const bounds = (c.req.query('bounds') ?? '').split(',').map(Number)
    if (
      !['land', 'survey', 'change', 'transactions'].includes(dataset) ||
      !Number.isInteger(year) ||
      year < 2020 ||
      year > new Date().getFullYear() ||
      bounds.length !== 4 ||
      !bounds.every(Number.isFinite) ||
      bounds[0] >= bounds[2] ||
      bounds[1] >= bounds[3] ||
      bounds[0] < -180 ||
      bounds[2] > 180 ||
      bounds[1] < -85 ||
      bounds[3] > 85
    ) {
      return c.json({ error: '表示範囲・年度・データの指定を確認してください。' }, 400)
    }
    const apiKey = getApiKey()
    if (!apiKey)
      return c.json(
        { error: '.env に REINFOLIB_API_KEY を設定してサーバーを再起動してください。' },
        503,
      )
    const clipped = clipBounds(bounds as Bounds)
    const response: DataResponse = {
      points: [],
      year,
      dataset: dataset as Dataset,
      fetchedAt: new Date().toISOString(),
      tiles: 0,
      failedTiles: 0,
    }
    if (!clipped) return c.json(response)
    const tiles = tilesForBounds(clipped, 13)
    if (tiles.length > 160)
      return c.json({ error: 'もう少しズームして表示範囲を絞ってください。' }, 400)
    response.tiles = tiles.length
    const results = await Promise.allSettled(
      tiles.map(async (tile) => {
        if (c.req.raw.signal.aborted) throw new UpstreamError(499)
        const params = new URLSearchParams({
          response_format: 'geojson',
          ...Object.fromEntries(Object.entries(tile).map(([k, v]) => [k, String(v)])),
        })
        if (dataset === 'transactions') {
          params.set('from', `${year}1`)
          params.set('to', `${year}4`)
          params.set('priceClassification', '01')
          params.set('landTypeCode', '07')
        } else {
          params.set('year', String(year))
          params.set('priceClassification', dataset === 'survey' ? '1' : '0')
        }
        const url = `${BASE_URL}${dataset === 'transactions' ? 'XPT001' : 'XPT002'}?${params}`
        return await fetchTile(url, apiKey, c.req.raw.signal)
      }),
    )
    let upstreamStatus: number | undefined
    const unique = new Map<string, ReturnType<typeof normalizePoint>>()
    results.forEach((result, tileIndex) => {
      if (result.status === 'rejected') {
        response.failedTiles++
        if (result.reason instanceof UpstreamError) upstreamStatus = result.reason.status
        return
      }
      result.value.forEach((feature, index) => {
        const point = normalizePoint(feature, dataset as Dataset, tileIndex * 1_000_000 + index)
        if (point && inBounds(point.coordinates, clipped)) unique.set(point.id, point)
      })
    })
    if (upstreamStatus === 401 || upstreamStatus === 403) {
      return c.json(
        { error: '国交省APIの認証に失敗しました。キーの設定と利用状態を確認してください。' },
        502,
      )
    }
    if (response.failedTiles === tiles.length) {
      return c.json(
        {
          error:
            upstreamStatus === 429
              ? '国交省APIが混み合っています。少し待って再読み込みしてください。'
              : 'データを取得できませんでした。時間をおいて再読み込みしてください。',
        },
        502,
      )
    }
    response.points = [...unique.values()].filter((point) => point !== undefined)
    if (response.failedTiles)
      response.message = `一部の地域を取得できませんでした（${response.failedTiles}/${tiles.length}タイル）。集計は取得済みの地点のみです。`
    return c.json(response)
  })
  app.onError((_error, c) =>
    c.json({ error: 'サーバーでエラーが発生しました。再読み込みしてください。' }, 500),
  )
  return app
}

async function fetchTile(url: string, apiKey: string, signal: AbortSignal): Promise<Feature[]> {
  const cacheKey = createHash('sha256').update(url).digest('hex')
  const cached = memory.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.features
  const running = pending.get(cacheKey)
  if (running) {
    try {
      return await running
    } catch (error) {
      if (error instanceof UpstreamError && error.status === 499 && !signal.aborted) {
        return fetchTile(url, apiKey, signal)
      }
      throw error
    }
  }
  const request = (async () => {
    const file = `.cache/tiles/${cacheKey}.json`
    try {
      const disk = JSON.parse(await readFile(file, 'utf8')) as { at: number; features: Feature[] }
      if (Date.now() - disk.at < CACHE_TTL && Array.isArray(disk.features)) {
        memory.set(cacheKey, disk)
        return disk.features
      }
    } catch {
      /* A cache miss is normal; request the public dataset from the API. */
    }
    const turn = queue.then(async () => {
      if (signal.aborted) throw new UpstreamError(499)
      if (upstreamBackoff && Date.now() < upstreamBackoff.until) {
        throw new UpstreamError(upstreamBackoff.status)
      }
      await delay(200)
      let data: FeatureCollection | Feature[]
      try {
        const res = await fetch(url, {
          headers: { 'Ocp-Apim-Subscription-Key': apiKey },
          signal: AbortSignal.timeout(15_000),
        })
        if (!res.ok) throw new UpstreamError(res.status)
        data = await res.json()
      } catch (error) {
        const status = error instanceof UpstreamError ? error.status : 504
        upstreamBackoff = { until: Date.now() + (status === 429 ? 30_000 : 5_000), status }
        throw new UpstreamError(status)
      }
      const features = Array.isArray(data) ? data : data.features
      if (!Array.isArray(features)) throw new UpstreamError(502)
      const entry = { at: Date.now(), features }
      memory.set(cacheKey, entry)
      if (memory.size > 300) {
        const oldest = memory.keys().next().value
        if (oldest) memory.delete(oldest)
      }
      await mkdir('.cache/tiles', { recursive: true })
      await writeFile(file, JSON.stringify(entry))
      return features
    })
    queue = turn.catch(() => undefined)
    return turn
  })()
  pending.set(cacheKey, request)
  try {
    return await request
  } finally {
    pending.delete(cacheKey)
  }
}
