import { queryOptions } from '@tanstack/react-query'
import { RequestQueue } from './requestQueue'
import { type Tile, tileKey } from './tiles'
import type { Dataset, TileResponse } from './types'

export class TileError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfter = 0,
  ) {
    super(message)
  }
}

export function sourceDataset(dataset: Dataset): Dataset {
  return dataset === 'change' ? 'land' : dataset
}

export const priceTileKey = (dataset: Dataset, year: number, tile: Tile) =>
  ['price-tile', sourceDataset(dataset), year, tileKey(tile)] as const

export function createTileQueries(fetcher = fetch) {
  const queue = new RequestQueue(6, 0, 2)
  let visible = new Set<string>()

  return {
    setVisible(keys: string[]) {
      visible = new Set(keys)
      queue.pump()
    },
    options(dataset: Dataset, year: number, tile: Tile) {
      const queryKey = priceTileKey(dataset, year, tile)
      const priority = () => (visible.has(JSON.stringify(queryKey)) ? 0 : 1)
      return queryOptions<TileResponse, TileError>({
        queryKey,
        staleTime: (query) => (query.state.data?.stale ? 0 : 30 * 60 * 1000),
        gcTime: 60 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: (count, error) => count < 1 && error.status >= 500,
        retryDelay: (_count, error) => Math.max(1000, error.retryAfter * 1000),
        queryFn: ({ signal }) =>
          queue.run(
            async () => {
              const params = new URLSearchParams({
                dataset: sourceDataset(dataset),
                year: String(year),
              })
              const response = await fetcher(`/api/tiles/${tileKey(tile)}?${params}`, {
                signal,
                headers: { 'X-Price-Priority': priority() === 0 ? 'visible' : 'background' },
              })
              const result = await response.json()
              if (!response.ok) {
                throw new TileError(
                  result.error ?? 'データの取得に失敗しました。',
                  result.upstreamStatus ?? response.status,
                  Number(response.headers.get('Retry-After')) || 0,
                )
              }
              return result as TileResponse
            },
            signal,
            priority,
          ),
      })
    },
  }
}
