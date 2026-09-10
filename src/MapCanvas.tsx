import type { GeoJSONSource, Map as LibreMap } from 'maplibre-gl'
import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useRef, useState } from 'react'
import { configureBasemap } from './mapStyle'
import { PRICE_COLORS, pointCollection } from './metrics'
import { PriceColumnLayer } from './PriceColumnLayer'
import {
  type Bounds,
  type Dataset,
  JAPAN_BOUNDS,
  type Metric,
  type PricePoint,
  type ViewMode,
} from './types'
import 'maplibre-gl/dist/maplibre-gl.css'

maplibregl.setWorkerUrl(workerUrl)

const TOKYO_CENTER: [number, number] = [139.7671, 35.6812]

interface Props {
  points: PricePoint[]
  dataset: Dataset
  metric: Metric
  mode: ViewMode
  position?: [number, number]
  selectedId?: string
  onBounds: (bounds: Bounds) => void
  onSelect: (point: PricePoint) => void
  onReady: (map: LibreMap) => void
  onRendered: (ready: boolean) => void
}

export function MapCanvas(props: Props) {
  const container = useRef<HTMLElement>(null)
  const mapRef = useRef<LibreMap | undefined>(undefined)
  const columnsRef = useRef<PriceColumnLayer | undefined>(undefined)
  const latest = useRef(props)
  latest.current = props
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!container.current) return
    let map: LibreMap
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: 'https://tiles.openfreemap.org/styles/dark',
        center: latest.current.position ?? TOKYO_CENTER,
        zoom: 13,
        maxBounds: JAPAN_BOUNDS,
        pitch: latest.current.mode === '3d' ? 48 : 0,
        bearing: 0,
        minZoom: 2,
        maxZoom: 17,
        maxPitch: 65,
        renderWorldCopies: false,
        attributionControl: { compact: true },
        canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
      })
    } catch {
      setError('地図の描画を開始できませんでした。WebGLが利用できるブラウザで開いてください。')
      return
    }
    mapRef.current = map
    map.on('idle', () => {
      if (map.getSource('prices') && map.isSourceLoaded('prices')) {
        container.current?.setAttribute('data-rendered', 'true')
        latest.current.onRendered(true)
      }
    })
    const emitBounds = () => {
      const b = map.getBounds()
      latest.current.onBounds([
        Math.max(-180, b.getWest()),
        Math.max(-85, b.getSouth()),
        Math.min(180, b.getEast()),
        Math.min(85, b.getNorth()),
      ])
    }
    map.on('load', () => {
      map.addSource('prices', { type: 'geojson', data: pointCollection([], 'price') })
      map.addLayer({
        id: 'price-heat',
        type: 'heatmap',
        source: 'prices',
        layout: { visibility: 'none' },
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'price'], 0, 0, 10_000_000, 1],
          'heatmap-intensity': 1.1,
          'heatmap-radius': 32,
          'heatmap-opacity': 0.75,
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0,
            'rgba(86,143,175,0)',
            0.2,
            PRICE_COLORS[0],
            0.45,
            PRICE_COLORS[1],
            0.65,
            PRICE_COLORS[2],
            0.85,
            PRICE_COLORS[4],
            1,
            PRICE_COLORS[5],
          ],
        },
      })
      map.addLayer({
        id: 'price-glow',
        type: 'circle',
        source: 'prices',
        paint: {
          'circle-radius': 9,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.14,
          'circle-blur': 0.8,
        },
      })
      map.addLayer({
        id: 'price-points',
        type: 'circle',
        source: 'prices',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 6],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.95,
          'circle-stroke-width': 0.6,
          'circle-stroke-color': '#d3ffff',
        },
      })
      const columns = new PriceColumnLayer()
      columnsRef.current = columns
      map.addLayer(columns)
      configureBasemap(map)
      map.on('webglcontextrestored', () => {
        map.once('style.load', () => {
          if (!map.getLayer(columns.id)) map.addLayer(columns, 'station-labels')
          columns.setData(latest.current.points, latest.current.dataset, latest.current.metric)
          columns.setVisible(latest.current.mode === '3d')
          columns.setSelected(latest.current.selectedId)
        })
      })
      const hitPoint = (screen: { x: number; y: number }) => {
        const column = columns.pick(screen)
        if (column) return column
        if (latest.current.mode === '3d') return undefined
        const features = map.queryRenderedFeatures([screen.x, screen.y], {
          layers: ['price-points'],
        })
        const id = features[0]?.properties?.id
        return latest.current.points.find((point) => point.id === id)
      }
      map.on('click', (event) => {
        const point = hitPoint(event.point)
        if (point) latest.current.onSelect(point)
      })
      map.on('mousemove', (event) => {
        const point = hitPoint(event.point)
        columns.setHovered(point?.id)
        map.getCanvas().style.cursor = point ? 'pointer' : ''
      })
      map.getCanvas().addEventListener('mouseleave', () => columns.setHovered(undefined))
      setReady(true)
      latest.current.onReady(map)
      emitBounds()
    })
    map.on('moveend', emitBounds)
    map.on('error', (event) => {
      if (event.error?.message?.includes('Failed to fetch'))
        setError('背景地図の一部を読み込めませんでした。ネットワークを確認してください。')
    })
    const resize = new ResizeObserver(() => map.resize())
    resize.observe(container.current)
    return () => {
      resize.disconnect()
      map.remove()
      mapRef.current = undefined
      columnsRef.current = undefined
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !map.getSource('prices')) return
    container.current?.setAttribute('data-rendered', 'false')
    latest.current.onRendered(false)
    ;(map.getSource('prices') as GeoJSONSource).setData(pointCollection(props.points, props.metric))
    columnsRef.current?.setData(props.points, props.dataset, props.metric)
  }, [props.points, props.dataset, props.metric, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const heat = props.mode === 'heatmap' && props.metric !== 'change'
    columnsRef.current?.setVisible(props.mode === '3d')
    map.setLayoutProperty('price-points', 'visibility', props.mode === '3d' ? 'none' : 'visible')
    map.setLayoutProperty('price-glow', 'visibility', props.mode === '3d' ? 'none' : 'visible')
    map.setLayoutProperty('price-heat', 'visibility', heat ? 'visible' : 'none')
    map.setPaintProperty('price-points', 'circle-opacity', heat ? 0.2 : 0.95)
    const pitch = props.mode === '3d' ? 48 : 0
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 700
    if (Math.abs(map.getPitch() - pitch) > 0.1) map.easeTo({ pitch, duration })
  }, [props.mode, props.metric, ready])

  useEffect(() => {
    if (!ready) return
    columnsRef.current?.setSelected(props.selectedId)
  }, [props.selectedId, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !props.position) return
    map.flyTo({
      center: props.position,
      zoom: 13,
      pitch: latest.current.mode === '3d' ? 48 : 0,
      bearing: 0,
      duration: 1200,
    })
    const element = document.createElement('div')
    element.className = 'current-location-marker'
    element.setAttribute('role', 'img')
    element.setAttribute('aria-label', '現在地')
    const marker = new maplibregl.Marker({ element }).setLngLat(props.position).addTo(map)
    return () => {
      marker.remove()
    }
  }, [props.position, ready])

  return (
    <>
      <section className="map-canvas" ref={container} aria-label="全国の不動産価格マップ" />
      {error && (
        <div className="map-error" role="alert">
          {error}
        </div>
      )}
    </>
  )
}
