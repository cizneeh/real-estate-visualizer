import type { Feature, Point } from 'geojson'
import { inBounds } from '../src/tiles'
import { JAPAN_BOUNDS, type LegacyDataset, type PricePoint } from '../src/types'

export { clipBounds, inBounds, tilesForBounds } from '../src/tiles'

export function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || !value.trim()) return undefined
  const normalized = value.normalize('NFKC').replaceAll(',', '')
  if (/以上|以下|未満|超/.test(normalized)) return undefined
  const match = normalized.match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : undefined
}

export function yenValue(value: unknown): number | undefined {
  if (typeof value !== 'string') return numberValue(value)
  const normalized = value.normalize('NFKC').replaceAll(',', '')
  if (/[億万]/.test(normalized)) {
    const oku = normalized.match(/([\d.]+)億/)
    const man = normalized.match(/([\d.]+)万/)
    return (oku ? Number(oku[1]) * 100_000_000 : 0) + (man ? Number(man[1]) * 10_000 : 0)
  }
  return numberValue(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function normalizePoint(
  feature: Feature,
  dataset: LegacyDataset,
  index: number | string,
): PricePoint | undefined {
  if (feature.geometry?.type !== 'Point') return undefined
  const coordinates = (feature.geometry as Point).coordinates as [number, number]
  if (!coordinates.slice(0, 2).every(Number.isFinite)) return undefined
  if (!inBounds(coordinates, JAPAN_BOUNDS)) return undefined
  const p = feature.properties ?? {}
  if (dataset === 'transactions') {
    const area = numberValue(p.u_area_ja)
    const totalPrice = yenValue(p.u_transaction_price_total_ja)
    const price =
      yenValue(p.u_transaction_price_unit_price_square_meter_ja) ??
      (area && totalPrice ? totalPrice / area : undefined)
    if (!price || price <= 0) return undefined
    return {
      id: `transaction-${coordinates.join(',')}-${index}`,
      coordinates,
      price,
      address: [p.city_name_ja, p.district_name_ja].filter(Boolean).join(''),
      municipality: stringValue(p.city_name_ja) ?? '',
      category: stringValue(p.land_type_name_ja) ?? '中古マンション等',
      totalPrice,
      area,
      period: stringValue(p.point_in_time_name_ja),
      usage: stringValue(p.floor_plan_name_ja),
      zoning: stringValue(p.land_use_name_ja),
    }
  }
  const price = numberValue(p.u_current_years_price_ja)
  if (!price || price <= 0 || p.pause_flag === 1) return undefined
  return {
    id: `${p.land_price_type}-${p.point_id ?? p.standard_lot_number_ja ?? index}`,
    historyId:
      p.point_id === undefined || p.point_id === null
        ? undefined
        : `${p.land_price_type}-${p.point_id}`,
    location: stringValue(p.location),
    coordinates,
    price,
    previousPrice: numberValue(p.last_years_price),
    change: numberValue(p.year_on_year_change_rate),
    address:
      stringValue(p.residence_display_name_ja) ??
      stringValue(p.location) ??
      [p.city_county_name_ja, p.ward_town_village_name_ja, p.location_number_ja]
        .filter(Boolean)
        .join(''),
    municipality: [p.city_county_name_ja, p.ward_town_village_name_ja].filter(Boolean).join(''),
    category: (stringValue(p.use_category_name_ja) ?? 'その他').replace(/^\d+[,、]/, ''),
    station: stringValue(p.nearest_station_name_ja),
    stationDistance: stringValue(p.u_road_distance_to_nearest_station_name_ja),
    area: numberValue(p.u_cadastral_ja),
    usage: stringValue(p.usage_status_name_ja),
    zoning: stringValue(p.regulations_use_category_name_ja),
    period: stringValue(p.target_year_name_ja),
  }
}
