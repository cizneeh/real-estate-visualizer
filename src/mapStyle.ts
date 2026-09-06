import type { Map as LibreMap } from 'maplibre-gl'

const FILL_COLORS: Record<string, string> = {
  water: '#1b3040',
  landcover: '#304b48',
  landuse: '#304651',
  building: '#344b59',
  aeroway: '#3d5361',
  transportation: '#344b59',
}

const LINE_COLORS: Record<string, string> = {
  waterway: '#325669',
  highway_path: '#536d7a',
  highway_minor: '#526b7a',
  highway_major_casing: '#354d5c',
  highway_major_inner: '#80939f',
  highway_major_subtle: '#607d8e',
  highway_motorway_casing: '#354d5c',
  highway_motorway_inner: '#91a0ab',
  highway_motorway_subtle: '#718b9a',
}

export function configureBasemap(map: LibreMap) {
  for (const layer of map.getStyle().layers) {
    if (layer.type === 'background') {
      map.setPaintProperty(layer.id, 'background-color', '#293d4a')
    } else if (layer.type === 'fill') {
      map.setPaintProperty(
        layer.id,
        'fill-color',
        FILL_COLORS[layer['source-layer'] ?? ''] ?? '#344b59',
      )
      if (layer.paint?.['fill-pattern']) map.setPaintProperty(layer.id, 'fill-pattern', undefined)
      if (layer['source-layer'] === 'building')
        map.setPaintProperty(layer.id, 'fill-outline-color', '#415a68')
      if (layer.id === 'landuse_park') map.setPaintProperty(layer.id, 'fill-color', '#36554f')
    } else if (layer.type === 'line') {
      const color = layer.id.startsWith('railway')
        ? layer.id.endsWith('dashline')
          ? '#293d4a'
          : '#8a9eaa'
        : layer['source-layer'] === 'boundary'
          ? '#8098aa'
          : (LINE_COLORS[layer.id] ?? '#617b8b')
      map.setPaintProperty(layer.id, 'line-color', color)
    } else if (layer.type === 'symbol' && layer.layout?.['text-field']) {
      map.setLayoutProperty(layer.id, 'text-field', [
        'coalesce',
        ['get', 'name:ja'],
        ['get', 'name'],
      ])
      map.setPaintProperty(
        layer.id,
        'text-color',
        layer['source-layer'] === 'place' ? '#d3e0e8' : '#afc5d1',
      )
      map.setPaintProperty(layer.id, 'text-halo-color', '#233441')
      map.setPaintProperty(layer.id, 'text-halo-width', 1.4)
      map.setPaintProperty(layer.id, 'text-halo-blur', 0.5)
    }
  }
}
