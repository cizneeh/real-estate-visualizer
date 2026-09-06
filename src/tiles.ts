import { type Bounds, JAPAN_BOUNDS } from './types'

export const DATA_ZOOM = 13
export const MAX_VISIBLE_TILES = 160
export const MAX_PREFETCH_TILES = 32

export interface Tile {
  z: number
  x: number
  y: number
}

export const tileKey = ({ z, x, y }: Tile) => `${z}/${x}/${y}`

export function inBounds([lng, lat]: number[], [west, south, east, north]: Bounds) {
  return lng >= west && lng <= east && lat >= south && lat <= north
}

export function clipBounds(bounds: Bounds): Bounds | undefined {
  const clipped: Bounds = [
    Math.max(bounds[0], JAPAN_BOUNDS[0]),
    Math.max(bounds[1], JAPAN_BOUNDS[1]),
    Math.min(bounds[2], JAPAN_BOUNDS[2]),
    Math.min(bounds[3], JAPAN_BOUNDS[3]),
  ]
  return clipped[0] <= clipped[2] && clipped[1] <= clipped[3] ? clipped : undefined
}

export function tileAt([lng, lat]: number[], z = DATA_ZOOM): Tile {
  const n = 2 ** z
  return {
    z,
    x: Math.min(n - 1, Math.max(0, Math.floor(((lng + 180) / 360) * n))),
    y: Math.min(
      n - 1,
      Math.max(
        0,
        Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n),
      ),
    ),
  }
}

export function tileBounds({ z, x, y }: Tile): Bounds {
  const n = 2 ** z
  const latitude = (ty: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI
  return [(x / n) * 360 - 180, latitude(y + 1), ((x + 1) / n) * 360 - 180, latitude(y)]
}

export function tilesForBounds(bounds: Bounds, z = DATA_ZOOM, limit = MAX_VISIBLE_TILES) {
  const nw = tileAt([bounds[0], bounds[3]], z)
  const se = tileAt([bounds[2], bounds[1]], z)
  if ((se.x - nw.x + 1) * (se.y - nw.y + 1) > limit) return undefined
  const tiles: Tile[] = []
  for (let x = nw.x; x <= se.x; x++) {
    for (let y = nw.y; y <= se.y; y++) tiles.push({ z, x, y })
  }
  return sortFromCenter(tiles, (nw.x + se.x) / 2, (nw.y + se.y) / 2)
}

function sortFromCenter(tiles: Tile[], x: number, y: number) {
  return tiles.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))
}

export function surroundingTiles(visible: Tile[]): Tile[] {
  if (!visible.length) return []
  const visibleKeys = new Set(visible.map(tileKey))
  const nearby = new Map<string, Tile>()
  for (const tile of visible) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighbor = { z: tile.z, x: tile.x + dx, y: tile.y + dy }
        const key = tileKey(neighbor)
        if (!visibleKeys.has(key) && clipBounds(tileBounds(neighbor))) nearby.set(key, neighbor)
      }
    }
  }
  const centerX = visible.reduce((total, tile) => total + tile.x, 0) / visible.length
  const centerY = visible.reduce((total, tile) => total + tile.y, 0) / visible.length
  return sortFromCenter([...nearby.values()], centerX, centerY).slice(0, MAX_PREFETCH_TILES)
}
