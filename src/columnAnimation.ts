import { columnHeight } from './metrics'
import type { Dataset, PricePoint } from './types'

export const GROW_DURATION = 700

export interface AnimatedColumn {
  point: PricePoint
  from: number
  to: number
  started: number
}

export function animatedHeight(column: AnimatedColumn, now: number) {
  const progress = Math.max(0, Math.min(1, (now - column.started) / GROW_DURATION))
  return column.from + (column.to - column.from) * (1 - (1 - progress) ** 3)
}

export class ColumnAnimation {
  columns: AnimatedColumn[] = []
  private history = new Map<string, AnimatedColumn>()

  update(points: PricePoint[], dataset: Dataset, now: number, animate: boolean) {
    this.columns = points.map((point) => {
      const key = `${dataset}:${point.id}`
      const previous = this.history.get(key)
      const to = columnHeight(point, dataset)
      let column: AnimatedColumn
      if (previous?.to === to) {
        column = { ...previous, point }
      } else {
        const delay = previous
          ? 0
          : [...point.id].reduce((hash, letter) => (hash * 31 + letter.charCodeAt(0)) % 81, 0)
        column = {
          point,
          from: animate ? (previous ? animatedHeight(previous, now) : 0) : to,
          to,
          started: now + delay,
        }
      }
      this.history.delete(key)
      this.history.set(key, column)
      return column
    })
    const limit = Math.max(10_000, points.length)
    while (this.history.size > limit) {
      const oldest = this.history.keys().next().value
      if (oldest === undefined) break
      this.history.delete(oldest)
    }
    if (!animate) this.finish()
  }

  grow(now: number) {
    for (const column of this.columns) {
      column.from = 0
      column.started = now
    }
  }

  finish() {
    for (const column of this.history.values()) column.from = column.to
  }

  isAnimating(now: number) {
    return this.columns.some(
      (column) => column.from !== column.to && now < column.started + GROW_DURATION,
    )
  }
}
