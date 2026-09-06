import type { FeatureCollection, Point } from 'geojson'
import type { ExpressionSpecification, Map as LibreMap } from 'maplibre-gl'
import { MAJOR_STATIONS } from './majorStations'

const STATION_LABEL: ExpressionSpecification = [
  'let',
  'stationName',
  ['coalesce', ['get', 'name:ja'], ['get', 'name'], ''],
  [
    'case',
    ['==', ['var', 'stationName'], ''],
    '',
    ['==', ['slice', ['var', 'stationName'], -1], '駅'],
    ['var', 'stationName'],
    ['concat', ['var', 'stationName'], '駅'],
  ],
]

const MAJOR_STATION_DATA: FeatureCollection<Point> = {
  type: 'FeatureCollection',
  features: MAJOR_STATIONS.map(([name, longitude, latitude, priority]) => ({
    type: 'Feature',
    properties: { name, priority },
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
  })),
}

const STATION_PRIORITY: ExpressionSpecification = [
  'match',
  ['get', 'name'],
  MAJOR_STATIONS.filter((station) => station[3] === 0).map(([name]) => name),
  0,
  MAJOR_STATIONS.filter((station) => station[3] === 1).map(([name]) => name),
  100,
  MAJOR_STATIONS.filter((station) => station[3] === 2).map(([name]) => name),
  200,
  500,
]

const IS_MAJOR_STATION: ExpressionSpecification = [
  'in',
  ['get', 'name'],
  ['literal', MAJOR_STATIONS.map(([name]) => name)],
]

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

  map.addLayer({
    id: 'station-labels',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'poi',
    minzoom: 12,
    filter: ['==', ['get', 'class'], 'railway'],
    layout: {
      'text-field': STATION_LABEL,
      'text-font': ['Noto Sans Regular'],
      'text-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        12,
        ['case', IS_MAJOR_STATION, 14, 12],
        15,
        ['case', IS_MAJOR_STATION, 16, 14],
        17,
        ['case', IS_MAJOR_STATION, 18, 16],
      ],
      'text-padding': ['interpolate', ['linear'], ['zoom'], 12, 24, 14, 16, 17, 6],
      'text-offset': [0, 0.6],
      'symbol-sort-key': ['+', STATION_PRIORITY, ['coalesce', ['get', 'rank'], 0]],
    },
    paint: {
      'text-color': '#c4e9f4',
      'text-halo-color': '#233441',
      'text-halo-width': 1.8,
      'text-halo-blur': 0.5,
    },
  })

  map.addSource('major-stations', { type: 'geojson', data: MAJOR_STATION_DATA })
  map.addLayer({
    id: 'major-station-labels',
    type: 'symbol',
    source: 'major-stations',
    minzoom: 8,
    maxzoom: 12,
    filter: [
      'step',
      ['zoom'],
      ['<=', ['get', 'priority'], 0],
      9,
      ['<=', ['get', 'priority'], 1],
      10,
      true,
    ],
    layout: {
      'text-field': STATION_LABEL,
      'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 8, 12, 10, 13, 12, 14],
      'text-padding': 8,
      'text-variable-anchor': ['bottom', 'top', 'left', 'right'],
      'text-radial-offset': 0.5,
      'symbol-sort-key': ['get', 'priority'],
    },
    paint: {
      'text-color': '#c4e9f4',
      'text-halo-color': '#233441',
      'text-halo-width': 1.8,
      'text-halo-blur': 0.5,
    },
  })
}
