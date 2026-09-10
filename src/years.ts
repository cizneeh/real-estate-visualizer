import type { Dataset } from './types'

// Source: https://www.reinfolib.mlit.go.jp/help/apiManual/
export const FIRST_YEAR: Record<Dataset, number> = {
  land: 1995,
  change: 1995,
  survey: 1997,
  transactions: 2005,
}

export const LAST_YEAR = new Date().getFullYear()

export function yearsForDataset(dataset: Dataset) {
  return Array.from(
    { length: LAST_YEAR - FIRST_YEAR[dataset] + 1 },
    (_, i) => FIRST_YEAR[dataset] + i,
  )
}

export function validYear(dataset: Dataset, year: number) {
  // Workers initializes module-level dates at the Unix epoch; read the year during the request.
  return Number.isInteger(year) && year >= FIRST_YEAR[dataset] && year <= new Date().getFullYear()
}
