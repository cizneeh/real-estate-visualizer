import { useQueries } from '@tanstack/react-query'
import { type HistoryEntry, matchLandHistoryPoint } from './history'
import { datasetsForYear, LAND_LOCATION_TOLERANCE_METERS } from './landPrices'
import type { createTileQueries } from './tileQueries'
import { tilesForBounds } from './tiles'
import type { DisplayDataset, PricePoint } from './types'

export function usePointHistory(
  anchor: PricePoint,
  dataset: DisplayDataset,
  years: number[],
  requests: ReturnType<typeof createTileQueries>,
) {
  const supported = dataset !== 'transactions' && Boolean(anchor.historyId && anchor.location)
  const [lng, lat] = anchor.coordinates
  const dy = LAND_LOCATION_TOLERANCE_METERS / 111_320
  const dx = dy / Math.cos((lat * Math.PI) / 180)
  const tiles = tilesForBounds([lng - dx, lat - dy, lng + dx, lat + dy]) ?? []
  const queries = supported
    ? years.flatMap((year) =>
        datasetsForYear(dataset, year).flatMap((source) =>
          tiles.map((tile) => ({ year, options: requests.options(source, year, tile) })),
        ),
      )
    : []
  const results = useQueries({
    queries: queries.map((query) => query.options),
  })
  const entries: HistoryEntry[] = years.map((year) => {
    const observations = results.filter((_, i) => queries[i].year === year)
    const points = observations.flatMap((result) => result.data?.points ?? [])
    const point = matchLandHistoryPoint(anchor, points)
    if (point) return { year, status: 'ready', point }
    if (observations.some((result) => result.isPending || result.isFetching))
      return { year, status: 'loading' }
    if (observations.some((result) => result.isError)) return { year, status: 'error' }
    if (points.some((candidate) => candidate.historyId === anchor.historyId))
      return { year, status: 'changed' }
    return { year, status: 'missing' }
  })
  return {
    entries,
    supported,
    loading: results.some((result) => result.isPending || result.isFetching),
    failed: results.some((result) => result.isError),
    retry: () => {
      for (const result of results) if (result.isError) void result.refetch()
    },
  }
}
