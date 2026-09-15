import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MapGeoJSONFeature } from 'maplibre-gl'
import { navigationTarget } from '../src/mapNavigation'

function place(
  name: string,
  kind: string,
): Pick<MapGeoJSONFeature, 'layer' | 'geometry' | 'properties'> {
  return {
    properties: { name, class: kind },
    geometry: { type: 'Point', coordinates: [139.7, 35.6] },
    layer: { id: `place_${kind}`, type: 'symbol', source: 'openmaptiles', 'source-layer': 'place' },
  }
}

test('東京都 is treated as a prefecture even when the basemap classifies it as a city', () => {
  const prefecture = navigationTarget(place('東京都', 'city'))
  const municipality = navigationTarget(place('横浜市', 'city'))
  assert.ok(prefecture && municipality)
  assert.ok(prefecture.zoom < municipality.zoom)
  assert.deepEqual(prefecture.center, [139.7, 35.6])
})

test('ward labels are navigable while neighbourhood names and country labels are not', () => {
  assert.ok(navigationTarget(place('中央区', 'suburb')))
  assert.ok(navigationTarget(place('千代田区', 'neighbourhood')))
  assert.equal(navigationTarget(place('丸の内', 'suburb')), undefined)
  assert.equal(navigationTarget(place('日本', 'country')), undefined)
})

test('missing names, invalid coordinates, and non-point geometry cannot trigger map movement', () => {
  assert.equal(navigationTarget(place('', 'city')), undefined)
  const invalid = place('横浜市', 'city')
  invalid.geometry = { type: 'Point', coordinates: [Number.NaN, 35.6] }
  assert.equal(navigationTarget(invalid), undefined)
  invalid.geometry = {
    type: 'LineString',
    coordinates: [
      [139, 35],
      [140, 36],
    ],
  }
  assert.equal(navigationTarget(invalid), undefined)
})
