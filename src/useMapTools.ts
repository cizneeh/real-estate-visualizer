import { useEffect, useRef } from 'react'
import { TRANSACTION_COMPARISON_NOTE, type TransactionPeriod } from './transactionComparison'
import { TRANSACTION_TYPES } from './transactions'
import type { Bounds, Dataset, Metric, PricePoint, TransactionType } from './types'

interface MapState {
  dataset: Dataset
  transactionType?: TransactionType
  metric: Metric
  year: number
  bounds?: Bounds
  loading: boolean
  error?: string
  points: PricePoint[]
  comparisonPeriod?: TransactionPeriod
}

interface ModelContext {
  registerTool: (
    tool: {
      name: string
      title: string
      description: string
      inputSchema: object
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }
      execute: (input: unknown) => unknown
    },
    options: { signal: AbortSignal },
  ) => void | Promise<void>
}

export function useMapTools(state: MapState) {
  const latest = useRef(state)
  latest.current = state
  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext
    if (!context?.registerTool) return
    const lifecycle = new AbortController()
    const tool = {
      name: 'read_visible_prices',
      title: '表示中の不動産価格を読む',
      description:
        '現在の地図範囲・年度・用途フィルターで表示している実データを、価格が高い順に読みます。表示は変更しません。',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input: unknown) {
        if (!input || typeof input !== 'object' || Array.isArray(input))
          throw new Error('オブジェクトを指定してください。')
        const params = input as Record<string, unknown>
        const limit = params.limit ?? 20
        if (
          Object.keys(params).some((key) => key !== 'limit') ||
          typeof limit !== 'number' ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 100
        )
          throw new Error('limit は1〜100の整数で指定してください。')
        const current = latest.current
        if (current.loading || current.error)
          return { status: current.loading ? 'loading' : 'error', message: current.error }
        return {
          status: 'ready',
          dataset: current.dataset,
          transactionType: current.transactionType,
          priceMeaning: current.transactionType
            ? TRANSACTION_TYPES[current.transactionType].priceMeaning
            : undefined,
          metric: current.metric,
          comparisonYears:
            current.metric === 'change' ? [current.year - 1, current.year] : undefined,
          comparisonPeriod: current.comparisonPeriod,
          comparisonNote:
            current.dataset === 'transactions' ? TRANSACTION_COMPARISON_NOTE : undefined,
          year: current.year,
          bounds: current.bounds,
          totalPoints: current.points.length,
          priceUnit: 'JPY/m²',
          locationMeaning:
            current.dataset === 'transactions'
              ? '最寄り駅座標。価格は駅単位の中央値。'
              : '標準地・基準地の位置',
          points: [...current.points].sort((a, b) => b.price - a.price).slice(0, limit),
          source: 'https://www.reinfolib.mlit.go.jp/help/apiManual/',
        }
      },
    }
    try {
      Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {
        console.warn('Optional map tools could not be registered.')
      })
    } catch {
      console.warn('Optional map tools are unavailable in this browser.')
    }
    return () => lifecycle.abort()
  }, [])
}
