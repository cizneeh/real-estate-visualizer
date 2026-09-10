import type { NormalizeResult } from '@geolonia/normalize-japanese-addresses'
import { JAPAN_BOUNDS } from './types'

export interface AddressResult {
  coordinates: [number, number]
  label: string
  precision: string
  zoom: number
}

export function addressResult(result: NormalizeResult): AddressResult | undefined {
  const point = result.point
  if (
    !result.pref ||
    !point ||
    ![1, 2, 3, 8].includes(point.level) ||
    !Number.isFinite(point.lng) ||
    !Number.isFinite(point.lat) ||
    point.lng < JAPAN_BOUNDS[0] ||
    point.lat < JAPAN_BOUNDS[1] ||
    point.lng > JAPAN_BOUNDS[2] ||
    point.lat > JAPAN_BOUNDS[3]
  )
    return undefined

  const label = [
    result.pref,
    point.level >= 2 ? result.city : undefined,
    point.level >= 3 ? result.town : undefined,
    point.level === 8 ? result.addr : undefined,
  ].join('')
  const detail =
    point.level === 8
      ? { precision: '住居表示・地番の位置', zoom: 16 }
      : point.level === 3
        ? { precision: '町丁目の代表点（番地の位置ではありません）', zoom: 14 }
        : point.level === 2
          ? { precision: '市区町村役場の位置', zoom: 11 }
          : { precision: '都道府県庁の位置', zoom: 8 }
  return { coordinates: [point.lng, point.lat], label, ...detail }
}

export async function searchAddress(query: string): Promise<AddressResult | undefined> {
  const { normalize } = await import('@geolonia/normalize-japanese-addresses')
  return addressResult(await normalize(query))
}
