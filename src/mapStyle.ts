import type { Map as LibreMap } from 'maplibre-gl'

const FILL_COLORS: Record<string, string> = {
  water: '#091321',
  landcover: '#142333',
  landuse: '#152235',
  building: '#1b2a3d',
  aeroway: '#223248',
  transportation: '#1b2a3d',
}

const LINE_COLORS: Record<string, string> = {
  waterway: '#25394f',
  highway_path: '#2c3d50',
  highway_minor: '#2c3d50',
  highway_major_casing: '#1b2a3d',
  highway_major_inner: '#4c5d70',
  highway_major_subtle: '#35495e',
  highway_motorway_casing: '#1b2a3d',
  highway_motorway_inner: '#627287',
  highway_motorway_subtle: '#42566d',
}

export function configureBasemap(map: LibreMap) {
  for (const layer of map.getStyle().layers) {
    if (layer.type === 'background') {
      map.setPaintProperty(layer.id, 'background-color', '#101b2d')
    } else if (layer.type === 'fill') {
      map.setPaintProperty(
        layer.id,
        'fill-color',
        FILL_COLORS[layer['source-layer'] ?? ''] ?? '#1b2a3d',
      )
      if (layer.paint?.['fill-pattern']) map.setPaintProperty(layer.id, 'fill-pattern', undefined)
      if (layer['source-layer'] === 'building')
        map.setPaintProperty(layer.id, 'fill-outline-color', '#293b50')
      if (layer.id === 'landuse_park') map.setPaintProperty(layer.id, 'fill-color', '#182b38')
    } else if (layer.type === 'line') {
      const color = layer.id.startsWith('railway')
        ? layer.id.endsWith('dashline')
          ? '#101b2d'
          : '#536479'
        : layer['source-layer'] === 'boundary'
          ? '#475b72'
          : (LINE_COLORS[layer.id] ?? '#35495e')
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
      map.setPaintProperty(layer.id, 'text-halo-color', '#101b2d')
      map.setPaintProperty(layer.id, 'text-halo-width', 1.4)
      map.setPaintProperty(layer.id, 'text-halo-blur', 0.5)
    }
  }
}
