import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { tileAt, tileBounds, tileKey } from '../src/tiles'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width: 1512, height: 982 },
  permissions: ['geolocation'],
  geolocation: { longitude: 135.5023, latitude: 34.6937 },
})
const page = await context.newPage()
page.setDefaultTimeout(15_000)
const destination = 'tmp/screenshots'
await mkdir(destination, { recursive: true })
const centerKey = tileKey(tileAt([135.5023, 34.6937]))
const requests: { key: string; year: string; priority: string; dataset: string }[] = []
const errors: string[] = []
let backgroundActive = 0
let backgroundMaximum = 0
let active = 0
let maximum = 0
let failedTile = true
let releaseSlow!: () => void
const slow = new Promise<void>((resolve) => {
  releaseSlow = resolve
})
let cancelled = 0

page.on('pageerror', (error) => errors.push(error.message))
page.on('requestfailed', (request) => {
  if (request.url().includes('/api/tiles/')) cancelled++
})
await page.route('**/api/tiles/**', async (route) => {
  const url = new URL(route.request().url())
  const key = url.pathname.slice('/api/tiles/'.length)
  const year = url.searchParams.get('year') ?? ''
  const priority = route.request().headers()['x-price-priority'] ?? ''
  const dataset = url.searchParams.get('dataset') ?? ''
  requests.push({ key, year, priority, dataset })
  active++
  maximum = Math.max(maximum, active)
  if (priority === 'background') backgroundMaximum = Math.max(backgroundMaximum, ++backgroundActive)
  try {
    if (key === centerKey && year === '2026') await slow
    await new Promise((resolve) => setTimeout(resolve, year === '2021' ? 1500 : 60))
    if (key === centerKey && year === '2023' && failedTile) {
      await route.fulfill({ status: 502, json: { error: '一時的な取得失敗', upstreamStatus: 429 } })
      return
    }
    const [z, x, y] = key.split('/').map(Number)
    const bounds = tileBounds({ z, x, y })
    const coordinates = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]
    await route.fulfill({
      json: {
        fetchedAt: new Date().toISOString(),
        points:
          year === '2020'
            ? []
            : [
                {
                  id: `${dataset}-${year}-${key}`,
                  coordinates,
                  price: Number(year) * 100,
                  change: 2,
                  address: `${year}年の地点`,
                  municipality: '大阪市',
                  category: '住宅地',
                },
              ],
      },
    })
  } finally {
    active--
    if (priority === 'background') backgroundActive--
  }
})

