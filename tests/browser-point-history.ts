import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { tileAt, tileKey } from '../src/tiles'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const origin = process.env.APP_URL ?? 'http://127.0.0.1:5187/'
const destination = 'tmp/screenshots'
await mkdir(destination, { recursive: true })
const coordinates: [number, number] = [139.8045, 35.7498]
const context = await browser.newContext({
  viewport: { width: 1512, height: 982 },
  permissions: ['geolocation'],
  geolocation: { longitude: coordinates[0], latitude: coordinates[1] },
})
const page = await context.newPage()
page.setDefaultTimeout(20_000)
const errors: string[] = []
page.on('pageerror', (error) => errors.push(error.message))
const requests: string[] = []
let fail2019 = true
const centerKey = tileKey(tileAt(coordinates))
await page.route('**/api/tiles/**', async (route) => {
  const url = new URL(route.request().url())
  requests.push(url.pathname + url.search)
  const year = Number(url.searchParams.get('year'))
  if (year < 2020) await new Promise((resolve) => setTimeout(resolve, 500))
  if (year === 2019 && fail2019) {
    await route.fulfill({
      status: 502,
      json: { error: '履歴の取得失敗テスト', upstreamStatus: 429 },
    })
    return
  }
  await route.fulfill({
    json: {
      fetchedAt: new Date().toISOString(),
      points:
        url.pathname.endsWith(centerKey) && year !== 2021
          ? [
              {
                id: '0-1',
                historyId: '0-1',
                coordinates,
                location: year === 2022 ? '所在地が変わった地点' : '東京都足立区テスト１番',
                address: '動作確認用の地点',
                municipality: '足立区',
                category: '住宅地',
                price: Math.max(50_000, 1_000_000 + (year - 2020) * 100_000),
                change: year === 2020 ? 0 : 5,
                previousPrice: 900_000 + (year - 2020) * 100_000,
              },
            ]
          : [],
    },
  })
})

