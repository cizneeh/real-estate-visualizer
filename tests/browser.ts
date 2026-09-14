import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { tileAt, tileKey } from '../src/tiles'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width: 1512, height: 982 },
  deviceScaleFactor: 1,
  permissions: ['geolocation'],
  geolocation: { longitude: 135.5023, latitude: 34.6937 },
})
const page = await context.newPage()
page.setDefaultTimeout(15_000)
const errors: string[] = []
const requestedTiles: string[] = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('request', (request) => {
  const url = new URL(request.url())
  if (url.pathname.startsWith('/api/tiles/'))
    requestedTiles.push(url.pathname.slice('/api/tiles/'.length))
})
const destination = 'tmp/screenshots'
await mkdir(destination, { recursive: true })

async function ready() {
  await expect(page.getByRole('status')).not.toContainText('取得中', { timeout: 90_000 })
  if ((await page.getByRole('status').textContent())?.includes('一部の地域')) {
    await page.getByRole('button', { name: '再試行', exact: true }).click()
  }
  await expect(page.getByRole('status')).toContainText(/地点を表示中/, { timeout: 120_000 })
  await expect(page.locator('.map-canvas')).toHaveAttribute('data-rendered', 'true', {
    timeout: 30_000,
  })
  await page.waitForTimeout(800)
}

