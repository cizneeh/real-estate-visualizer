import {
  LAND_LOCATION_TOLERANCE_METERS,
  locationDistance,
  mergeLandPoints,
  normalizeLocation,
  sameLandSite,
} from './landPrices'
import type { Dataset, DisplayDataset, Metric, PricePoint } from './types'
import { FIRST_YEAR } from './years'

export type HistoryStatus = 'ready' | 'loading' | 'missing' | 'changed' | 'error'

export interface HistoryEntry {
  year: number
  status: HistoryStatus
  point?: PricePoint
}

export function observationDate(dataset: Dataset, year: number) {
  return `${year}年${dataset === 'survey' ? 7 : 1}月1日`
}

export function periodLabel(dataset: Dataset, metric: Metric, year: number) {
  if (dataset === 'transactions') return `${year}年${year === 2005 ? 7 : 1}〜12月の取引`
  if (metric === 'change')
    return `${observationDate(dataset, year - 1)} → ${observationDate(dataset, year)}`
  return `${observationDate(dataset, year)}時点`
}

export function displayPeriodLabel(dataset: DisplayDataset, metric: Metric, year: number) {
  if (dataset === 'transactions') return periodLabel(dataset, metric, year)
  if (metric === 'change') return `${year - 1}年 → ${year}年（同じ調査の前年と比較）`
  return year < FIRST_YEAR.survey
    ? periodLabel('land', metric, year)
    : `${year}年の公開価格（1月・7月時点）`
}

export function historyYears(dataset: Dataset, endYear: number, span: number | 'all') {
  const first = FIRST_YEAR[dataset]
  const start = span === 'all' ? first : Math.max(first, endYear - span)
  return Array.from({ length: Math.max(0, endYear - start + 1) }, (_, i) => start + i)
}

export function matchHistoryPoint(anchor: PricePoint, points: PricePoint[]) {
  if (!anchor.historyId || !anchor.location) return undefined
  const candidate = points.find(
    (point) => point.historyId === anchor.historyId && point.source === anchor.source,
  )
  if (!candidate) return undefined
  if (
    !candidate.location ||
    normalizeLocation(anchor.location) !== normalizeLocation(candidate.location) ||
    locationDistance(anchor, candidate) > LAND_LOCATION_TOLERANCE_METERS
  )
    return undefined
  return candidate
}

export function matchLandHistoryPoint(anchor: PricePoint, points: PricePoint[]) {
  const candidates = mergeLandPoints(points)
  const direct = matchHistoryPoint(anchor, candidates)
  const counterparts = candidates.filter((point) => sameLandSite(anchor, point))
  if (counterparts.length !== 1) return direct
  return counterparts[0].source === 'survey' || !direct ? counterparts[0] : direct
}

export function historySegments(entries: HistoryEntry[]) {
  const segments: HistoryEntry[][] = []
  let current: HistoryEntry[] = []
  for (const entry of entries) {
    if (entry.status !== 'ready' || !entry.point) {
      current = []
      continue
    }
    if (!current.length || current[current.length - 1].year !== entry.year - 1) {
      current = []
      segments.push(current)
    }
    current.push(entry)
  }
  return segments
}

export const historyStatusLabel: Record<HistoryStatus, string> = {
  ready: '',
  loading: '取得中',
  missing: 'データなし',
  changed: '同じ地点と確認できません',
  error: '取得できませんでした',
}
