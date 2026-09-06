import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Feature, FeatureCollection } from 'geojson'
import { RequestQueue } from '../src/requestQueue'

export const CACHE_TTL = 24 * 60 * 60 * 1000

interface CacheEntry {
  at: number
  features: Feature[]
}

interface PendingTile {
  controller: AbortController
  consumers: Map<symbol, number>
  promise: Promise<CacheEntry>
}

export class UpstreamError extends Error {
  constructor(
    public status: number,
    public retryAfter = 0,
  ) {
    super(
      status === 401 || status === 403
        ? '国交省APIの認証に失敗しました。キーの設定と利用状態を確認してください。'
        : status === 429
          ? '国交省APIが混み合っています。少し待って再読み込みしてください。'
          : 'データを取得できませんでした。時間をおいて再読み込みしてください。',
    )
  }
}

export function createTileStore({
  fetcher = fetch,
  directory = '.cache/tiles',
  concurrency = 4,
  interval = 200,
}: {
  fetcher?: typeof fetch
  directory?: string
  concurrency?: number
  interval?: number
} = {}) {
  const memory = new Map<string, CacheEntry>()
  const pending = new Map<string, PendingTile>()
  const queue = new RequestQueue(concurrency, interval, Math.min(2, concurrency))
  let backoff: { until: number; status: number } | undefined

  function remember(key: string, entry: CacheEntry) {
    memory.delete(key)
    memory.set(key, entry)
    while (memory.size > 300) {
      const oldest = memory.keys().next().value
      if (oldest) memory.delete(oldest)
    }
    return entry
  }

  async function load(key: string, url: string, apiKey: string, job: PendingTile) {
    const file = join(directory, `${key}.json`)
    try {
      const disk = JSON.parse(await readFile(file, 'utf8')) as CacheEntry
      if (Date.now() - disk.at < CACHE_TTL && Array.isArray(disk.features)) {
        return remember(key, disk)
      }
    } catch {
      /* A cache miss is normal; request the public dataset from the API. */
    }
    const signal = job.controller.signal
    return queue.run(
      async () => {
        if (backoff && Date.now() < backoff.until) {
          throw new UpstreamError(backoff.status, Math.ceil((backoff.until - Date.now()) / 1000))
        }
        let features: Feature[]
        try {
          const response = await fetcher(url, {
            headers: { 'Ocp-Apim-Subscription-Key': apiKey },
            signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
          })
          if (!response.ok) {
            const retryHeader = response.headers.get('Retry-After')
            const seconds = retryHeader
              ? Number(retryHeader) || (Date.parse(retryHeader) - Date.now()) / 1000
              : 0
            throw new UpstreamError(response.status, Number.isFinite(seconds) ? seconds : 0)
          }
          const data = (await response.json()) as FeatureCollection | Feature[]
          features = Array.isArray(data) ? data : data.features
          if (!Array.isArray(features)) throw new UpstreamError(502)
        } catch (error) {
          if (signal.aborted) throw signal.reason
          const status = error instanceof UpstreamError ? error.status : 504
          const retryAfter = Math.max(
            status === 429 ? 30 : 5,
            error instanceof UpstreamError ? error.retryAfter : 0,
          )
          const until = Date.now() + retryAfter * 1000
          if (!backoff || until > backoff.until) backoff = { until, status }
          throw new UpstreamError(status, retryAfter)
        }
        const entry = remember(key, { at: Date.now(), features })
        try {
          await mkdir(directory, { recursive: true })
          await writeFile(file, JSON.stringify(entry))
        } catch {
          console.warn('Tile disk cache could not be written; the memory cache is still available.')
        }
        return entry
      },
      signal,
      () => Math.min(1, ...job.consumers.values()),
    )
  }

  function get(
    url: string,
    apiKey: string,
    signal: AbortSignal,
    priority = 0,
  ): Promise<CacheEntry> {
    if (signal.aborted) return Promise.reject(signal.reason)
    const key = createHash('sha256').update(url).digest('hex')
    const cached = memory.get(key)
    if (cached && Date.now() - cached.at < CACHE_TTL) {
      return Promise.resolve(remember(key, cached))
    }
    let job = pending.get(key)
    if (!job || job.controller.signal.aborted) {
      const next: PendingTile = {
        controller: new AbortController(),
        consumers: new Map(),
        promise: Promise.resolve().then(() => load(key, url, apiKey, next)),
      }
      job = next
      pending.set(key, job)
      const clean = () => {
        if (pending.get(key) === next) pending.delete(key)
      }
      job.promise.then(clean, clean)
    }
    const shared = job
    const consumer = Symbol()
    shared.consumers.set(consumer, priority)
    queue.pump()
    return new Promise<CacheEntry>((resolve, reject) => {
      const release = () => {
        signal.removeEventListener('abort', cancel)
        shared.consumers.delete(consumer)
      }
      const cancel = () => {
        release()
        if (!shared.consumers.size) shared.controller.abort()
        reject(signal.reason)
      }
      signal.addEventListener('abort', cancel, { once: true })
      shared.promise.then(
        (value) => {
          release()
          resolve(value)
        },
        (error: unknown) => {
          release()
          reject(error)
        },
      )
    })
  }

  return { get }
}
