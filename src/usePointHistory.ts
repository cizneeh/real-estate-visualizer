import { useQueries } from '@tanstack/react-query'
import { type HistoryEntry, matchHistoryPoint } from './history'
import type { createTileQueries } from './tileQueries'
import { tileAt } from './tiles'
import type { Dataset, PricePoint } from './types'

export function usePointHistory(
  anchor: PricePoint,
  dataset: Dataset,
  years: number[],
  requests: ReturnType<typeof createTileQueries>,
) {
  const supported = dataset !== 'transactions' && Boolean(anchor.historyId && anchor.location)
  const tile = tileAt(anchor.coordinates)
  const results = useQueries({
    queries: supported ? years.map((year) => requests.options(dataset, year, tile)) : [],
  })
  const entries: HistoryEntry[] = years.map((year, i) => {
    const result = results[i]
    if (!result) return { year, status: 'missing' }
    const point = result.data && matchHistoryPoint(anchor, result.data.points)
    if (point) return { year, status: 'ready', point }
    if (result.isError) return { year, status: 'error' }
    if (result.isPending || result.isFetching) return { year, status: 'loading' }
    if (result.data?.points.some((candidate) => candidate.historyId === anchor.historyId))
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
