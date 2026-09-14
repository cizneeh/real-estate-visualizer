import type { Dataset, DisplayDataset, PricePoint } from './types'
import { FIRST_YEAR } from './years'

export const LAND_LOCATION_TOLERANCE_METERS = 25

export function datasetsForYear(dataset: DisplayDataset, year: number): Dataset[] {
  if (dataset === 'transactions') return ['transactions']
  return year >= FIRST_YEAR.survey ? ['land', 'survey'] : ['land']
}

const KANJI_DIGITS: Record<string, number> = {
  〇: 0,
  零: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

function chomeNumber(value: string) {
  if (!/[十百]/.test(value)) return [...value].map((digit) => KANJI_DIGITS[digit]).join('')
  let total = 0
  let digit = 0
  for (const char of value) {
    if (char === '十' || char === '百') {
      total += (digit || 1) * (char === '十' ? 10 : 100)
      digit = 0
    } else {
      digit = KANJI_DIGITS[char]
    }
  }
  return String(total + digit)
}

export const normalizeLocation = (value: string) =>
  value
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[〇零一二三四五六七八九十百]+(?=丁目)/g, chomeNumber)

export function locationDistance(a: PricePoint, b: PricePoint) {
  const latitude = (a.coordinates[1] * Math.PI) / 180
  const east = (b.coordinates[0] - a.coordinates[0]) * 111_320 * Math.cos(latitude)
  const north = (b.coordinates[1] - a.coordinates[1]) * 111_320
  return Math.hypot(east, north)
}

function siteKey(point: PricePoint) {
  if (!point.location || !point.area || !point.source || point.category === 'その他')
    return undefined
  return JSON.stringify([normalizeLocation(point.location), point.area, point.category])
}

export function sameLandSite(a: PricePoint, b: PricePoint) {
  const key = siteKey(a)
  return Boolean(
    key &&
      key === siteKey(b) &&
      a.source !== b.source &&
      locationDistance(a, b) <= LAND_LOCATION_TOLERANCE_METERS,
  )
}

export function mergeLandPoints(points: PricePoint[]) {
  const unique = new Map(points.map((point) => [`${point.source}:${point.id}`, point]))
  const groups = new Map<string, PricePoint[]>()
  for (const point of unique.values()) {
    const key = siteKey(point) ?? `${point.source}:${point.id}`
    const group = groups.get(key) ?? []
    group.push(point)
    groups.set(key, group)
  }
  return [...groups.values()].flatMap((group) => {
    if (group.length !== 2 || !sameLandSite(group[0], group[1])) return group
    return group.filter((point) => point.source === 'survey')
  })
}
