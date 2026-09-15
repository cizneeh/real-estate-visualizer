import { expect } from '@playwright/test'
import {
  closePanel,
  openPanel,
  pricePixels,
  ready,
  renderedPricePixels,
  screenshot,
  test,
} from './fixtures'

test('land prices, year selection, history, and all rendering modes', async ({ page }, info) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Landloom')
  await ready(page)
  await openPanel(page)
  const year = page.getByRole('combobox', { name: '対象年' })
  await year.selectOption('2025')
  await ready(page)
  await expect(page.locator('.rank-row')).toHaveCount(2)
  await expect(page.locator('.rank-row').first()).toContainText('CI丸の内')
  await expect(page.locator('.rank-row').first()).toContainText('120')
  await expect(page.locator('.big-metric')).toContainText('100')
  await year.selectOption('2024')
  await ready(page)
  await expect(page.locator('.rank-row').first()).toContainText('110')
  await year.selectOption('2025')
  await ready(page)
  await page.locator('.rank-row').first().click()
  const detail = page.getByRole('complementary', { name: '地点の詳細' })
  await expect(detail).toBeInViewport()
  await expect(detail.locator('.detail-price')).toContainText('120')
  await expect(detail.getByRole('region', { name: '価格の推移' })).toHaveAttribute(
    'aria-busy',
    'false',
  )
  await expect(detail.locator('svg.history-chart')).toBeVisible()
  await screenshot(page, `${info.project.name}-detail`)
  await detail.getByRole('button', { name: '詳細を閉じる' }).click()
  await closePanel(page)
  for (const title of ['3D表示', 'ポイント表示', 'ヒート表示']) {
    const button = page.getByTitle(title, { exact: true })
    await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    await ready(page)
    await expect
      .poll(() => renderedPricePixels(page), { message: `${title} must draw price pixels` })
      .toBeGreaterThan(50)
    await screenshot(page, `${info.project.name}-${title}`)
  }
  await page.getByTitle('ポイント表示', { exact: true }).click()
  await ready(page)
  await expect.poll(async () => (await pricePixels(page)).point).toBeDefined()
  const { point } = await pricePixels(page)
  if (!point) throw new Error('No rendered price point to click')
  await page.locator('.maplibregl-canvas').click({ position: point })
  await expect(detail).toBeInViewport()
  await expect(detail.locator('.detail-price')).toContainText(/120|80/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('transaction groups, metric controls, and viewport', async ({ page }, info) => {
  await page.goto('/')
  await ready(page)
  await openPanel(page)
  await page.getByRole('button', { name: '前年比（%）' }).click()
  await ready(page)
  await expect(page.locator('.big-metric')).toContainText('%')
  await expect(page.getByTitle('前年比は3Dまたはポイントで表示します')).toBeDisabled()
  await page.getByRole('button', { name: /取引価格 種別ごとの/ }).click()
  await page.getByRole('combobox', { name: '対象年' }).selectOption('2025')
  await ready(page)
  await expect(page.getByRole('button', { name: '前年比（%）' })).toBeEnabled()
  await expect(page.locator('.rank-row')).toHaveCount(1)
  await expect(page.locator('.rank-row').first()).toContainText('東京駅')
  await expect(page.locator('.rank-row').first()).toContainText('120')
  await expect(page.locator('.summary-foot')).toContainText('5件の取引')
  await page.locator('.rank-row').first().click()
  const detail = page.getByRole('complementary', { name: '地点の詳細' })
  await expect(detail).toBeInViewport()
  await expect(detail.locator('.detail-price')).toContainText('120')
  await expect(detail.locator('.transaction-count')).toHaveText('2025年の取引件数5件')
  await expect(detail.locator('.transaction-comparison h4')).toHaveText('取引単価の前年比 +20.0%')
  await expect(detail.getByText('地点の情報', { exact: true })).toHaveCount(0)
  const record = detail.locator('.transaction-record').first()
  await record.locator('summary').click()
  await expect(record.getByText('50㎡', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await screenshot(page, `${info.project.name}-transactions`)
  await detail.getByRole('button', { name: '詳細を閉じる' }).click()
  await openPanel(page)
  await page.getByRole('button', { name: '前年比（%）' }).click()
  await ready(page)
  await expect(page.locator('.big-metric')).toHaveText('+20.0%')
  await expect(page.locator('.year-period')).toHaveText('2025年1〜6月 / 2024年1〜6月')
  await closePanel(page)
  await expect(page.getByRole('group', { name: '取引の種別' })).toHaveCount(0)
  await openPanel(page)
  for (const [label, price] of [
    ['宅地（土地） 土地のみの取引', '30'],
    ['宅地（土地と建物） 建物込みの取引総額 ÷ 土地面積', '60'],
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await ready(page)
    await expect(page.locator('.big-metric')).toHaveText('+20.0%')
    await page.getByRole('button', { name: '価格', exact: true }).click()
    await expect(page.locator('.big-metric')).toHaveText(`${price}万円 / ㎡`)
    await page.getByRole('button', { name: '前年比（%）' }).click()
  }
})

test('failed requests can retry and empty years do not retain prices', async ({ page }, info) => {
  let fail = true
  await page.route('**/api/tiles/**', (route) => {
    const year = new URL(route.request().url()).searchParams.get('year')
    if (year === '2023' && fail)
      return route.fulfill({ status: 502, json: { error: 'CI接続エラー', upstreamStatus: 429 } })
    if (year === '2022')
      return route.fulfill({ json: { fetchedAt: new Date().toISOString(), points: [] } })
    return route.continue()
  })
  await page.goto('/')
  await ready(page)
  await openPanel(page)
  const year = page.getByRole('combobox', { name: '対象年' })
  await year.selectOption('2023')
  await expect(page.getByRole('status')).toContainText('CI接続エラー')
  fail = false
  await closePanel(page)
  await screenshot(page, `${info.project.name}-error`)
  await page.getByRole('button', { name: '再試行', exact: true }).click()
  await ready(page)
  await expect(page.getByRole('status')).toContainText('地点を表示中')
  await openPanel(page)
  await expect(page.locator('.rank-row')).toHaveCount(2)
  await year.selectOption('2022')
  await ready(page)
  await expect(page.getByRole('status')).toContainText('対象データがありません')
  await expect(page.locator('.rank-row')).toHaveCount(0)
  await expect(page.locator('.big-metric')).toContainText('—')
  await closePanel(page)
  await expect.poll(() => renderedPricePixels(page)).toBe(0)
  await screenshot(page, `${info.project.name}-empty`)
})
