import type { FeatureCollection, Point } from 'geojson'
import type { Metric, PricePoint } from './types'

export const PRICE_COLORS = ['#568faf', '#6a93cd', '#998ddd', '#c793d2', '#ea95af', '#ff877d']
export const PRICE_STOPS = [0, 300_000, 700_000, 1_500_000, 5_000_000, 15_000_000]
export const CHANGE_COLORS = ['#668be6', '#9cb9e9', '#a4c7c7', '#77d8bc', '#edda8e', '#ffaf75']
export const CHANGE_STOPS = [-5, 0, 2, 5, 10, 20]
export const MISSING_CHANGE_COLOR = '#919ba5'

export function median(values: number[]): number | undefined {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function priceLabel(value?: number, digits = 1): string {
  if (value === undefined) return '—'
  return (value / 10_000).toLocaleString('ja-JP', { maximumFractionDigits: digits })
}

export function changeLabel(value?: number): string {
  return value === undefined ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

export function transactionStationId(point: PricePoint): string {
  return `station-${point.transactionType ?? point.category}-${point.coordinates.join(',')}`
}

export function stationAreaLabel(station?: string): string {
  const name = station?.trim()
  return name ? `${name}${name.endsWith('駅') ? '' : '駅'}周辺` : '駅周辺（駅名不明）'
}

export function groupTransactions(points: PricePoint[]): PricePoint[] {
  const groups = new Map<string, PricePoint[]>()
  for (const point of points) {
    const key = transactionStationId(point)
    const group = groups.get(key) ?? []
    group.push(point)
    groups.set(key, group)
  }
  return [...groups.entries()].map(([key, group]) => {
    const station = group.find((point) => point.station)?.station
    return {
      ...group[0],
      id: key,
      price: median(group.map((point) => point.price)) ?? 0,
      address: stationAreaLabel(station),
      station,
      municipality: [...new Set(group.map((point) => point.municipality).filter(Boolean))]
        .sort()
        .join('・'),
      count: group.length,
      change: undefined,
      previousPrice: undefined,
      area: undefined,
      totalPrice: undefined,
      usage: undefined,
      zoning: undefined,
      period: undefined,
    }
  })
}

export function colorFor(point: PricePoint, metric: Metric) {
  if (metric === 'change' && point.change === undefined) return MISSING_CHANGE_COLOR
  const value = metric === 'change' ? (point.change ?? 0) : point.price
  const stops = metric === 'change' ? CHANGE_STOPS : PRICE_STOPS
  const colors = metric === 'change' ? CHANGE_COLORS : PRICE_COLORS
  let index = 0
  for (let i = 0; i < stops.length; i++) if (value >= stops[i]) index = i
  return colors[index]
}

export function pointCollection(points: PricePoint[], metric: Metric): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: points.map((point) => ({
      type: 'Feature',
      id: point.id,
      geometry: { type: 'Point', coordinates: point.coordinates },
      properties: {
        id: point.id,
        price: point.price,
        change: point.change,
        color: colorFor(point, metric),
      },
    })),
  }
}

export function columnHeight(point: PricePoint, metric: Metric): number {
  return metric === 'change'
    ? 80 + Math.abs(point.change ?? 0) * 95
    : Math.min(6500, Math.sqrt(point.price) * 0.9)
}