const status = page.getByRole('status')
async function ready() {
  await expect(status).toHaveAttribute('data-loading', 'false')
  await expect(status).toContainText('地点を表示中')
  await expect(page.locator('.map-canvas')).toHaveAttribute('data-rendered', 'true')
}

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5187/')
  await expect(status).toContainText('集計途中')
  await expect(page.locator('.rank-row').first()).toBeVisible()
  await expect(status).toHaveAttribute('data-loading', 'true')
  assert.ok(
    Number(await status.getAttribute('data-completed')) <
      Number(await status.getAttribute('data-total')),
  )
  assert.ok(maximum > 1 && maximum <= 6)
  await page.screenshot({ path: `${destination}/tiles-progressive-loading.png`, fullPage: true })
  releaseSlow()
  await ready()
  await expect
    .poll(() => requests.filter((request) => request.priority === 'background').length)
    .toBeGreaterThan(0)
  await expect.poll(() => active, { timeout: 10_000 }).toBe(0)
  assert.ok(backgroundMaximum <= 2)
  console.log(
    'PASS: parallel browser requests, progressive display, and bounded background prefetch',
  )

  const foregroundCount = () => requests.filter((request) => request.priority === 'visible').length
  const beforeZoom = foregroundCount()
  await page.getByRole('button', { name: 'ズームイン', exact: true }).click()
  await page.waitForTimeout(1000)
  await ready()
  assert.equal(foregroundCount(), beforeZoom)
  await page.getByRole('button', { name: 'ズームアウト', exact: true }).click()
  await page.waitForTimeout(1000)
  await ready()
  assert.equal(foregroundCount(), beforeZoom)

  const canvas = await page.locator('.map-canvas').boundingBox()
  assert.ok(canvas)
  await page.mouse.move(canvas.x + canvas.width * 0.55, canvas.y + canvas.height * 0.55)
  await page.mouse.down()
  await page.mouse.move(canvas.x + canvas.width * 0.55 - 70, canvas.y + canvas.height * 0.55, {
    steps: 15,
  })
  await page.mouse.up()
  await page.waitForTimeout(1400)
  await ready()
  assert.equal(foregroundCount(), beforeZoom)
  console.log('PASS: zoom in/out and a short pan reuse visible and prefetched tiles')

  await page.getByRole('combobox', { name: '対象年' }).selectOption('2024')
  await ready()
  await expect(page.locator('.rank-row').first()).toContainText('2024年の地点')
  const beforeReturn = foregroundCount()
  await page.getByRole('combobox', { name: '対象年' }).selectOption('2026')
  await ready()
  assert.equal(foregroundCount(), beforeReturn)
  await expect(page.locator('.rank-row').first()).toContainText('2026年の地点')
  await page.getByRole('button', { name: '前年比（%）' }).click()
  await ready()
  assert.equal(foregroundCount(), beforeReturn)
  console.log(
    'PASS: returning to a cached year and switching land/change perform no new foreground fetch',
  )

  await page.getByRole('combobox', { name: '対象年' }).selectOption('2021')
  await expect
    .poll(() => requests.filter((request) => request.year === '2021').length)
    .toBeGreaterThan(0)
  await page.getByRole('combobox', { name: '対象年' }).selectOption('2022')
  await ready()
  await page.waitForTimeout(1700)
  await expect(page.locator('.rank-row').first()).toContainText('2022年の地点')
  assert.ok(cancelled > 0)
  console.log('PASS: obsolete requests are cancelled and cannot overwrite the selected year')

  await page.getByRole('combobox', { name: '対象年' }).selectOption('2023')
  await expect(status).toContainText('一部の地域を取得できませんでした')
  await expect(page.locator('.rank-row').first()).toBeVisible()
  const successfulKeys = requests
    .filter(
      (request) =>
        request.year === '2023' && request.priority === 'visible' && request.key !== centerKey,
    )
    .map((request) => request.key)
  const beforeRetry = requests.filter(
    (request) => request.year === '2023' && request.key === centerKey,
  ).length
  failedTile = false
  await page.getByRole('button', { name: '再試行', exact: true }).click()
  await ready()
  assert.equal(
    requests.filter((request) => request.year === '2023' && request.key === centerKey).length,
    beforeRetry + 1,
  )
  for (const key of successfulKeys) {
    assert.equal(
      requests.filter(
        (request) =>
          request.year === '2023' && request.priority === 'visible' && request.key === key,
      ).length,
      1,
    )
  }
  console.log(
    'PASS: partial failures preserve successful tiles; retry only fetches the failed tile',
  )

  await page.getByRole('combobox', { name: '対象年' }).selectOption('2020')
  await expect(status).toContainText('対象データがありません')
  await page.getByRole('combobox', { name: '対象年' }).selectOption('2026')
  await ready()
  const beforeEmpty = foregroundCount()
  await page.getByRole('combobox', { name: '対象年' }).selectOption('2020')
  await expect(status).toContainText('対象データがありません')
  assert.equal(foregroundCount(), beforeEmpty)
  await page.getByRole('button', { name: '全国を表示', exact: true }).click()
  await expect(status).toContainText('見たい地域を拡大すると')
  await page.waitForTimeout(1500)
  const beforeOverview = requests.length
  await page.getByRole('combobox', { name: '対象年' }).selectOption('2024')
  await page.waitForTimeout(700)
  assert.equal(requests.length, beforeOverview)
  console.log('PASS: empty tiles are cached and national overview starts no tile requests')

  await page.getByRole('button', { name: '現在地に戻る', exact: true }).click()
  await page.waitForTimeout(1500)
  await ready()
  await page.screenshot({ path: `${destination}/tiles-cached-map.png`, fullPage: true })
  assert.deepEqual(errors, [])
} catch (error) {
  releaseSlow()
  await page.screenshot({ path: `${destination}/cache-test-failure.png`, fullPage: true })
  console.error('Cache test status:', await status.textContent())
  console.error('Cache test errors:', errors)
  throw error
} finally {
  await browser.close()
}
