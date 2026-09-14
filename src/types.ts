export type Dataset = 'land' | 'survey' | 'transactions'
export type DisplayDataset = Exclude<Dataset, 'survey'>
export type LandSource = Exclude<Dataset, 'transactions'>
export type LegacyDataset = Dataset | 'change'
export type Metric = 'price' | 'change'
export type ViewMode = '3d' | 'points' | 'heatmap'
export type Bounds = [number, number, number, number]

export interface PricePoint {
  id: string
  source?: LandSource
  historyId?: string
  location?: string
  coordinates: [number, number]
  price: number
  change?: number
  previousPrice?: number
  address: string
  municipality: string
  category: string
  station?: string
  stationDistance?: string
  area?: number
  usage?: string
  zoning?: string
  totalPrice?: number
  period?: string
  count?: number
}

export interface DataResponse {
  points: PricePoint[]
  year: number
  dataset: LegacyDataset
  fetchedAt: string
  tiles: number
  failedTiles: number
  message?: string
  zoomRequired?: boolean
}

export interface TileResponse {
  points: PricePoint[]
  fetchedAt: string
  stale?: boolean
}

export const JAPAN_BOUNDS: Bounds = [122, 20, 154, 46]