try {
  await page.goto(origin)
  await expect(page.getByRole('combobox', { name: '対象年' })).toHaveValue('2026')
  await page.getByRole('combobox', { name: '対象年' }).selectOption('2025')
  await expect(page.locator('.rank-row').first()).toBeVisible()
  assert.ok(
    requests.every((url) =>
      ['2025', '2026'].includes(new URL(url, origin).searchParams.get('year') ?? ''),
    ),
  )
  await page.locator('.rank-row').first().click()
  const detail = page.getByRole('complementary', { name: '地点の詳細' })
  const history = detail.getByRole('region', { name: '価格の推移' })
  await expect(history).toHaveAttribute('aria-busy', 'false')
  await expect(history.locator('.history-heading')).toContainText('2020〜2025年')
  await expect(detail.locator('.detail-price')).toContainText('150')
  await expect(history.locator('.history-line')).toHaveCount(2)
  const historyRequests = requests
    .map((url) => new URL(url, origin))
    .filter((url) => Number(url.searchParams.get('year')) < 2025)
  assert.ok(historyRequests.length > 0)
  assert.ok(
    historyRequests.every(
      (url) => url.pathname.endsWith(centerKey) && Number(url.searchParams.get('year')) >= 2020,
    ),
  )
  await detail.getByText('年ごとの数値を見る', { exact: true }).click()
  await expect(detail.locator('tr').filter({ hasText: '2021' })).toContainText('データなし')
  await expect(detail.locator('tr').filter({ hasText: '2022' })).toContainText(
    '同じ地点と確認できません',
  )
  await expect(detail.locator('tr').filter({ hasText: '2020' })).toContainText('0.0%')
  const currentTileRequests = () =>
    requests.filter((url) => url.includes(`${centerKey}?`) && url.includes('year=2025')).length
  const before = currentTileRequests()
  await page.getByRole('button', { name: '前年比（%）', exact: true }).click()
  await expect(page.locator('.year-period')).toContainText('2024年1月1日 → 2025年1月1日')
  await expect(detail).toBeVisible()
  assert.equal(currentTileRequests(), before)
  await expect(page.getByTitle('前年比は3Dまたはポイントで表示します')).toBeDisabled()
  await page.getByRole('combobox', { name: '対象年' }).selectOption('2023')
  await expect(detail).toBeVisible()
  await expect(history).toHaveAttribute('aria-busy', 'false')
  await expect(detail.locator('.detail-price')).toContainText('130')
  await expect(history.locator('.history-heading')).toContainText('2018〜2023年')
  await expect(page.locator('.year-period')).toContainText('2022年1月1日 → 2023年1月1日')
  await expect(history.getByRole('alert')).toContainText('一部の年')
  await expect(detail.locator('tr').filter({ hasText: '2018' })).toContainText('80')
  fail2019 = false
  const count2018 = requests.filter((url) => url.includes('year=2018')).length
  await detail.getByRole('button', { name: '履歴を再試行' }).click()
  await expect(history.getByRole('alert')).toHaveCount(0)
  await expect(detail.locator('tr').filter({ hasText: '2019' })).toContainText('90')
  assert.equal(requests.filter((url) => url.includes('year=2018')).length, count2018)
  await history.locator('.history-hit').first().focus()
  await page.keyboard.press('Enter')
  await expect(history.locator('.history-readout')).toContainText('2018年')
  await expect(page.getByRole('combobox', { name: '対象年' })).toHaveValue('2023')
  await page.getByRole('combobox', { name: '対象年' }).selectOption('2021')
  await expect(detail.locator('.detail-period')).toContainText('2021年1月1日')
  await expect(detail.locator('.detail-unavailable')).toContainText('データなし')
  await expect(detail.locator('.detail-price')).toHaveCount(0)
  await page.getByRole('combobox', { name: '対象年' }).selectOption('2025')
  await expect(detail.locator('.detail-price')).toContainText('150')
  await detail.getByRole('button', { name: '10年前から' }).click()
  await expect(history).toHaveAttribute('aria-busy', 'false')
  await expect(history.locator('.history-heading')).toContainText('2015〜2025年')
  await detail.getByRole('button', { name: '全期間' }).click()
  await expect(history).toHaveAttribute('aria-busy', 'false', { timeout: 30000 })
  await expect(history.locator('.history-heading')).toContainText('1995〜2025年')
  await detail.getByRole('button', { name: '5年前から' }).click()
  await expect(detail.getByRole('button', { name: '5年前から' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(history.locator('.history-heading')).toContainText('2020〜2025年')
  await detail.locator('.detail-scroll').evaluate((element) => {
    element.scrollTop = 0
  })
  await page.screenshot({ path: `${destination}/history-fixture-desktop.png`, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.sidebar')).toHaveClass(/is-collapsed/)
  await expect(page.getByRole('combobox', { name: '対象年' })).toBeHidden()
  await detail.locator('.detail-scroll').evaluate((element) => {
    element.scrollTop = 0
  })
  await expect(detail).toBeVisible()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  const panelBox = await detail.boundingBox()
  const controlsBox = await page.locator('.zoom-controls').boundingBox()
  assert.ok(panelBox && controlsBox && panelBox.x + panelBox.width < controlsBox.x)
  await page.screenshot({ path: `${destination}/history-fixture-mobile.png`, fullPage: true })
  await detail.getByRole('button', { name: '詳細を閉じる' }).click()
  await page.getByRole('button', { name: 'データパネルを開く' }).click()
  await page.getByRole('button', { name: /マンション取引 中古マンション等の実取引/ }).click()
  await expect(page.getByRole('button', { name: '価格', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: '前年比（%）', exact: true })).toBeDisabled()
  assert.deepEqual(errors, [])
  console.log(
    'PASS: dataset/metric separation, shared cache, history identity, gaps, failure retry, year persistence, keyboard inspection, mobile layout, and transaction restrictions',
  )
} finally {
  await context.close()
  await browser.close()
}
