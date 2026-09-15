import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { tileAt, tileKey } from '../src/tiles'
import { TRANSACTION_TYPES, validTransactionType } from '../src/transactions'
import type { TransactionType } from '../src/types'

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
let failBuilding = true
await page.route('**/api/tiles/**', async (route) => {
  const url = new URL(route.request().url())
  requests.push(url)
  const source = url.searchParams.get('dataset')
  const type = url.searchParams.get('transactionType') ?? 'condominium'
  assert.ok(validTransactionType(type))
  if (source === 'transactions' && type === 'land-building' && failBuilding) {
    await route.fulfill({
      status: 502,
      json: { error: '取引データの取得失敗', upstreamStatus: 429 },
    })
    return
  }
  if (source === 'transactions' && type === 'land')
    await new Promise((resolve) => setTimeout(resolve, 100))
  const year = Number(url.searchParams.get('year'))
  const prices: Record<TransactionType, number[]> = {
    condominium: [500_000, 700_000, 9_000_000],
    land: [200_000, 400_000],
    'land-building': [800_000],
  }
  const points =
    !url.pathname.endsWith(centerKey) || source === 'survey' || year === 2005
      ? []
      : (source === 'transactions' ? prices[type] : [100_000]).map((price, i) => ({
          id: `${source}-${type}-${i}`,
          coordinates,
          price: price + (year === 2024 ? 100_000 : 0),
          change: 3,
          address: '確認用の地点',
          municipality: '千代田区',
          category: source === 'transactions' ? TRANSACTION_TYPES[type].label : '住宅地',
        }))
  await route.fulfill({ json: { fetchedAt: new Date().toISOString(), points } })
})

const select = page.getByRole('combobox', { name: '対象年' })
const detail = page.getByRole('complementary', { name: '地点の詳細' })
async function ready() {
  await expect(page.getByRole('status')).toHaveAttribute('data-loading', 'false')
  await expect(page.locator('.map-canvas')).toHaveAttribute('data-rendered', 'true')
}
async function choose(type: TransactionType) {
  await page
    .getByRole('button', {
      name: `${TRANSACTION_TYPES[type].label} ${TRANSACTION_TYPES[type].description}`,
      exact: true,
    })
    .click()
  await ready()
}

try {
  await page.goto(origin)
  await select.selectOption('2025')
  await ready()
  await expect(page.getByRole('group', { name: '取引の種別' })).toHaveCount(0)
  await page.getByRole('button', { name: '前年比（%）' }).click()
  await page.getByRole('button', { name: /取引価格 種別ごとの実際の取引/ }).click()
  await ready()
  await expect(page.getByRole('group', { name: '取引の種別' }).getByRole('button')).toHaveCount(3)
  await expect(page.getByRole('button', { name: '前年比（%）' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '価格', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.locator('.big-metric')).toHaveText('70万円 / ㎡')
  await expect(page.locator('.summary-foot')).toContainText('3件の取引')
  await page.locator('.rank-row').first().click()
  await expect(detail.locator('.detail-category')).toHaveText('中古マンション等')
  await expect(detail.locator('.price-history')).toHaveCount(0)
  await choose('land')
  await expect(detail).toHaveCount(0)
  await expect(page.locator('.big-metric')).toHaveText('30万円 / ㎡')
  await expect(page.locator('.summary-foot')).toContainText('2件の取引')
  await page.locator('.rank-row').first().click()
  await expect(detail.locator('.detail-price')).toHaveText('30万円 / ㎡')
  await expect(detail.locator('.detail-category')).toHaveText('宅地（土地）')
  await expect(detail.locator('.detail-note')).toContainText('土地のみの取引価格')
  await mkdir('tmp/screenshots', { recursive: true })
  await page.screenshot({ path: 'tmp/screenshots/transactions-land-desktop.png', fullPage: true })

  await choose('land-building')
  await expect(page.getByRole('status')).toContainText('取引データの取得失敗')
  await expect(page.locator('.rank-row')).toHaveCount(0)
  failBuilding = false
  await page.getByRole('button', { name: '再試行', exact: true }).click()
  await ready()
  await expect(page.locator('.big-metric')).toHaveText('80万円 / ㎡')
  await expect(
    page.getByRole('group', { name: '取引の種別' }).getByRole('button', { pressed: true }),
  ).toContainText('建物込みの取引総額 ÷ 土地面積')
  await page.locator('.rank-row').first().click()
  await expect(detail.locator('.detail-note')).toContainText('土地だけの価格ではありません')
  await page.getByRole('button', { name: '詳細を閉じる' }).click()
  await page.screenshot({
    path: 'tmp/screenshots/transactions-land-building-desktop.png',
    fullPage: true,
  })

  const centerCalls = () =>
    requests.filter(
      (url) => url.pathname.endsWith(centerKey) && url.searchParams.get('year') === '2025',
    ).length
  const before = centerCalls()
  await choose('condominium')
  await expect(page.locator('.big-metric')).toHaveText('70万円 / ㎡')
  await choose('land')
  await expect(page.locator('.big-metric')).toHaveText('30万円 / ㎡')
  assert.equal(centerCalls(), before)
  await select.selectOption('2024')
  await ready()
  await expect(page.locator('.big-metric')).toHaveText('40万円 / ㎡')
  await select.selectOption('2005')
  await ready()
  await expect(page.getByRole('status')).toContainText('対象データがありません')
  await expect(page.locator('.year-period')).toContainText('7〜12月')
  await page.getByRole('button', { name: /土地価格 土地1㎡/ }).click()
  await expect(page.getByRole('group', { name: '取引の種別' })).toHaveCount(0)
  await select.selectOption('1995')
  await ready()
  await page.getByRole('button', { name: /取引価格 種別ごとの実際の取引/ }).click()
  await ready()
  await expect(select).toHaveValue('2005')
  await expect(
    page.getByRole('button', { name: '宅地（土地） 土地のみの取引', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await select.selectOption('2025')
  await ready()
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    if (!(await page.locator('.sidebar').getAttribute('class'))?.includes('is-open')) {
      await page.getByRole('button', { name: 'データパネルを開く' }).click()
    }
    await choose('land-building')
    await expect(page.getByRole('group', { name: '取引の種別' })).toBeInViewport()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: `tmp/screenshots/transactions-${width}.png`, fullPage: true })
    await choose('land')
  }
  assert.deepEqual(errors, [])
  console.log(
    'PASS: transaction type hierarchy, distinct medians and counts, selection reset, retry, cache reuse, years, and mobile layout',
  )
} finally {
  await context.close()
  await browser.close()
}
