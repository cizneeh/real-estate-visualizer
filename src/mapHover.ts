import type { ExpressionSpecification, FeatureIdentifier, Map as LibreMap } from 'maplibre-gl'
import type { NavigationHit } from './mapNavigation'
import type { PricePoint } from './types'

const HOVERED: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false]

export function createMapHover(map: LibreMap, labelLayers: string[]) {
  for (const layer of labelLayers) {
    for (const [property, value] of [
      ['text-color', '#ffffff'],
      ['text-halo-color', '#367e6c'],
      ['text-halo-width', 2.5],
    ] as const) {
      const base = map.getPaintProperty(layer, property)
      if (typeof base !== 'string' && typeof base !== 'number') continue
      map.setPaintProperty(layer, property, ['case', HOVERED, value, base])
    }
  }
  map.setPaintProperty('price-points', 'circle-stroke-width', ['case', HOVERED, 2.5, 0.6])
  map.setPaintProperty('price-points', 'circle-stroke-color', [
    'case',
    HOVERED,
    '#ffffff',
    '#d3ffff',
  ])
  map.setPaintProperty('price-glow', 'circle-opacity', ['case', HOVERED, 0.7, 0.14])

  let hovered: FeatureIdentifier | undefined

  function setFeature(next?: FeatureIdentifier) {
    if (
      hovered?.source === next?.source &&
      hovered?.sourceLayer === next?.sourceLayer &&
      hovered?.id === next?.id
    )
      return
    if (hovered) map.setFeatureState(hovered, { hover: false })
    hovered = next
    if (hovered) map.setFeatureState(hovered, { hover: true })
  }

  function clear() {
    setFeature()
    map.getCanvas().style.cursor = ''
  }

  function show(point?: PricePoint, target?: NavigationHit) {
    if (!point && !target) {
      clear()
      return
    }
    const feature = target?.feature
    setFeature(
      point
        ? { source: 'prices', id: point.id }
        : feature?.id !== undefined
          ? {
              source: feature.source,
              sourceLayer: feature.sourceLayer,
              id: feature.id,
            }
          : undefined,
    )
    map.getCanvas().style.cursor = 'pointer'
  }

  return { show, clear }
}