function expectLocation(longitude: number, latitude: number) {
  assert.ok(requestedTiles.includes(tileKey(tileAt([longitude, latitude]))))
}

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5187/')
  await ready()
  expectLocation(135.5023, 34.6937)
  await expect(page.getByRole('img', { name: '現在地', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '地域に移動' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '新宿', exact: true })).toHaveCount(0)
  await page.screenshot({ path: `${destination}/osaka-current-location.png`, fullPage: true })
  console.log('PASS: automatic Osaka geolocation, live data, desktop 3D, no Tokyo shortcuts')

  await page.getByRole('button', { name: '全国を表示', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('見たい地域を拡大すると', {
    timeout: 15_000,
  })
  await expect(page.getByRole('button', { name: '再試行', exact: true })).toHaveCount(0)
  await page.screenshot({ path: `${destination}/japan-overview.png`, fullPage: true })
  await page.getByRole('button', { name: '現在地に戻る', exact: true }).click()
  await page.waitForTimeout(1500)
  await ready()
  expectLocation(135.5023, 34.6937)
  await page.getByRole('button', { name: '住宅地', exact: true }).click()
  await expect(page.getByRole('button', { name: '住宅地', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.locator('.rank-row').first().click()
  await expect(page.getByRole('complementary', { name: '地点の詳細' })).toBeVisible()
  await page.waitForTimeout(1800)
  await ready()
  await expect(page.getByRole('complementary', { name: '地点の詳細' })).toBeVisible()
  await page.screenshot({ path: `${destination}/osaka-detail.png`, fullPage: true })
  console.log('PASS: national overview, return to location, residential filter, detail selection')

  await context.setGeolocation({ longitude: 127.6809, latitude: 26.2124 })
  await page.getByRole('button', { name: '現在地に戻る', exact: true }).click()
  await page.waitForTimeout(1800)
  await ready()
  await page.getByTitle('ポイント表示', { exact: true }).click()
  await page.waitForTimeout(900)
  await ready()
  expectLocation(127.6809, 26.2124)
  await page.screenshot({ path: `${destination}/naha-points.png`, fullPage: true })

  await page.getByRole('button', { name: '前年比（%）' }).click()
  await ready()
  await expect(page.locator('.big-metric')).toContainText('%')
  await expect(page.getByTitle('前年比は3Dまたはポイントで表示します')).toBeDisabled()
  await page.getByRole('combobox', { name: '対象年' }).selectOption('2024')
  await ready()
  await expect(page.getByRole('combobox', { name: '対象年' })).toHaveValue('2024')
  console.log('PASS: Naha geolocation, point mode, annual change, year selection')

  await page.getByRole('button', { name: /土地価格 土地1㎡あたりの価格/ }).click()
  await page.getByRole('button', { name: '価格', exact: true }).click()
  await ready()
  await page.getByTitle('ヒート表示', { exact: true }).click()
  await ready()
  await page.screenshot({ path: `${destination}/land-survey-heatmap.png`, fullPage: true })

  await page.getByRole('button', { name: /取引価格 種別ごとの実際の取引/ }).click()
  await ready()
  await expect(page.locator('.summary-foot')).toContainText('件の取引')
  await page.getByTitle('ポイント表示', { exact: true }).click()
  await ready()
  await page.screenshot({ path: `${destination}/transactions.png`, fullPage: true })
  console.log('PASS: land survey, heatmap, actual condominium transaction data')

  await page.route('**/api/tiles/**', (route) =>
    route.fulfill({
      status: 502,
      json: { error: '接続エラーの表示テスト' },
    }),
  )
  await page.getByRole('combobox', { name: '対象年' }).selectOption('2023')
  await expect(page.getByRole('status')).toContainText('接続エラーの表示テスト')
  await page.unroute('**/api/tiles/**')
  await page.getByRole('button', { name: '再試行', exact: true }).click()
  await ready()

  await page.route('**/api/tiles/**', (route) =>
    route.fulfill({
      json: {
        points: [],
        dataset: 'transactions',
        year: 2022,
        fetchedAt: new Date().toISOString(),
        tiles: 1,
        failedTiles: 0,
      },
    }),
  )
  await page.getByRole('combobox', { name: '対象年' }).selectOption('2022')
  await expect(page.getByRole('status')).toContainText('対象データがありません')
  await expect(page.locator('.big-metric')).toContainText('—')
  await page.unroute('**/api/tiles/**')
  await page.getByRole('combobox', { name: '対象年' }).selectOption('2023')
  await ready()
  await page.getByRole('combobox', { name: '対象年' }).selectOption('2024')
  await ready()
  console.log('PASS: error recovery, empty data, sidebar year selection')

  await context.setGeolocation({ longitude: 141.3545, latitude: 43.0618 })
  await page.getByRole('button', { name: '現在地に戻る', exact: true }).click()
  await page.waitForTimeout(1800)
  await ready()
  expectLocation(141.3545, 43.0618)
  await page.screenshot({ path: `${destination}/sapporo-transactions.png`, fullPage: true })
  console.log('PASS: Sapporo geolocation and live condominium transactions')

  await page.getByRole('button', { name: /データ・表示について/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: 'データパネルを開く' }).click()
  await expect(page.locator('.sidebar')).toHaveClass(/is-open/)
  await page.getByRole('button', { name: 'パネルを閉じる' }).click()
  await expect(page.locator('.sidebar')).not.toBeVisible()
  await ready()
  await page.screenshot({ path: `${destination}/mobile.png`, fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  console.log('PASS: information dialog, mobile controls, no horizontal overflow or JS errors')

  for (const failure of [
    'denied',
    'unavailable',
    'timeout',
    'unsupported',
    'outside',
    'pending',
  ] as const) {
    const fallback = await browser.newContext({
      viewport: failure === 'denied' ? { width: 1512, height: 982 } : { width: 390, height: 844 },
      ...(failure === 'outside'
        ? {
            permissions: ['geolocation'],
            geolocation: { longitude: -74.006, latitude: 40.7128 },
          }
        : {}),
    })
    const fallbackPage = await fallback.newPage()
    fallbackPage.on('pageerror', (error) => errors.push(error.message))
    const fallbackTiles: string[] = []
    fallbackPage.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith('/api/tiles/'))
        fallbackTiles.push(url.pathname.slice('/api/tiles/'.length))
    })
    if (failure === 'denied') {
      const cdp = await fallback.newCDPSession(fallbackPage)
      await cdp.send('Browser.setPermission', {
        permission: { name: 'geolocation' },
        setting: 'denied',
        origin: new URL(process.env.APP_URL ?? 'http://127.0.0.1:5187/').origin,
      })
    } else if (failure !== 'outside') {
      await fallback.addInitScript((reason) => {
        Object.defineProperty(navigator, 'geolocation', {
          configurable: true,
          value:
            reason === 'unsupported'
              ? undefined
              : {
                  getCurrentPosition(success: PositionCallback, fail: PositionErrorCallback) {
                    if (reason === 'pending') {
                      window.addEventListener(
                        'resolve-test-geolocation',
                        () => {
                          success({
                            coords: { longitude: 135.5023, latitude: 34.6937 },
                          } as GeolocationPosition)
                        },
                        { once: true },
                      )
                      return
                    }
                    fail({ code: reason === 'timeout' ? 3 : 2 } as GeolocationPositionError)
                  },
                },
        })
      }, failure)
    }
    await fallbackPage.goto(process.env.APP_URL ?? 'http://127.0.0.1:5187/')
    if (failure === 'denied') {
      await expect(fallbackPage.locator('.location-notice')).toHaveCount(0)
    } else {
      await expect(fallbackPage.locator('.location-notice')).toContainText(
        failure === 'pending'
          ? '現在地を取得中'
          : failure === 'outside'
            ? '現在地は地図の表示範囲外'
            : '現在地を取得できません',
      )
    }
    await expect(fallbackPage.getByRole('status')).toHaveAttribute('data-loading', 'false', {
      timeout: 60_000,
    })
    await expect(fallbackPage.getByRole('status')).toContainText('地点を表示中', {
      timeout: 30_000,
    })
    await expect(fallbackPage.locator('.map-canvas')).toHaveAttribute('data-rendered', 'true')
    assert.ok(fallbackTiles.includes(tileKey(tileAt([139.7671, 35.6812]))))
    await expect(fallbackPage.getByRole('img', { name: '現在地', exact: true })).toHaveCount(0)
    if (failure !== 'pending')
      await expect(fallbackPage.getByRole('button', { name: '現在地に戻る' })).toBeEnabled()
    await fallbackPage.screenshot({
      path: `${destination}/location-${failure}.png`,
      fullPage: true,
    })
    assert.equal(
      await fallbackPage.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    )
    if (failure === 'pending') {
      await fallbackPage.evaluate(() => window.dispatchEvent(new Event('resolve-test-geolocation')))
      await expect(fallbackPage.getByRole('img', { name: '現在地', exact: true })).toBeVisible()
      await expect
        .poll(() => fallbackTiles.includes(tileKey(tileAt([135.5023, 34.6937]))))
        .toBe(true)
      await expect(fallbackPage.getByRole('status')).toHaveAttribute('data-loading', 'false')
      await expect(fallbackPage.getByRole('status')).toContainText('地点を表示中')
      await expect(fallbackPage.locator('.location-notice')).toHaveCount(0)
    }
    await fallback.close()
    console.log(
      `PASS: geolocation ${failure} shows Tokyo prices${failure === 'pending' ? ' before moving to the resolved location' : ' with usable controls'}`,
    )
  }
  assert.deepEqual(errors, [])
} catch (error) {
  await page.screenshot({ path: `${destination}/test-failure.png`, fullPage: true })
  console.error('Browser status:', await page.getByRole('status').textContent())
  console.error('Browser errors:', errors)
  throw error
} finally {
  await browser.close()
}
