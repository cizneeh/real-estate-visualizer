import { type UseQueryResult, useQueries, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { datasetsForYear, mergeLandPoints } from './landPrices'
import { createTileQueries, priceTileKey, type TileError } from './tileQueries'
import { clipBounds, inBounds, surroundingTiles, tilesForBounds } from './tiles'
import type { Bounds, DataResponse, DisplayDataset, PricePoint, TileResponse } from './types'

function combineTiles(results: UseQueryResult<TileResponse, TileError>[]) {
  return {
    data: results.flatMap((result) => (result.data ? [result.data] : [])),
    loading: results.some((result) => result.isPending || result.isFetching),
    failed: results.filter((result) => result.isError).length,
    error: results.find((result) => result.error)?.error?.message,
    completed: results.filter((result) => result.data || result.isError).length,
  }
}

export function usePriceTiles(bounds: Bounds | undefined, dataset: DisplayDataset, year: number) {
  const queryClient = useQueryClient()
  const [requests] = useState(() => createTileQueries())
  const clipped = useMemo(() => (bounds ? clipBounds(bounds) : undefined), [bounds])
  const tiles = useMemo(() => (clipped ? tilesForBounds(clipped) : []), [clipped])
  const neighbors = useMemo(() => surroundingTiles(tiles ?? []), [tiles])
  const sources = useMemo(() => datasetsForYear(dataset, year), [dataset, year])
  const visibleRequests = useMemo(
    () => (tiles ?? []).flatMap((tile) => sources.map((source) => ({ source, tile }))),
    [sources, tiles],
  )
  const neighborRequests = useMemo(
    () => neighbors.flatMap((tile) => sources.map((source) => ({ source, tile }))),
    [sources, neighbors],
  )
  const keys = useMemo(
    () =>
      visibleRequests.map(({ source, tile }) => JSON.stringify(priceTileKey(source, year, tile))),
    [year, visibleRequests],
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
      ...neighborRequests.map(({ source, tile }) =>
        JSON.stringify(priceTileKey(source, year, tile)),
      ),
    ])
    void queryClient.cancelQueries({
      predicate: (query) =>
        query.queryKey[0] === 'price-tile' &&
        query.getObserversCount() === 0 &&
        !wanted.has(JSON.stringify(query.queryKey)),
    })
  }, [requests, queryClient, keys, neighborRequests, year])

  const results = useQueries({
    queries: visibleRequests.map(({ source, tile }) => ({
      ...requests.options(source, year, tile),
      enabled: settledView === viewKey,
    })),
    combine: combineTiles,
  })

  useEffect(() => {
    if (settledView !== viewKey || results.loading || results.failed || !tiles?.length) return
    const timer = window.setTimeout(() => {
      for (const { source, tile } of neighborRequests) {
        void queryClient.prefetchQuery(requests.options(source, year, tile))
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [
    settledView,
    viewKey,
    results.loading,
    results.failed,
    tiles,
    neighborRequests,
    queryClient,
    requests,
    year,
  ])

  const data = useMemo<DataResponse>(() => {
    const unique = new Map<string, PricePoint>()
    for (const tile of results.data) {
      for (const point of tile.points) {
        unique.set(`${point.source}:${point.id}`, point)
      }
    }
    const merged = dataset === 'land' ? mergeLandPoints([...unique.values()]) : [...unique.values()]
    return {
      points: merged.filter((point) => clipped && inBounds(point.coordinates, clipped)),
      dataset,
      year,
      fetchedAt: results.data.map((tile) => tile.fetchedAt).sort()[0] ?? '',
      tiles: visibleRequests.length,
      failedTiles: results.failed,
      zoomRequired: tiles === undefined,
      message:
        tiles === undefined
          ? '見たい地域を拡大すると、価格データが表示されます。'
          : results.failed
            ? `一部の地域を取得できませんでした。集計は取得済みの地点のみです。`
            : undefined,
    }
  }, [results.data, results.failed, clipped, dataset, year, tiles, visibleRequests.length])

  const retry = useCallback(() => {
    for (const { source, tile } of visibleRequests) {
      const queryKey = priceTileKey(source, year, tile)
      const state = queryClient.getQueryState(queryKey)
      if (!state?.data || state.status === 'error') {
        void queryClient.resetQueries({ queryKey, exact: true })
      }
    }
  }, [year, visibleRequests, queryClient])

  return {
    data,
    loading: !bounds || results.loading,
    error: !results.loading && !results.data.length ? results.error : undefined,
    completed: results.completed,
    requests,
    retry,
  }
}
