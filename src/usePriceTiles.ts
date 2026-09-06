import { type UseQueryResult, useQueries, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createTileQueries, priceTileKey, type TileError } from './tileQueries'
import { clipBounds, inBounds, surroundingTiles, tilesForBounds } from './tiles'
import type { Bounds, DataResponse, Dataset, PricePoint, TileResponse } from './types'

function combineTiles(results: UseQueryResult<TileResponse, TileError>[]) {
  return {
    data: results.flatMap((result) => (result.data ? [result.data] : [])),
    loading: results.some((result) => result.isPending || result.isFetching),
    failed: results.filter((result) => result.isError).length,
    error: results.find((result) => result.error)?.error?.message,
    completed: results.filter((result) => result.data || result.isError).length,
  }
}

export function usePriceTiles(bounds: Bounds | undefined, dataset: Dataset, year: number) {
  const queryClient = useQueryClient()
  const [requests] = useState(() => createTileQueries())
  const clipped = useMemo(() => (bounds ? clipBounds(bounds) : undefined), [bounds])
  const tiles = useMemo(() => (clipped ? tilesForBounds(clipped) : []), [clipped])
  const neighbors = useMemo(() => surroundingTiles(tiles ?? []), [tiles])
  const keys = useMemo(
    () => (tiles ?? []).map((tile) => JSON.stringify(priceTileKey(dataset, year, tile))),
    [dataset, year, tiles],
  )
  const viewKey = [...keys].sort().join('|')
  const [settledView, setSettledView] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setSettledView(viewKey), 200)
    return () => window.clearTimeout(timer)
  }, [viewKey])

  useEffect(() => {
    requests.setVisible(keys)
    const wanted = new Set([
      ...keys,
      ...neighbors.map((tile) => JSON.stringify(priceTileKey(dataset, year, tile))),
    ])
    void queryClient.cancelQueries({
      predicate: (query) =>
        query.queryKey[0] === 'price-tile' && !wanted.has(JSON.stringify(query.queryKey)),
    })
  }, [requests, queryClient, keys, neighbors, dataset, year])

  const results = useQueries({
    queries: (tiles ?? []).map((tile) => ({
      ...requests.options(dataset, year, tile),
      enabled: settledView === viewKey,
    })),
    combine: combineTiles,
  })

  useEffect(() => {
    if (settledView !== viewKey || results.loading || results.failed || !tiles?.length) return
    const timer = window.setTimeout(() => {
      for (const tile of neighbors) {
        void queryClient.prefetchQuery(requests.options(dataset, year, tile))
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [
    settledView,
    viewKey,
    results.loading,
    results.failed,
    tiles,
    neighbors,
    queryClient,
    requests,
    dataset,
    year,
  ])

  const data = useMemo<DataResponse>(() => {
    const unique = new Map<string, PricePoint>()
    for (const tile of results.data) {
      for (const point of tile.points) {
        if (clipped && inBounds(point.coordinates, clipped)) unique.set(point.id, point)
      }
    }
    return {
      points: [...unique.values()],
      dataset,
      year,
      fetchedAt: results.data.map((tile) => tile.fetchedAt).sort()[0] ?? '',
      tiles: tiles?.length ?? 0,
      failedTiles: results.failed,
      zoomRequired: tiles === undefined,
      message:
        tiles === undefined
          ? '見たい地域を拡大すると、価格データが表示されます。'
          : results.failed
            ? `一部の地域を取得できませんでした。集計は取得済みの地点のみです。`
            : undefined,
    }
  }, [results.data, results.failed, clipped, dataset, year, tiles])

  const retry = useCallback(() => {
    for (const tile of tiles ?? []) {
      const queryKey = priceTileKey(dataset, year, tile)
      const state = queryClient.getQueryState(queryKey)
      if (!state?.data || state.status === 'error') {
        void queryClient.resetQueries({ queryKey, exact: true })
      }
    }
  }, [dataset, year, tiles, queryClient])

  return {
    data,
    loading: !bounds || results.loading,
    error: !results.loading && !results.data.length ? results.error : undefined,
    completed: results.completed,
    retry,
  }
}
