import { groupTransactions, median, transactionStationId } from './metrics'
import type { PricePoint } from './types'

export const MIN_COMPARISON_COUNT = 5
export const TRANSACTION_COMPARISON_NOTE =
  '年ごとに取引された物件が異なります。立地・面積・築年数などの違いでも変動するため、同じ物件の値上がり率ではありません。'

export interface TransactionPeriod {
  year: number
  startQuarter: number
  endQuarter: number
}

export type ComparisonStatus =
  | 'loading'
  | 'error'
  | 'earliest'
  | 'no-period'
  | 'insufficient'
  | 'ready'

export interface TransactionSummary {
  records: PricePoint[]
  current: PricePoint[]
  previous: PricePoint[]
  excludedCount: number
  period?: TransactionPeriod
  currentMedian?: number
  previousMedian?: number
  change?: number
  status: ComparisonStatus
}

export function transactionQuarter(point: PricePoint, year: number): number | undefined {
  const match = point.period
    ?.normalize('NFKC')
    .replace(/\s/g, '')
    .match(/^(\d{4})年第([1-4])四半期$/)
  return match && Number(match[1]) === year ? Number(match[2]) : undefined
}

export function transactionPeriodLabel(period: TransactionPeriod, year = period.year): string {
  return `${year}年${(period.startQuarter - 1) * 3 + 1}〜${period.endQuarter * 3}月`
}

export function transactionComparisonLabel(period?: TransactionPeriod): string {
  return period
    ? `${transactionPeriodLabel(period)} / ${transactionPeriodLabel(period, period.year - 1)}`
    : '比較期間のデータなし'
}

export function summarizeTransactions(
  records: PricePoint[],
  previousRecords: PricePoint[],
  year: number,
  availability: 'loading' | 'error' | 'ready',
) {
  const latestQuarter = records.reduce(
    (latest, point) => Math.max(latest, transactionQuarter(point, year) ?? 0),
    0,
  )
  const startQuarter = year <= 2006 ? 3 : 1
  const period: TransactionPeriod | undefined =
    latestQuarter >= startQuarter ? { year, startQuarter, endQuarter: latestQuarter } : undefined
  const grouped = groupTransactions(records)
  const summaries = new Map<string, TransactionSummary>()
  for (const [items, previous] of [
    [records, false],
    [previousRecords, true],
  ] as const) {
    for (const point of items) {
      const id = transactionStationId(point)
      let summary = summaries.get(id)
      if (!summary) {
        summary = {
          records: [],
          current: [],
          previous: [],
          excludedCount: 0,
          period,
          status: 'no-period',
        }
        summaries.set(id, summary)
      }
      if (!previous) summary.records.push(point)
      const quarter = transactionQuarter(point, previous ? year - 1 : year)
      if (quarter === undefined) summary.excludedCount++
      if (
        period &&
        quarter !== undefined &&
        quarter >= period.startQuarter &&
        quarter <= period.endQuarter
      ) {
        ;(previous ? summary.previous : summary.current).push(point)
      }
    }
  }
  for (const summary of summaries.values()) {
    summary.currentMedian = median(summary.current.map((point) => point.price))
    summary.previousMedian = median(summary.previous.map((point) => point.price))
    summary.status =
      year <= 2005
        ? 'earliest'
        : availability !== 'ready'
          ? availability
          : !period
            ? 'no-period'
            : summary.current.length < MIN_COMPARISON_COUNT ||
                summary.previous.length < MIN_COMPARISON_COUNT
              ? 'insufficient'
              : 'ready'
    if (
      summary.status === 'ready' &&
      summary.currentMedian !== undefined &&
      summary.previousMedian &&
      summary.previousMedian > 0
    ) {
      summary.change = (summary.currentMedian / summary.previousMedian - 1) * 100
    }
  }
  return {
    points: grouped.map((point) => ({ ...point, change: summaries.get(point.id)?.change })),
    summaries,
    period: availability === 'ready' ? period : undefined,
  }
}
