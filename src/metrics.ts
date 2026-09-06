import type { FeatureCollection, Point, Polygon } from 'geojson'
import type { Dataset, PricePoint } from './types'

export const PRICE_COLORS = ['#75ddc8', '#54c4dd', '#638fea', '#a18aee', '#ed99cf', '#ffc77b']
export const PRICE_STOPS = [0, 300_000, 700_000, 1_500_000, 5_000_000, 15_000_000]
export const CHANGE_COLORS = ['#668be6', '#9cb9e9', '#a4c7c7', '#77d8bc', '#edda8e', '#ffaf75']
export const CHANGE_STOPS = [-5, 0, 2, 5, 10, 20]

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

export function groupTransactions(points: PricePoint[]): PricePoint[] {
  const groups = new Map<string, PricePoint[]>()
  for (const point of points) {
    const key = point.coordinates.join(',')
    const group = groups.get(key) ?? []
    group.push(point)
    groups.set(key, group)
  }
  return [...groups.entries()].map(([key, group]) => ({
    ...group[0],
    id: `station-${key}`,
    price: median(group.map((point) => point.price)) ?? 0,
    address: `${group[0].municipality}の駅周辺`,
    count: group.length,
    area: undefined,
    totalPrice: undefined,
    usage: undefined,
    zoning: undefined,
    period: undefined,
  }))
}

export function colorFor(point: PricePoint, dataset: Dataset) {
  const value = dataset === 'change' ? (point.change ?? 0) : point.price
  const stops = dataset === 'change' ? CHANGE_STOPS : PRICE_STOPS
  const colors = dataset === 'change' ? CHANGE_COLORS : PRICE_COLORS
  let index = 0
  for (let i = 0; i < stops.length; i++) if (value >= stops[i]) index = i
  return colors[index]
}

export function pointCollection(points: PricePoint[], dataset: Dataset): FeatureCollection<Point> {
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
        color: colorFor(point, dataset),
      },
    })),
  }
}

export function columnCollection(
  points: PricePoint[],
  dataset: Dataset,
): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: points.map((point) => {
      const [lng, lat] = point.coordinates
      const radius = point.count ? 85 : 45
      const ring: number[][] = []
      for (let i = 0; i <= 6; i++) {
        const angle = (i * Math.PI) / 3
        ring.push([
          lng + (Math.cos(angle) * radius) / (111_320 * Math.cos((lat * Math.PI) / 180)),
          lat + (Math.sin(angle) * radius) / 111_320,
        ])
      }
      return {
        type: 'Feature',
        id: point.id,
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {
          id: point.id,
          color: colorFor(point, dataset),
          height:
            dataset === 'change'
              ? 80 + Math.abs(point.change ?? 0) * 95
              : Math.min(6500, Math.sqrt(point.price) * 0.9),
        },
      }
    }),
  }
}
