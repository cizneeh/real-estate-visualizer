import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { tileAt, tileKey } from '../src/tiles'

const origin = process.env.APP_URL ?? 'http://127.0.0.1:5187/'
const coordinates: [number, number] = [139.7671, 35.6812]
const centerKey = tileKey(tileAt(coordinates))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
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
let failSurvey2023 = true
await page.route('**/api/tiles/**', async (route) => {
  const url = new URL(route.request().url())
  requests.push(url.pathname + url.search)
  const year = Number(url.searchParams.get('year'))
  const source = url.searchParams.get('dataset')
  if (source === 'survey' && year === 2023 && failSurvey2023) {
    await route.fulfill({ status: 502, json: { error: '基準地価の取得失敗', upstreamStatus: 429 } })
    return
  }
  if (source === 'survey' && year === 2025) await new Promise((resolve) => setTimeout(resolve, 300))
  const january = {
    id: '0-common',
    historyId: '0-common',
    coordinates,
    location: '東京都千代田区丸の内１丁目１番２',
    address: '共通地点',
    municipality: '千代田区',
    category: '住宅地',
    area: 200,
    price: year === 2026 ? 1_400_000 : 1_000_000,
    change: 3,
    previousPrice: 970_000,
  }
  const july = {
    ...january,
    id: '1-common',
    historyId: '1-common',
    coordinates: [coordinates[0] + 0.0001, coordinates[1]],
    location: '東京都千代田区丸の内一丁目１番２',
    price: 1_200_000,
    change: 2,
    previousPrice: 1_176_000,
  }
  const neighbor = {
    ...january,
    id: '0-neighbor',
    historyId: '0-neighbor',
    location: '東京都千代田区丸の内1番3',
    address: '公示地価だけの地点',
    price: 800_000,
  }
  const surveyNeighbor = {
    ...july,
    id: '1-neighbor',
    historyId: '1-neighbor',
    location: '東京都千代田区丸の内1番4',
    address: '基準地価だけの地点',
    price: 900_000,
  }
  const points = !url.pathname.endsWith(centerKey)
    ? []
    : source === 'transactions'
      ? [{ ...january, id: 'transaction-1', address: '取引地点' }]
      : source === 'land'
        ? [january, neighbor]
        : year === 2026 || year === 2024
          ? []
          : [july, surveyNeighbor]
  await route.fulfill({ json: { fetchedAt: new Date().toISOString(), points } })
})

const select = page.getByRole('combobox', { name: '対象年' })
const help = page.getByRole('button', { name: '土地価格の出典について' })
async function ready() {
  await expect(page.getByRole('status')).toHaveAttribute('data-loading', 'false')
  await expect(page.locator('.map-canvas')).toHaveAttribute('data-rendered', 'true')
}

try {
  await page.goto(origin)
  await ready()
  await expect(page.locator('.dataset-button')).toHaveCount(2)
  await expect(page.getByRole('button', { name: /土地価格 土地1㎡/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: /マンション取引価格 中古/ })).toBeVisible()
  await select.selectOption('2025')
  await ready()
  await expect(page.locator('.area-summary .section-heading')).toContainText('3地点')
  await expect(page.locator('.big-metric')).toContainText('90')
  await expect(page.locator('.rank-row').first()).toContainText('120')
  await expect(page.locator('.rank-row').filter({ hasText: '共通地点' })).toHaveCount(1)
  await expect(page.locator('.rank-row').filter({ hasText: '公示地価だけの地点' })).toHaveCount(1)
  await expect(page.locator('.rank-row').filter({ hasText: '基準地価だけの地点' })).toHaveCount(1)

  await help.hover()
  await expect(page.getByRole('tooltip')).toContainText(
    '公示地価（1月1日時点）と基準地価（7月1日時点）',
  )
  await page.getByRole('tooltip').hover()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.locator('h1').hover()
  await expect(page.getByRole('tooltip')).toBeHidden()
  await help.focus()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toBeHidden()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('tooltip')).toBeVisible()
  await mkdir('tmp/screenshots', { recursive: true })
  await page.screenshot({ path: 'tmp/screenshots/land-prices-tooltip-desktop.png', fullPage: true })
  await page.keyboard.press('Escape')

  await page.locator('.rank-row').first().click()
  const detail = page.getByRole('complementary', { name: '地点の詳細' })
  const history = detail.getByRole('region', { name: '価格の推移' })
  await expect(history).toHaveAttribute('aria-busy', 'false')
  await expect(detail.locator('.detail-price')).toContainText('120')
  await expect(detail.locator('.detail-period')).toContainText('2025年7月1日')
  await expect(detail.locator('.detail-change')).toContainText('+2.0%')
  await expect(detail.locator('.detail-change')).toContainText('2024年7月1日 → 2025年7月1日')
  await detail.getByText('年ごとの数値を見る', { exact: true }).click()
  await expect(detail.locator('tr').filter({ hasText: '2024' })).toContainText('1月1日')
  await expect(detail.locator('tr').filter({ hasText: '2024' })).toContainText('100')
  await select.selectOption('2024')
  await ready()
  await expect(detail.locator('.detail-price')).toContainText('100')
  await expect(detail.locator('.detail-period')).toContainText('2024年1月1日')
  await select.selectOption('2026')
  await ready()
  await expect(detail.locator('.detail-price')).toContainText('140')
  await expect(detail.locator('.detail-period')).toContainText('2026年1月1日')
  await select.selectOption('2025')
  await ready()
  await expect(detail.locator('.detail-price')).toContainText('120')

  await detail.getByRole('button', { name: '詳細を閉じる' }).click()
  await select.selectOption('2023')
  await ready()
  await expect(page.getByRole('status')).toContainText('一部の地域')
  await expect(page.locator('.area-summary .section-heading')).toContainText('2地点')
  const landRequests = () =>
    requests.filter((url) => url.includes('dataset=land') && url.includes('year=2023')).length
  const before = landRequests()
  failSurvey2023 = false
  await page.getByRole('button', { name: '再試行', exact: true }).click()
  await ready()
  await expect(page.locator('.area-summary .section-heading')).toContainText('3地点')
  assert.equal(landRequests(), before)

  await select.selectOption('1995')
  await ready()
  assert.ok(!requests.some((url) => url.includes('dataset=survey') && /year=199[56]/.test(url)))
  await page.getByRole('button', { name: /マンション取引価格 中古/ }).click()
  await ready()
  await expect(select).toHaveValue('2005')
  await expect(page.getByRole('button', { name: '前年比（%）' })).toBeDisabled()
  await page.getByRole('button', { name: /土地価格 土地1㎡/ }).click()
  await select.selectOption('2025')
  await ready()
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    if (!(await page.locator('.sidebar').getAttribute('class'))?.includes('is-open'))
      await page.getByRole('button', { name: 'データパネルを開く' }).click()
    await help.click()
    await expect(page.getByRole('tooltip')).toBeInViewport()
    await expect(page.getByRole('tooltip')).toContainText('建物の価格は含みません')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({
      path: `tmp/screenshots/land-prices-tooltip-${width}.png`,
      fullPage: true,
    })
    await page.locator('h1').click()
    await expect(page.getByRole('tooltip')).toBeHidden()
  }
  assert.deepEqual(errors, [])
  console.log(
    'PASS: unified sites, latest prices, independent neighbors, history source changes, partial failure retry, coverage, and accessible desktop/mobile tooltip',
  )
} finally {
  await context.close()
  await browser.close()
}
