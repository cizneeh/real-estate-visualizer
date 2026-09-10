import type { Feature } from 'geojson'

export const HOUR = 60 * 60 * 1000
export const DAY = 24 * HOUR

export type CacheStatus = 'HIT' | 'MISS' | 'STALE'

export interface CacheEntry {
  at: number
  features: Feature[]
  cacheStatus?: CacheStatus
}

export interface TileStore {
  get(url: string, apiKey: string, signal: AbortSignal, priority?: number): Promise<CacheEntry>
}

export function cachePolicy(url: string, entry: CacheEntry) {
  if (!entry.features.length) return { fresh: HOUR, stale: 0 }
  const source = new URL(url)
  const year = Number(source.searchParams.get('year'))
  const historical =
    source.pathname.endsWith('/XPT002') &&
    Number.isInteger(year) &&
    year >= 1995 &&
    year < new Date(entry.at).getUTCFullYear()
  return { fresh: historical ? 90 * DAY : DAY, stale: DAY }
}

export function cacheState(url: string, entry: CacheEntry, now = Date.now()) {
  const age = now - entry.at
  if (!Number.isFinite(age) || age < 0) return 'expired'
  const policy = cachePolicy(url, entry)
  if (age < policy.fresh) return 'fresh'
  if (age < policy.fresh + policy.stale) return 'stale'
  return 'expired'
}

export function browserCacheControl(url: string, entry: CacheEntry, now = Date.now()) {
  const remaining = Math.floor((entry.at + cachePolicy(url, entry).fresh - now) / 1000)
  if (remaining <= 0 || entry.cacheStatus === 'STALE') return 'no-store'
  return `public, max-age=${Math.min(entry.features.length ? 300 : 60, remaining)}`
}
