import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import type { Map as LibreMap } from 'maplibre-gl'
import type { PriceColumnLayer } from '../src/PriceColumnLayer'
import type { PricePoint } from '../src/types'

declare global {
  interface Window {
    navigationTestMap: LibreMap
    navigationTestColumns: PriceColumnLayer
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(20_000)
const errors: string[] = []
page.on('pageerror', (error) => errors.push(error.message))
let fixturePoints: PricePoint[] = []
await page.route('**/api/tiles/**', (route) =>
  route.fulfill({ json: { fetchedAt: new Date().toISOString(), points: fixturePoints } }),
)
await page.route('**/src/MapCanvas.tsx*', async (route) => {
  const response = await route.fetch()
  const source = await response.text()
  assert.ok(source.includes('mapRef.current = map'))
  await route.fulfill({
    response,
    body: source
      .replace('mapRef.current = map', 'window.navigationTestMap = map; mapRef.current = map')
      .replace(
        'columnsRef.current = columns',
        'window.navigationTestColumns = columns; columnsRef.current = columns',
      ),
  })
})
const sidebar = page.getByRole('complementary', { name: '表示データの設定' })
const toggle = sidebar.locator('.sidebar-toggle')
const destination = 'tmp/screenshots'
await mkdir(destination, { recursive: true })

async function settled() {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const map = window.navigationTestMap
          return !!map && map.loaded() && !map.isMoving()
        }),
      { timeout: 30_000 },
    )
    .toBe(true)
}

async function arrange(zoom: number, pitch = 0) {
  await page.evaluate(
    ({ zoom, pitch }) => {
      window.navigationTestMap.jumpTo({ center: [139.7671, 35.6812], zoom, pitch, bearing: 0 })
    },
    { zoom, pitch },
  )
  await settled()
}

