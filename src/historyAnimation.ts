import { type HistoryEntry, historySegments } from './history'

export interface HistoryLineReveal {
  startYear: number
  endYear: number
  reverse: boolean
  delay: number
  duration: number
}

export function historyLineReveals(entries: HistoryEntry[], previousYears: Set<number>) {
  const reveals: HistoryLineReveal[] = []
  for (const segment of historySegments(entries)) {
    const anchors = segment.flatMap((entry, i) => (previousYears.has(entry.year) ? [i] : []))
    if (!anchors.length) anchors.push(0)
    const distances = segment.map((_, i) =>
      Math.min(...anchors.map((anchor) => Math.abs(i - anchor))),
    )
    const steps = segment.slice(1).flatMap((entry, i) =>
      previousYears.has(segment[i].year) && previousYears.has(entry.year)
        ? []
        : [
            {
              startYear: segment[i].year,
              endYear: entry.year,
              reverse: distances[i] > distances[i + 1],
              step: Math.min(distances[i], distances[i + 1]),
            },
          ],
    )
    const duration = Math.min(480, 900 / Math.max(1, ...steps.map(({ step }) => step + 1)))
    for (const { step, ...edge } of steps) {
      reveals.push({ ...edge, delay: step * duration, duration })
    }
  }
  return reveals.sort((a, b) => a.delay - b.delay)
}
