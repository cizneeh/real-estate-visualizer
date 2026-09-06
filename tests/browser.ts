import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width: 1512, height: 982 },
  deviceScaleFactor: 1,
})
const page = await context.newPage()
page.setDefaultTimeout(15_000)
const errors: string[] = []
page.on('pageerror', (error) => errors.push(error.message))
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

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5173/')
  await ready()
  await page.screenshot({ path: `${destination}/desktop-3d.png`, fullPage: true })
  console.log('PASS: initial live data and desktop 3D')

  await page.getByRole('button', { name: '国分寺', exact: true }).click()
  await expect(page.getByRole('button', { name: '国分寺', exact: true })).toHaveClass('active')
  await page.waitForTimeout(1800)
  await ready()
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
  await page.screenshot({ path: `${destination}/kokubunji-detail.png`, fullPage: true })
  console.log('PASS: Kokubunji, residential filter, detail selection survives map movement')

  await page.getByRole('button', { name: '立川', exact: true }).click()
  await page.waitForTimeout(1800)
  await ready()
  await page.getByTitle('ポイント表示', { exact: true }).click()
  await page.waitForTimeout(900)
  await ready()
  await page.screenshot({ path: `${destination}/tachikawa-points.png`, fullPage: true })

  await page.getByRole('button', { name: /地価の変化 公示地価の前年比/ }).click()
  await ready()
  await expect(page.locator('.big-metric')).toContainText('%')
  await expect(page.getByTitle('前年比は3Dまたはポイントで表示します')).toBeDisabled()
  await page.getByRole('button', { name: '2024年を表示' }).click()
  await ready()
  await expect(page.locator('.map-heading p')).toContainText('2024年')
  console.log('PASS: Tachikawa, point mode, annual change, year selection')

  await page.getByRole('button', { name: /基準地価 7月1日時点の土地の価格/ }).click()
  await ready()
  await page.getByTitle('ヒート表示', { exact: true }).click()
  await ready()
  await page.screenshot({ path: `${destination}/land-survey-heatmap.png`, fullPage: true })

  await page.getByRole('button', { name: /マンション取引 中古マンション等の実取引/ }).click()
  await ready()
  await expect(page.locator('.summary-foot')).toContainText('件の取引')
  await page.getByTitle('ポイント表示', { exact: true }).click()
  await ready()
  await page.screenshot({ path: `${destination}/transactions.png`, fullPage: true })
  console.log('PASS: land survey, heatmap, actual condominium transaction data')

  await page.route('**/api/data?*', (route) =>
    route.fulfill({
      status: 502,
      json: { error: '接続エラーの表示テスト' },
    }),
  )
  await page.getByRole('button', { name: '2023年を表示' }).click()
  await expect(page.getByRole('status')).toContainText('接続エラーの表示テスト')
  await page.unroute('**/api/data?*')
  await page.getByRole('button', { name: '再試行', exact: true }).click()
  await ready()

  await page.route('**/api/data?*', (route) =>
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
  await page.getByRole('button', { name: '2022年を表示' }).click()
  await expect(page.getByRole('status')).toContainText('対象データがありません')
  await expect(page.locator('.big-metric')).toContainText('—')
  await page.unroute('**/api/data?*')
  await page.getByRole('button', { name: '2023年を表示' }).click()
  await ready()
  await page.getByRole('button', { name: '年度を自動再生', exact: true }).click()
  await expect(page.getByRole('button', { name: '2024年を表示' })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 10_000 },
  )
  await page.getByRole('button', { name: '年度の自動再生を停止', exact: true }).click()
  await ready()
  console.log('PASS: error recovery, empty data, timeline playback')

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
  assert.deepEqual(errors, [])
  console.log('PASS: information dialog, mobile controls, no horizontal overflow or JS errors')
} catch (error) {
  await page.screenshot({ path: `${destination}/test-failure.png`, fullPage: true })
  console.error('Browser status:', await page.getByRole('status').textContent())
  throw error
} finally {
  await browser.close()
}
