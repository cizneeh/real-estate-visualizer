import { Hono } from 'hono'
import {
  clipBounds,
  DATA_ZOOM,
  inBounds,
  type Tile,
  tileAt,
  tileBounds,
  tileKey,
  tilesForBounds,
} from '../src/tiles'
import type { Bounds, DataResponse, Dataset, PricePoint, TileResponse } from '../src/types'
import { FIRST_YEAR, validYear } from '../src/years'
import { normalizePoint } from './data'
import { createTileStore, UpstreamError } from './tileStore'

const BASE_URL = 'https://www.reinfolib.mlit.go.jp/ex-api/external/'

function validDataset(value: string): value is Dataset {
  return ['land', 'survey', 'change', 'transactions'].includes(value)
}

export function createApp(getApiKey: () => string | undefined, store = createTileStore()) {
  const app = new Hono()
  app.use('/api/*', async (c, next) => {
    const origin = c.req.header('Origin')
    if (
      origin &&
      origin !== new URL(c.req.url).origin &&
      !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    ) {
      return c.json({ error: 'このAPIはアプリと同じサイトから利用してください。' }, 403)
    }
    c.header('Cache-Control', 'no-store')
    await next()
  })
  app.get('/api/health', (c) => c.json({ configured: Boolean(getApiKey()) }))
  async function readTile(
    dataset: Dataset,
    year: number,
    tile: Tile,
    apiKey: string,
    signal: AbortSignal,
    priority = 0,
  ): Promise<TileResponse> {
    const params = new URLSearchParams({
      response_format: 'geojson',
      z: String(tile.z),
      x: String(tile.x),
      y: String(tile.y),
    })
    if (dataset === 'transactions') {
      params.set('from', `${year}${year === FIRST_YEAR.transactions ? 3 : 1}`)
      params.set('to', `${year}4`)
      params.set('priceClassification', '01')
      params.set('landTypeCode', '07')
    } else {
      params.set('year', String(year))
      params.set('priceClassification', dataset === 'survey' ? '1' : '0')
    }
    const url = `${BASE_URL}${dataset === 'transactions' ? 'XPT001' : 'XPT002'}?${params}`
    const entry = await store.get(url, apiKey, signal, priority)
    const points = new Map<string, PricePoint>()
    entry.features.forEach((feature, index) => {
      const point = normalizePoint(feature, dataset, `${tileKey(tile)}/${index}`)
      if (point && tileKey(tileAt(point.coordinates, tile.z)) === tileKey(tile))
        points.set(point.id, point)
    })
    return { points: [...points.values()], fetchedAt: new Date(entry.at).toISOString() }
  }

  app.get('/api/tiles/:z/:x/:y', async (c) => {
    const dataset = c.req.query('dataset') ?? 'land'
    const year = Number(c.req.query('year') ?? 2025)
    const tile = {
      z: Number(c.req.param('z')),
      x: Number(c.req.param('x')),
      y: Number(c.req.param('y')),
    }
    const priority = c.req.query('priority') ?? 'visible'
    if (
      !validDataset(dataset) ||
      !validYear(dataset, year) ||
      tile.z !== DATA_ZOOM ||
      ![tile.x, tile.y].every(
        (value) => Number.isInteger(value) && value >= 0 && value < 2 ** tile.z,
      ) ||
      !['visible', 'background'].includes(priority)
    ) {
      return c.json({ error: 'タイル・年度・データの指定を確認してください。' }, 400)
    }
    if (!clipBounds(tileBounds(tile))) {
      return c.json({ error: '日本周辺のタイルを指定してください。' }, 400)
    }
    const apiKey = getApiKey()
    if (!apiKey)
      return c.json({ error: 'サーバーの REINFOLIB_API_KEY が設定されていません。' }, 503)
    return c.json(
      await readTile(
        dataset,
        year,
        tile,
        apiKey,
        c.req.raw.signal,
        priority === 'background' ? 1 : 0,
      ),
    )
  })

  app.get('/api/data', async (c) => {
    const dataset = c.req.query('dataset') ?? 'land'
    const year = Number(c.req.query('year') ?? 2025)
    const bounds = (c.req.query('bounds') ?? '').split(',').map(Number)
    if (
      !validDataset(dataset) ||
      !validYear(dataset, year) ||
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
    if (!tiles)
      return c.json({
        ...response,
        zoomRequired: true,
        message: '見たい地域を拡大すると、価格データが表示されます。',
      })
    const apiKey = getApiKey()
    if (!apiKey)
      return c.json({ error: 'サーバーの REINFOLIB_API_KEY が設定されていません。' }, 503)
    response.tiles = tiles.length
    const results = await Promise.allSettled(
      tiles.map((tile) => readTile(dataset, year, tile, apiKey, c.req.raw.signal)),
    )
    let upstreamStatus: number | undefined
    const unique = new Map<string, ReturnType<typeof normalizePoint>>()
    results.forEach((result) => {
      if (result.status === 'rejected') {
        response.failedTiles++
        if (result.reason instanceof UpstreamError) upstreamStatus = result.reason.status
        return
      }
      result.value.points.forEach((point) => {
        if (inBounds(point.coordinates, clipped)) unique.set(point.id, point)
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
  app.onError((error, c) => {
    if (error instanceof UpstreamError) {
      if (error.retryAfter) c.header('Retry-After', String(Math.ceil(error.retryAfter)))
      return c.json({ error: error.message, upstreamStatus: error.status }, 502)
    }
    if (error.name === 'AbortError') return new Response(undefined, { status: 499 })
    return c.json({ error: 'サーバーでエラーが発生しました。再読み込みしてください。' }, 500)
  })
  return app
}
