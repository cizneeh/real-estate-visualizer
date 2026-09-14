import type { Feature, Position } from 'geojson'
import type { PricePoint } from '../src/types'

const MAX_STATION_DISTANCE = 100
const AMBIGUOUS_DISTANCE = 20
const METERS_PER_DEGREE = (Math.PI * 6_371_000) / 180

function segmentDistance(point: Position, start: Position, end: Position): number {
  const scaleX = METERS_PER_DEGREE * Math.cos((point[1] * Math.PI) / 180)
  const ax = (start[0] - point[0]) * scaleX
  const ay = (start[1] - point[1]) * METERS_PER_DEGREE
  const dx = (end[0] - start[0]) * scaleX
  const dy = (end[1] - start[1]) * METERS_PER_DEGREE
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0
  return Math.hypot(ax + t * dx, ay + t * dy)
}

export function stationNameAt(coordinates: Position, features: Feature[]): string | undefined {
  const distances = new Map<string, number>()
  for (const feature of features) {
    const rawName = feature.properties?.S12_001_ja
    if (typeof rawName !== 'string' || !rawName.trim()) continue
    const name = rawName.trim().replace(/駅$/, '')
    const geometry = feature.geometry
    const lines =
      geometry?.type === 'LineString'
        ? [geometry.coordinates]
        : geometry?.type === 'MultiLineString'
          ? geometry.coordinates
          : geometry?.type === 'Point'
            ? [[geometry.coordinates, geometry.coordinates]]
            : []
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        const distance = segmentDistance(coordinates, line[i - 1], line[i])
        if (distance <= MAX_STATION_DISTANCE)
          distances.set(name, Math.min(distances.get(name) ?? Infinity, distance))
      }
    }
  }
  const candidates = [...distances].sort((a, b) => a[1] - b[1])
  if (candidates[1] && candidates[1][1] - candidates[0][1] <= AMBIGUOUS_DISTANCE) return undefined
  return candidates[0]?.[0]
}

export function nameTransactionStations(points: PricePoint[], features: Feature[]): PricePoint[] {
  const names = new Map<string, string | undefined>()
  return points.map((point) => {
    const key = point.coordinates.join(',')
    if (!names.has(key)) names.set(key, stationNameAt(point.coordinates, features))
    return { ...point, station: names.get(key) }
  })
}