async function labelHit(layerIds: string[], name?: string) {
  return page.evaluate(
    ({ layers, name }) => {
      const map = window.navigationTestMap
      const bounds = map.getCanvas().getBoundingClientRect()
      const features = map.queryRenderedFeatures(undefined, { layers })
      for (const feature of features) {
        if (feature.geometry.type !== 'Point') continue
        if (name && (feature.properties['name:ja'] || feature.properties.name) !== name) continue
        if (
          !name &&
          layers.includes('place_city') &&
          /[都道府県]$/.test(feature.properties['name:ja'] || feature.properties.name)
        )
          continue
        const center = feature.geometry.coordinates as [number, number]
        const anchor = map.project(center)
        for (const dy of [12, 8, 4, 0, 16, 20, -4, -8, -12, -16, -20, -24]) {
          for (const dx of [0, 4, -4, 8, -8, 12, -12, 16, -16, 24, -24, 32, -32, 40, -40]) {
            const x = anchor.x + dx
            const y = anchor.y + dy
            if (x < 80 || y < 130 || x > bounds.width - 100 || y > bounds.height - 180) continue
            const hit = map.queryRenderedFeatures([x, y], { layers })[0]
            if (hit?.properties.name !== feature.properties.name) continue
            return {
              x: x + bounds.x,
              y: y + bounds.y,
              localX: x,
              localY: y,
              center,
              name: feature.properties['name:ja'] || feature.properties.name,
              layer: feature.layer.id,
              feature: { source: hit.source, sourceLayer: hit.sourceLayer, id: hit.id },
            }
          }
        }
      }
      return undefined
    },
    { layers: layerIds, name },
  )
}

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5187/')
  await settled()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('combobox', { name: '対象年' }).selectOption('2024')
  await page.getByRole('button', { name: '住宅地', exact: true }).click()
  await page.screenshot({ path: `${destination}/ui-desktop-expanded.png` })
  const expandedWidth = await page.locator('.map-canvas').evaluate((e) => e.clientWidth)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('combobox', { name: '対象年' })).toBeHidden()
  await expect
    .poll(() => page.locator('.map-canvas').evaluate((e) => e.clientWidth))
    .toBeGreaterThan(expandedWidth)
  for (const name of [/取引価格 種別ごとの/, /土地価格 土地1㎡/]) {
    const button = sidebar.getByRole('button', { name })
    await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  }
  await page.screenshot({ path: `${destination}/ui-desktop-collapsed.png` })
  await toggle.click()
  await expect(page.getByRole('combobox', { name: '対象年' })).toHaveValue('2024')
  await expect(page.getByRole('button', { name: '住宅地', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await toggle.press('Escape')
  await expect(toggle).toBeFocused()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  console.log(
    'PASS: desktop collapse, map resize, compact dataset selection, filter preservation, Escape/focus',
  )

  await page.getByTitle('ポイント表示', { exact: true }).click()
  for (const scenario of [
    { zoom: 10, layers: ['major-station-labels'], targetZoom: 14.5, name: 'major station' },
    { zoom: 15, layers: ['station-labels'], targetZoom: 14.5, name: 'station' },
    {
      zoom: 6,
      layers: ['place_state', 'place_city_large'],
      targetZoom: 8,
      name: 'prefecture',
      label: '東京都',
    },
    {
      zoom: 10,
      layers: ['place_city', 'place_city_large', 'place_town', 'place_village'],
      targetZoom: 12,
      name: 'municipality',
    },
  ]) {
    await arrange(scenario.zoom)
    let hit = await labelHit(scenario.layers, scenario.label)
    await expect
      .poll(async () => {
        hit = await labelHit(scenario.layers, scenario.label)
        return !!hit
      })
      .toBe(true)
    assert.ok(hit)
    await page.mouse.move(40, 40)
    const clip = { x: Math.round(hit.x) - 55, y: Math.round(hit.y) - 14, width: 110, height: 28 }
    const normalLabel = await page.screenshot({ clip })
    await page.mouse.move(hit.x, hit.y)
    await expect(page.locator('.maplibregl-canvas')).toHaveCSS('cursor', 'pointer')
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    assert.ok(hit.feature.id !== undefined)
    const hoveredFeature = hit.feature
    await expect
      .poll(() =>
        page.evaluate(
          (feature) => window.navigationTestMap.getFeatureState(feature).hover,
          hoveredFeature,
        ),
      )
      .toBe(true)
    await settled()
    assert.notDeepEqual(
      await page.screenshot({ clip }),
      normalLabel,
      'hover should visibly highlight the label',
    )
    if (scenario.name === 'station') {
      await page.screenshot({ path: `${destination}/ui-station-hover.png` })
    }
    await page.mouse.move(40, 40)
    assert.equal(
      await page.evaluate(
        (feature) => window.navigationTestMap.getFeatureState(feature).hover,
        hit.feature,
      ),
      false,
    )
    await page.mouse.move(hit.x, hit.y)
    await page.mouse.click(hit.x, hit.y)
    await settled()
    const actual = await page.evaluate(() => ({
      center: window.navigationTestMap.getCenter().toArray(),
      zoom: window.navigationTestMap.getZoom(),
    }))
    assert.ok(Math.abs(actual.center[0] - hit.center[0]) < 0.001)
    assert.ok(Math.abs(actual.center[1] - hit.center[1]) < 0.001)
    assert.ok(Math.abs(actual.zoom - scenario.targetZoom) < 0.01)
    if (scenario.name === 'station') {
      await page.screenshot({ path: `${destination}/ui-station-zoom.png` })
    }
    console.log(
      `PASS: ${scenario.name} label ${hit.name} highlights on hover, clears on leave, and clicks to its coordinates and zoom`,
    )
  }

  await toggle.click()
  for (const mode of ['points', '3d', 'heatmap'] as const) {
    await page
      .getByTitle(mode === 'points' ? 'ポイント表示' : mode === '3d' ? '3D表示' : 'ヒート表示', {
        exact: true,
      })
      .click()
    await settled()
    await arrange(13, mode === '3d' ? 48 : 0)
    let label = await labelHit(['station-labels'])
    await expect
      .poll(async () => {
        label = await labelHit(['station-labels'])
        return !!label
      })
      .toBe(true)
    assert.ok(label)
    const coordinates = await page.evaluate(
      ({ localX, localY }) => window.navigationTestMap.unproject([localX, localY]).toArray(),
      label,
    )
    fixturePoints = [
      {
        id: `overlap-${mode}`,
        coordinates,
        price: 300_000,
        change: 1,
        address: 'クリック優先の検証地点',
        municipality: '東京都',
        category: '住宅地',
      },
    ]
    await page
      .getByRole('combobox', { name: '対象年' })
      .selectOption(mode === 'points' ? '2023' : mode === '3d' ? '2022' : '2021')
    await expect(page.getByRole('status')).toHaveAttribute('data-loading', 'false')
    await settled()
    await expect(page.locator('.map-canvas')).toHaveAttribute('data-rendered', 'true')
    const overlap = await page.evaluate(({ id, coordinates }) => {
      const map = window.navigationTestMap
      const rect = map.getCanvas().getBoundingClientRect()
      const anchor = map.project(coordinates)
      const offsets = [0, ...Array.from({ length: 50 }, (_, i) => -(i + 1) * 2), 2, 4, 6, 8]
      for (const dy of offsets) {
        const y = Math.round(anchor.y + dy)
        for (const dx of [0, 2, -2, 4, -4, 6, -6, 8, -8, 12, -12]) {
          const x = Math.round(anchor.x + dx)
          const labels = map.queryRenderedFeatures([x, y], { layers: ['station-labels'] })
          if (!labels.length) continue
          const data =
            map.getLayoutProperty('price-points', 'visibility') === 'visible'
              ? map.queryRenderedFeatures([x, y], { layers: ['price-points'] })[0]?.properties.id
              : window.navigationTestColumns.pick({ x, y })?.id
          if (data === id) return { x: x + rect.x, y: y + rect.y }
        }
      }
      return undefined
    }, fixturePoints[0])
    assert.ok(overlap, `${mode} should physically overlap a rendered station label`)
    const before = await page.evaluate(() => [
      window.navigationTestMap.getCenter().toArray(),
      window.navigationTestMap.getZoom(),
    ])
    await page.mouse.move(overlap.x, overlap.y)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    assert.equal(
      await page.evaluate(
        (id) => window.navigationTestMap.getFeatureState({ source: 'prices', id }).hover,
        fixturePoints[0].id,
      ),
      true,
    )
    assert.equal(
      await page.evaluate(({ x, y }) => {
        const map = window.navigationTestMap
        const rect = map.getCanvas().getBoundingClientRect()
        return map
          .queryRenderedFeatures([x - rect.x, y - rect.y], { layers: ['station-labels'] })
          .some(
            (f) =>
              map.getFeatureState({ source: f.source, sourceLayer: f.sourceLayer, id: f.id }).hover,
          )
      }, overlap),
      false,
    )
    await page.screenshot({ path: `${destination}/ui-${mode}-hover-priority.png` })
    await page.mouse.click(overlap.x, overlap.y)
    await expect(page.getByRole('complementary', { name: '地点の詳細' })).toBeVisible()
    await settled()
    assert.deepEqual(
      await page.evaluate(() => [
        window.navigationTestMap.getCenter().toArray(),
        window.navigationTestMap.getZoom(),
      ]),
      before,
    )
    await page.screenshot({ path: `${destination}/ui-${mode}-click-priority.png` })
    await page.getByRole('button', { name: '詳細を閉じる' }).click()
    console.log(
      `PASS: ${mode} data selection takes priority over overlapping station text; no map movement`,
    )
  }

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await sidebar.getByRole('button', { name: /土地価格 土地1㎡/ }).click()
    await expect(sidebar.getByRole('button', { name: /土地価格 土地1㎡/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.screenshot({ path: `${destination}/ui-mobile-${width}-collapsed.png` })
    await toggle.click()
    await expect(page.getByRole('combobox', { name: '対象年' })).toBeVisible()
    await page.getByRole('combobox', { name: '対象年' }).selectOption('2020')
    await page.screenshot({ path: `${destination}/ui-mobile-${width}-expanded.png` })
    await toggle.click()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await toggle.click()
  await arrange(10)
  const hit = await labelHit(['major-station-labels'])
  assert.ok(hit)
  await page.mouse.click(hit.x, hit.y)
  assert.equal(await page.evaluate(() => window.navigationTestMap.isMoving()), false)
  assert.equal(await page.evaluate(() => window.navigationTestMap.getZoom()), 14.5)
  assert.deepEqual(errors, [])
  console.log(
    'PASS: mobile 390/320px compact selection and panel controls, no overflow, reduced motion, no page errors',
  )
} catch (error) {
  console.error('Page errors:', errors)
  console.error(
    await page.evaluate(() => ({
      zoom: window.navigationTestMap?.getZoom(),
      center: window.navigationTestMap?.getCenter(),
      status: document.querySelector('[role=status]')?.textContent,
    })),
  )
  await page.screenshot({ path: `${destination}/ui-test-failure.png` })
  throw error
} finally {
  await browser.close()
}
