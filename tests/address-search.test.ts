import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { NormalizeResult } from '@geolonia/normalize-japanese-addresses'
import { addressResult } from '../src/geocoding'

const point = { lng: 139.775372778, lat: 35.714952981, level: 8 }
const exact: NormalizeResult = {
  pref: '東京都',
  city: '台東区',
  town: '上野公園',
  addr: '7-7',
  other: '',
  level: 8,
  point,
  metadata: { input: '東京都台東区上野公園7-7' },
}

test('番地の座標はMapLibreの経度・緯度順で扱う', () => {
  const result = addressResult(exact)
  assert.deepEqual(result?.coordinates, [139.775372778, 35.714952981])
  assert.equal(result?.label, '東京都台東区上野公園7-7')
  assert.equal(result?.precision, '住居表示・地番の位置')
})

test('番地を読めても座標が町丁目なら番地の位置として表示しない', () => {
  const result = addressResult({ ...exact, point: { ...point, level: 3 } })
  assert.equal(result?.label, '東京都台東区上野公園')
  assert.match(result?.precision ?? '', /町丁目の代表点/)
  assert.ok(result && result.zoom < (addressResult(exact)?.zoom ?? 0))
})

test('市区町村と都道府県は役場・県庁の位置として表示する', () => {
  const city = addressResult({ ...exact, point: { ...point, level: 2 } })
  const pref = addressResult({ ...exact, point: { ...point, level: 1 } })
  assert.equal(city?.label, '東京都台東区')
  assert.equal(city?.precision, '市区町村役場の位置')
  assert.equal(pref?.label, '東京都')
  assert.equal(pref?.precision, '都道府県庁の位置')
  assert.ok(city && pref && pref.zoom < city.zoom)
})

test('位置が未取得・非数値・日本の表示範囲外の結果には移動しない', () => {
  for (const candidate of [
    undefined,
    { lng: Number.NaN, lat: 35, level: 8 },
    { lng: 139, lat: Number.POSITIVE_INFINITY, level: 8 },
    { lng: -74, lat: 40, level: 8 },
    { lng: 139, lat: 35, level: 0 },
  ]) {
    assert.equal(addressResult({ ...exact, point: candidate }), undefined)
  }
})
