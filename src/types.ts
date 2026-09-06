export type Dataset = 'land' | 'survey' | 'change' | 'transactions'
export type ViewMode = '3d' | 'points' | 'heatmap'
export type Bounds = [number, number, number, number]

export interface PricePoint {
  id: string
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
  dataset: Dataset
  fetchedAt: string
  tiles: number
  failedTiles: number
  message?: string
}

export const STUDY_BOUNDS: Bounds = [139.35, 35.57, 139.88, 35.83]

export const PLACES = [
  { name: '東京全体', center: [139.625, 35.705] as [number, number], zoom: 10.8 },
  { name: '都心', center: [139.757, 35.681] as [number, number], zoom: 12.7 },
  { name: '新宿', center: [139.7, 35.692] as [number, number], zoom: 13 },
  { name: '吉祥寺', center: [139.579, 35.703] as [number, number], zoom: 13 },
  { name: '国分寺', center: [139.4805, 35.702] as [number, number], zoom: 13 },
  { name: '立川', center: [139.413, 35.699] as [number, number], zoom: 13 },
]
