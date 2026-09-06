import type { Feature, FeatureCollection } from 'geojson'
import { CACHE_TTL, UpstreamError } from './tileStore'

function pause(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
  })
}

// Only counters are shared across requests; Workers I/O belongs to its originating request.
export class EdgeRequestGate {
  private active = 0
  private backgroundActive = 0
  private visibleWaiting = 0
  private nextStart = 0
  private backoffUntil = 0
  private backoffStatus = 503

  constructor(
    private readonly concurrency = 4,
    private readonly interval = 200,
  ) {}

  async run<T>(task: () => Promise<T>, signal: AbortSignal, priority: number) {
    const background = priority > 0
    if (!background) this.visibleWaiting++
    try {
      while (true) {
        signal.throwIfAborted()
        if (Date.now() < this.backoffUntil)
          throw new UpstreamError(
            this.backoffStatus,
            Math.ceil((this.backoffUntil - Date.now()) / 1000),
          )
        if (
          this.active < this.concurrency &&
          (!background || (!this.visibleWaiting && this.backgroundActive < 2)) &&
          Date.now() >= this.nextStart
        )
          break
        await pause(Math.max(25, this.nextStart - Date.now()), signal)
      }
      this.active++
      if (background) this.backgroundActive++
      this.nextStart = Date.now() + this.interval
    } finally {
      if (!background) this.visibleWaiting--
    }
    try {
      return await task()
    } catch (error) {
      if (signal.aborted) throw signal.reason
      const status = error instanceof UpstreamError ? error.status : 504
      const retryAfter = Math.max(
        status === 429 ? 30 : 5,
        error instanceof UpstreamError ? error.retryAfter : 0,
      )
      if (Date.now() + retryAfter * 1000 > this.backoffUntil) {
        this.backoffUntil = Date.now() + retryAfter * 1000
        this.backoffStatus = status
      }
      throw new UpstreamError(status, retryAfter)
    } finally {
      this.active--
      if (background) this.backgroundActive--
    }
  }
}

const gate = new EdgeRequestGate()

export function createEdgeTileStore({
  cache,
  origin,
  waitUntil,
  fetcher = fetch,
  requestGate = gate,
}: {
  cache: Pick<Cache, 'match' | 'put'>
  origin: string
  waitUntil: (promise: Promise<unknown>) => void
  fetcher?: typeof fetch
  requestGate?: EdgeRequestGate
}) {
  return {
    async get(url: string, apiKey: string, signal: AbortSignal, priority = 0) {
      signal.throwIfAborted()
      const upstream = new URL(url)
      const cacheKey = new Request(
        `${origin}/__price-cache/v1${upstream.pathname}${upstream.search}`,
      )
      const cached = await cache.match(cacheKey)
      if (cached) return (await cached.json()) as { at: number; features: Feature[] }
      return requestGate.run(
        async () => {
          const response = await fetcher(url, {
            headers: { 'Ocp-Apim-Subscription-Key': apiKey },
            signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
          })
          if (!response.ok) {
            const retry = response.headers.get('Retry-After')
            const seconds = retry ? Number(retry) || (Date.parse(retry) - Date.now()) / 1000 : 0
            throw new UpstreamError(response.status, Number.isFinite(seconds) ? seconds : 0)
          }
          const data = (await response.json()) as FeatureCollection | Feature[]
          const features = Array.isArray(data) ? data : data.features
          if (!Array.isArray(features)) throw new UpstreamError(502)
          const entry = { at: Date.now(), features }
          waitUntil(
            cache
              .put(
                cacheKey,
                Response.json(entry, {
                  headers: { 'Cache-Control': `public, max-age=${CACHE_TTL / 1000}` },
                }),
              )
              .catch(() => console.warn('Price tile edge cache write failed')),
          )
          return entry
        },
        signal,
        priority,
      )
    },
  }
}
