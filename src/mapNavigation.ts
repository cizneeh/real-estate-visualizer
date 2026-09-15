import type { Map as LibreMap, MapGeoJSONFeature } from 'maplibre-gl'

interface NavigationTarget {
  kind: 'station' | 'place'
  center: [number, number]
  zoom: number
  name: string
}

export interface NavigationHit extends NavigationTarget {
  feature: MapGeoJSONFeature
}

export function navigationTarget(
  feature: Pick<MapGeoJSONFeature, 'layer' | 'geometry' | 'properties'>,
): NavigationTarget | undefined {
  if (feature.layer.type !== 'symbol') return undefined
  const properties = feature.properties
  const name = properties?.['name:ja'] || properties?.name
  if (typeof name !== 'string' || !name.trim()) return undefined
  const geometry = feature.geometry
  const coordinates =
    geometry.type === 'Point'
      ? geometry.coordinates
      : geometry.type === 'MultiPoint'
        ? geometry.coordinates[0]
        : undefined
  if (!coordinates || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1]))
    return undefined
  const center: [number, number] = [coordinates[0], coordinates[1]]
  if (Math.abs(center[0]) > 180 || Math.abs(center[1]) > 85) return undefined
  if (feature.layer.id === 'station-labels' || feature.layer.id === 'major-station-labels') {
    return { kind: 'station', center, zoom: 14.5, name: name.endsWith('駅') ? name : `${name}駅` }
  }
  if (feature.layer['source-layer'] !== 'place') return undefined
  if (properties.class === 'state' || /[都道府県]$/.test(name))
    return { kind: 'place', center, zoom: 8, name }
  if (['city', 'town', 'village'].includes(properties.class))
    return { kind: 'place', center, zoom: 12, name }
  if (['suburb', 'neighbourhood'].includes(properties.class) && /[市区町村]$/.test(name))
    return { kind: 'place', center, zoom: 13, name }
  return undefined
}

export function navigationLayers(map: LibreMap): string[] {
  return map
    .getStyle()
    .layers.filter(
      (layer) =>
        layer.type === 'symbol' &&
        (layer.id === 'station-labels' ||
          layer.id === 'major-station-labels' ||
          layer['source-layer'] === 'place'),
    )
    .map((layer) => layer.id)
}

export function hitNavigationTarget(
  map: LibreMap,
  screen: { x: number; y: number },
  layers: string[],
): NavigationHit | undefined {
  const features = map.queryRenderedFeatures([screen.x, screen.y], { layers })
  for (const feature of features) {
    const target = navigationTarget(feature)
    if (target) return { ...target, feature }
  }
  return undefined
}

export function navigateToLabel(map: LibreMap, target: NavigationTarget) {
  map.flyTo({
    center: target.center,
    zoom: target.kind === 'station' ? target.zoom : Math.max(map.getZoom(), target.zoom),
    duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1100,
  })
}
