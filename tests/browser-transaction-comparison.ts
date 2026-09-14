import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { tileAt, tileKey } from '../src/tiles'
import type { PricePoint } from '../src/types'

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
const requests: URL[] = []
let failPrevious = true

function records(
  year: number,
  price: number,
  count: number,
  quarter = 2,
  longitude = coordinates[0],
): PricePoint[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${year}-${quarter}-${longitude}-${i}`,
    coordinates: [longitude, coordinates[1]],
    price,
    totalPrice: price * 50,
    area: 50,
    period: `${year}年第${quarter}四半期`,
    address: '千代田区丸の内',
    municipality: '千代田区',
    category: '中古マンション等',
    usage: '２ＬＤＫ',
    zoning: '商業地域',
  }))
}
await page.route('**/api/tiles/**', async (route) => {
  const url = new URL(route.request().url())
  requests.push(url)
  const year = Number(url.searchParams.get('year'))
  const isTransaction = url.searchParams.get('dataset') === 'transactions'
  if (isTransaction && year === 2024 && failPrevious) {
    await route.fulfill({ status: 502, json: { error: '前年の取得失敗', upstreamStatus: 429 } })
    return
  }
  const isLand = url.searchParams.get('transactionType') === 'land'
  const prices =
    year === 2025
      ? [
          ...records(year, isLand ? 600_000 : 1_200_000, 5),
          ...records(year, 2_000_000, 3, 2, 139.769),
          ...records(year, 800_000, 5, 2, 139.771),
        ]
      : year === 2024
        ? [
            ...records(year, 1_000_000, 5),
            ...records(year, 9_000_000, 8, 4),
            ...records(year, 1_000_000, 5, 2, 139.769),
          ]
        : year === 2007
          ? records(year, 100_000, 5)
          : year === 2005
            ? records(year, 100_000, 5, 4)
            : []
  await route.fulfill({
    json: {
      fetchedAt: new Date().toISOString(),
      points: isTransaction && url.pathname.endsWith(centerKey) ? prices : [],
    },
  })
})
const select = page.getByRole('combobox', { name: '対象年' })
const detail = page.getByRole('complementary', { name: '地点の詳細' })
async function ready() {
  await expect(page.getByRole('status', { includeHidden: true })).toHaveAttribute(
    'data-loading',
    'false',
  )
  await expect(page.locator('.map-canvas')).toHaveAttribute('data-rendered', 'true')
}
try {
  await page.goto(origin)
  await select.selectOption('2025')
  await page.getByRole('button', { name: /取引価格 種別ごとの実際の取引/ }).click()
  await ready()
  assert.equal(
    requests.filter(
      (url) =>
        url.searchParams.get('dataset') === 'transactions' &&
        url.searchParams.get('year') === '2024',
    ).length,
    0,
  )
  await page.locator('.rank-row').first().click()
  await ready()
  await expect(detail.locator('.transaction-count')).toHaveText('2025年の取引件数3件')
  await expect(detail.getByText('地点の情報', { exact: true })).toHaveCount(0)
  await expect(detail.locator('.comparison-status')).toContainText('取得に失敗')
  await expect(page.getByRole('status')).toContainText('前年の取引を取得できませんでした')
  failPrevious = false
  await page.getByRole('button', { name: '再試行', exact: true }).click()
  await ready()
  await expect(detail.locator('.comparison-status')).toContainText('件数不足')
  await expect(detail.locator('.transaction-comparison')).toContainText('3件')
  await expect(detail.locator('.transaction-comparison')).toContainText('5件')
  await expect(detail.locator('.transaction-comparison h4')).toContainText('—')
  const record = detail.locator('.transaction-record').first()
  await expect(record).not.toHaveAttribute('open', '')
  await record.locator('summary').click()
  await expect(record.getByText('10,000万円', { exact: true })).toBeVisible()
  await expect(record.getByText('50㎡', { exact: true })).toBeVisible()
  await expect(record.getByText('２ＬＤＫ', { exact: true })).toBeVisible()
  await expect(record.getByText('千代田区丸の内', { exact: true })).toBeVisible()
  await record.locator('summary').click()
  await expect(record.getByText('50㎡', { exact: true })).not.toBeVisible()
  await page.getByRole('button', { name: '詳細を閉じる' }).click()
  await page.getByRole('button', { name: '前年比（%）' }).click()
  await ready()
  await expect(page.locator('.big-metric')).toHaveText('+20.0%')
  await expect(page.locator('.year-period')).toHaveText('2025年1〜6月 / 2024年1〜6月')
  await expect(page.locator('.rank-row')).toHaveCount(1)
  await expect(page.locator('.area-summary')).toContainText('1 / 3地点で比較')
  await expect(page.locator('.missing-change-legend')).toContainText('灰色')
  await page.locator('.rank-row').first().click()
  await ready()
  await expect(detail.locator('.transaction-comparison h4')).toHaveText('取引単価の前年比 +20.0%')
  await expect(detail.locator('.transaction-comparison tbody tr').nth(1)).toHaveText(
    '2024年100万円5件',
  )
  await expect(detail.locator('.transaction-count')).toHaveText('2025年の取引件数5件')
  await expect(detail.locator('.transaction-details > .transaction-records > details')).toHaveCount(
    5,
  )
  await detail.locator('.previous-transactions > summary').click()
  await expect(detail.locator('.previous-transactions .transaction-record')).toHaveCount(5)
  await detail.locator('.previous-transactions > summary').click()
  await detail.locator('.transaction-record').first().locator('summary').click()
  await mkdir('tmp/screenshots', { recursive: true })
  await page.screenshot({
    path: 'tmp/screenshots/transaction-comparison-desktop.png',
    fullPage: true,
  })

  for (const width of [390, 320]) {
    await page.getByRole('button', { name: '詳細を閉じる' }).click()
    await page.setViewportSize({ width, height: 844 })
    await page.getByRole('button', { name: '現在地に戻る' }).click()
    await page.getByRole('button', { name: 'データパネルを開く' }).click()
    await expect(page.locator('.rank-row')).toHaveCount(1)
    await ready()
    await page.locator('.rank-row').first().click()
    await ready()
    await expect(detail).toBeVisible()
    await detail.locator('.transaction-record').first().locator('summary').click()
    await expect(
      detail.locator('.transaction-record').first().getByText('50㎡', { exact: true }),
    ).toBeVisible()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.ok(
      await detail
        .locator('.detail-scroll')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    )
    await page.screenshot({
      path: `tmp/screenshots/transaction-comparison-${width}.png`,
      fullPage: true,
    })
  }
  await page.setViewportSize({ width: 1512, height: 982 })
  await page.getByRole('button', { name: '詳細を閉じる' }).click()
  await page.getByRole('button', { name: '宅地（土地） 土地のみの取引', exact: true }).click()
  await ready()
  await expect(page.locator('.big-metric')).toHaveText('-40.0%')
  await page
    .getByRole('button', { name: '宅地（土地と建物） 建物込みの取引総額 ÷ 土地面積', exact: true })
    .click()
  await ready()
  await expect(page.locator('.big-metric')).toHaveText('+20.0%')
  const previousCalls = () =>
    requests.filter(
      (url) => url.searchParams.get('year') === '2024' && url.pathname.endsWith(centerKey),
    ).length
  const beforeReturn = previousCalls()
  await page.getByRole('button', { name: '宅地（土地） 土地のみの取引', exact: true }).click()
  await ready()
  await expect(page.locator('.big-metric')).toHaveText('-40.0%')
  assert.equal(previousCalls(), beforeReturn)
  await select.selectOption('2026')
  await ready()
  await expect(page.locator('.big-metric')).toHaveText('—')
  await expect(page.getByRole('status')).toContainText('対象データがありません')
  await select.selectOption('2007')
  await ready()
  await expect(page.locator('.big-metric')).toHaveText('—')
  await expect(page.getByRole('button', { name: '再試行', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '価格', exact: true }).click()
  await ready()
  await page.locator('.rank-row').first().click()
  await ready()
  await expect(detail.locator('.comparison-status')).toContainText('件数不足')
  await expect(detail.locator('.transaction-comparison tbody tr').nth(1)).toHaveText('2006年—0件')
  await select.selectOption('2005')
  await ready()
  await expect(detail.locator('.comparison-status')).toContainText('提供開始前')
  assert.equal(requests.filter((url) => url.searchParams.get('year') === '2004').length, 0)
  assert.deepEqual(errors, [])
  console.log(
    'PASS: lazy previous-year fetch, aligned quarters, distinct failure/empty/low counts, missing-rate ranking, per-trade expansion, type/year switches, and mobile details',
  )
} catch (error) {
  console.log(await detail.innerText())
  await page.screenshot({
    path: 'tmp/screenshots/transaction-comparison-failure.png',
    fullPage: true,
  })
  throw error
} finally {
  await context.close()
  await browser.close()
}
