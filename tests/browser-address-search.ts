import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { tileAt, tileKey } from '../src/tiles'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const origin = process.env.APP_URL ?? 'http://127.0.0.1:5187/'
await mkdir('tmp/screenshots', { recursive: true })
const errors: string[] = []
const geocoder = '**/japanese-addresses-v2.geoloniamaps.com/**'
const context = await browser.newContext({ viewport: { width: 1512, height: 982 } })
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition(success: PositionCallback) {
        window.addEventListener(
          'test-location',
          () => {
            success({ coords: { longitude: 135.5023, latitude: 34.6937 } } as GeolocationPosition)
          },
          { once: true },
        )
      },
    },
  })
})
const page = await context.newPage()
page.setDefaultTimeout(30_000)
page.on('pageerror', (error) => errors.push(error.message))
const tiles: string[] = []
await page.route('**/api/tiles/**', async (route) => {
  tiles.push(new URL(route.request().url()).pathname)
  await route.fulfill({ json: { points: [], fetchedAt: new Date().toISOString() } })
})
const input = page.getByRole('textbox', { name: '住所', exact: true })
const submit = page.getByRole('button', { name: '検索', exact: true })
const feedback = page.locator('.address-feedback')
const marker = page.locator('.address-marker')
async function search(query: string) {
  await input.fill(query)
  await expect(submit).toBeEnabled()
  await input.press('Enter')
  await expect(feedback).not.toContainText('検索中', { timeout: 20_000 })
}
try {
  await page.goto(origin)
  await expect(page.locator('.map-canvas')).toHaveAttribute('data-rendered', 'true')
  await expect(submit).toBeDisabled()
  await input.fill('　 ')
  await expect(submit).toBeDisabled()
  await search('東京都台東区上野公園7-7')
  await expect(feedback).toContainText('住居表示・地番の位置')
  await expect(marker).toHaveAttribute('aria-label', /東京都台東区上野公園7-7/)
  await page.waitForTimeout(1600)
  assert.ok(tiles.some((url) => url.endsWith(tileKey(tileAt([139.775372778, 35.714952981])))))
  const before = await marker.boundingBox()
  await page.evaluate(() => window.dispatchEvent(new Event('test-location')))
  await page.waitForTimeout(1400)
  assert.deepEqual(await marker.boundingBox(), before)
  await expect(page.getByRole('img', { name: '現在地', exact: true })).toHaveCount(0)
  await page.screenshot({ path: 'tmp/screenshots/address-search-desktop.png', fullPage: true })
  console.log('PASS: live address, map movement, empty input, late geolocation ignored')

  await search('東京都千代田区大手町1-1-1')
  await expect(feedback).toContainText('町丁目の代表点')
  await expect(feedback.locator('strong')).toHaveText('東京都千代田区大手町一丁目')
  await expect(marker).toHaveCount(1)
  await search('東京都台東区')
  await expect(feedback).toContainText('市区町村役場の位置')
  await search('東京都')
  await expect(feedback).toContainText('都道府県庁の位置')
  await search('住所ではない文字列xyz')
  await expect(feedback).toContainText('住所を特定できませんでした')
  await expect(marker).toHaveCount(0)
  console.log('PASS: town, city, prefecture accuracy; unmatched input; marker replacement')

  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(geocoder, async (route) => {
    await gate
    await route.continue()
  })
  await input.fill('北海道札幌市中央区北一条西二丁目')
  const requested = page.waitForRequest((request) =>
    request.url().includes(encodeURIComponent('北海道')),
  )
  await submit.click()
  await requested
  await page.getByRole('button', { name: '住所検索をクリア' }).click()
  release()
  await page.waitForTimeout(2000)
  await expect(feedback).toBeEmpty()
  await expect(marker).toHaveCount(0)
  await page.unroute(geocoder)
  console.log('PASS: clearing pending search ignores late results')

  await page.route(geocoder, (route) => route.fulfill({ status: 404, body: 'Unavailable' }))
  await search('沖縄県那覇市泉崎1-1-1')
  await expect(feedback).toContainText('住所データを取得できませんでした')
  await page.unroute(geocoder)
  await submit.click()
  await expect(feedback).toContainText('沖縄県那覇市', { timeout: 20_000 })
  await expect(marker).toHaveCount(1)
  await page.getByRole('button', { name: '現在地に戻る' }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('test-location')))
  await expect(page.getByRole('img', { name: '現在地', exact: true })).toBeVisible()
  await expect(input).toHaveValue('')
  await expect(marker).toHaveCount(0)
  console.log('PASS: network failure, retry, return to current location')

  let finish: () => void = () => undefined
  const timeoutGate = new Promise<void>((resolve) => {
    finish = resolve
  })
  await page.route(geocoder, async (route) => {
    await timeoutGate
    await route.abort()
  })
  await input.fill('福岡県福岡市中央区天神1-8-1')
  await submit.click()
  await expect(feedback).toContainText('検索に時間がかかっています', { timeout: 20_000 })
  await expect(submit).toBeEnabled()
  await page.getByRole('button', { name: '全国を表示' }).click()
  finish()
  await expect(input).toHaveValue('')
  await expect(feedback).toBeEmpty()
  await page.unroute(geocoder)
  console.log('PASS: timeout recovery and national overview')

  await page.setViewportSize({ width: 390, height: 844 })
  await search('東京都台東区上野公園7-7')
  await page.waitForTimeout(1500)
  await expect(marker).toBeVisible()
  const formBox = await page.locator('.address-search form').boundingBox()
  const menuBox = await page.getByRole('button', { name: 'データパネルを開く' }).boundingBox()
  const feedbackBox = await feedback.boundingBox()
  const modesBox = await page.getByRole('group', { name: '表示方法' }).boundingBox()
  assert.ok(formBox && menuBox && formBox.x >= menuBox.x + menuBox.width)
  assert.ok(feedbackBox && modesBox && feedbackBox.x + feedbackBox.width <= modesBox.x)
  const timelineBox = await page.locator('.timeline').boundingBox()
  const attributionBox = await page.locator('.maplibregl-ctrl-attrib').boundingBox()
  assert.ok(timelineBox && attributionBox && timelineBox.y + timelineBox.height <= attributionBox.y)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: 'tmp/screenshots/address-search-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 320, height: 740 })
  await expect(submit).toBeVisible()
  const narrowTimeline = await page.locator('.timeline').boundingBox()
  const narrowAttribution = await page.locator('.maplibregl-ctrl-attrib').boundingBox()
  assert.ok(
    narrowTimeline &&
      narrowAttribution &&
      narrowTimeline.y + narrowTimeline.height <= narrowAttribution.y,
  )
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.getByRole('button', { name: '住所検索をクリア' }).click()
  await expect(input).toBeFocused()
  assert.deepEqual(errors, [])
  console.log('PASS: 390px/320px mobile controls, clear restores focus, no JS errors')
} catch (error) {
  await page.screenshot({ path: 'tmp/screenshots/address-search-failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
}
