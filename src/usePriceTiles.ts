import { type UseQueryResult, useQueries, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { datasetsForYear, mergeLandPoints } from './landPrices'
import { createTileQueries, priceTileKey, type TileError } from './tileQueries'
import { clipBounds, inBounds, surroundingTiles, tilesForBounds } from './tiles'
import { DEFAULT_TRANSACTION_TYPE } from './transactions'
import type {
  Bounds,
  DataResponse,
  DisplayDataset,
  PricePoint,
  TileResponse,
  TransactionType,
} from './types'

function combineTiles(results: UseQueryResult<TileResponse, TileError>[]) {
  return {
    data: results.flatMap((result) => (result.data ? [result.data] : [])),
    loading: results.some((result) => result.isPending || result.isFetching),
    failed: results.filter((result) => result.isError).length,
    error: results.find((result) => result.error)?.error?.message,
    completed: results.filter((result) => result.data || result.isError).length,
  }
}

export function usePriceTiles(
  bounds: Bounds | undefined,
  dataset: DisplayDataset,
  year: number,
  transactionType: TransactionType = DEFAULT_TRANSACTION_TYPE,
  comparePrevious = false,
) {
  const queryClient = useQueryClient()
  const [requests] = useState(() => createTileQueries())
  const clipped = useMemo(() => (bounds ? clipBounds(bounds) : undefined), [bounds])
  const tiles = useMemo(() => (clipped ? tilesForBounds(clipped) : []), [clipped])
  const neighbors = useMemo(() => surroundingTiles(tiles ?? []), [tiles])
  const sources = useMemo(() => datasetsForYear(dataset, year), [dataset, year])
  const visibleRequests = useMemo(
    () => (tiles ?? []).flatMap((tile) => sources.map((source) => ({ source, tile, year }))),
    [sources, tiles, year],
  )
  const comparisonRequests = useMemo(
    () =>
      dataset === 'transactions' && comparePrevious && year > 2005
        ? (tiles ?? []).map((tile) => ({ source: dataset, tile, year: year - 1 }))
        : [],
    [dataset, comparePrevious, year, tiles],
  )
  const allRequests = useMemo(
    () => [...visibleRequests, ...comparisonRequests],
    [visibleRequests, comparisonRequests],
  )
  const neighborRequests = useMemo(
    () => neighbors.flatMap((tile) => sources.map((source) => ({ source, tile }))),
    [sources, neighbors],
  )
  const keys = useMemo(
    () =>
      allRequests.map(({ source, tile, year: requestYear }) =>
        JSON.stringify(priceTileKey(source, requestYear, tile, transactionType)),
      ),
    [allRequests, transactionType],
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
        JSON.stringify(priceTileKey(source, year, tile, transactionType)),
      ),
    ])
    void queryClient.cancelQueries({
      predicate: (query) =>
        query.queryKey[0] === 'price-tile' &&
        query.getObserversCount() === 0 &&
        !wanted.has(JSON.stringify(query.queryKey)),
    })
  }, [requests, queryClient, keys, neighborRequests, year, transactionType])

  const combined = useQueries({
    queries: allRequests.map(({ source, tile, year: requestYear }) => ({
      ...requests.options(source, requestYear, tile, transactionType),
      enabled: settledView === viewKey,
    })),
    combine: useCallback(
      (results: UseQueryResult<TileResponse, TileError>[]) => ({
        current: combineTiles(results.slice(0, visibleRequests.length)),
        previous: combineTiles(results.slice(visibleRequests.length)),
      }),
      [visibleRequests.length],
    ),
  })
  const results = combined.current
  const previous = combined.previous
  const loading = !bounds || results.loading || previous.loading

  useEffect(() => {
    if (settledView !== viewKey || loading || results.failed || previous.failed || !tiles?.length)
      return
    const timer = window.setTimeout(() => {
      for (const { source, tile } of neighborRequests) {
        void queryClient.prefetchQuery(requests.options(source, year, tile, transactionType))
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [
    settledView,
    viewKey,
    loading,
    results.failed,
    previous.failed,
    tiles,
    neighborRequests,
    queryClient,
    requests,
    year,
    transactionType,
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
      transactionType: dataset === 'transactions' ? transactionType : undefined,
      year,
      fetchedAt: results.data.map((tile) => tile.fetchedAt).sort()[0] ?? '',
      tiles: allRequests.length,
      failedTiles: results.failed,
      zoomRequired: tiles === undefined,
      message:
        tiles === undefined
          ? '見たい地域を拡大すると、価格データが表示されます。'
          : results.failed
            ? `一部の地域を取得できませんでした。集計は取得済みの地点のみです。`
            : previous.failed
              ? '前年の取引を取得できませんでした。前年比は表示していません。'
              : undefined,
    }
  }, [
    results.data,
    results.failed,
    previous.failed,
    clipped,
    dataset,
    year,
    tiles,
    allRequests.length,
    transactionType,
  ])

  const previousPoints = useMemo(() => {
    const unique = new Map<string, PricePoint>()
    for (const tile of previous.data) {
      for (const point of tile.points) {
        if (clipped && inBounds(point.coordinates, clipped)) unique.set(point.id, point)
      }
    }
    return [...unique.values()]
  }, [previous.data, clipped])

  const retry = useCallback(() => {
    for (const { source, tile, year: requestYear } of allRequests) {
      const queryKey = priceTileKey(source, requestYear, tile, transactionType)
      const state = queryClient.getQueryState(queryKey)
      if (!state?.data || state.status === 'error') {
        void queryClient.resetQueries({ queryKey, exact: true })
      }
    }
  }, [allRequests, queryClient, transactionType])

  return {
    data,
    loading,
    previousPoints,
    comparisonStatus:
      !comparePrevious || loading
        ? ('loading' as const)
        : results.failed || previous.failed
          ? ('error' as const)
          : ('ready' as const),
    error: !results.loading && !results.data.length ? results.error : undefined,
    completed: results.completed + previous.completed,
    requests,
    retry,
  }
}
