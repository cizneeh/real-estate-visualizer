import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { tileBounds } from '../src/tiles'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } })
page.setDefaultTimeout(15_000)
const errors: string[] = []
const requests: { dataset: string; year: number }[] = []
page.on('pageerror', (error) => errors.push(error.message))
await page.route('**/api/tiles/**', async (route) => {
  const url = new URL(route.request().url())
  const dataset = url.searchParams.get('dataset') ?? ''
  const year = Number(url.searchParams.get('year'))
  requests.push({ dataset, year })
  const [z, x, y] = url.pathname.slice('/api/tiles/'.length).split('/').map(Number)
  const [west, south, east, north] = tileBounds({ z, x, y })
  await route.fulfill({
    json: {
      fetchedAt: new Date().toISOString(),
      points: [
        {
          id: `${dataset}-${year}-${x}-${y}`,
          coordinates: [(west + east) / 2, (south + north) / 2],
          price: year * 100,
          change: -2,
          address: `${year}年の検証用地点`,
          municipality: '東京都',
          category: '住宅地',
        },
      ],
    },
  })
})

const select = page.getByRole('combobox', { name: '観測年' })
async function ready(year: number) {
  await expect(select).toHaveValue(String(year))
  await expect(page.getByRole('status')).toContainText('地点を表示中')
  await expect(page.getByRole('status')).toHaveAttribute('data-loading', 'false')
  await expect(page.locator('.map-canvas')).toHaveAttribute('data-rendered', 'true')
  await expect(page.getByRole('button', { name: `${year}年を表示` })).toBeInViewport()
}

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5187/')
  await ready(2025)
  await select.selectOption('1995')
  await ready(1995)
  await expect(select.locator('option').first()).toHaveValue('1995')
  await page.getByRole('button', { name: /地価の変化 公示地価の前年比/ }).click()
  await ready(1995)
  await page.getByRole('button', { name: /基準地価 7月1日時点/ }).click()
  await ready(1997)
  await expect(select.locator('option').first()).toHaveValue('1997')
  await page.getByRole('button', { name: /マンション取引 中古マンション等/ }).click()
  await ready(2005)
  await page.getByRole('button', { name: 'データ・表示について' }).click()
  await expect(page.getByRole('dialog')).toContainText('2005年の取引は7〜12月のみ')
  await page.getByRole('button', { name: '説明を閉じる' }).click()
  await expect(select.locator('option').first()).toHaveValue('2005')
  assert.ok(
    !requests.some(
      ({ dataset, year }) =>
        year < (dataset === 'survey' ? 1997 : dataset === 'transactions' ? 2005 : 1995),
    ),
  )
  console.log(
    'PASS: historical selection, dataset-specific ranges, and clamping without unsupported requests',
  )

  const lastYear = new Date().getFullYear()
  for (const [name, firstYear] of [
    [/マンション取引 中古マンション等/, 2005],
    [/基準地価 7月1日時点/, 1997],
    [/公示地価 1月1日時点/, 1995],
  ] as const) {
    await page.getByRole('button', { name }).click()
    await select.selectOption(String(lastYear))
    await ready(lastYear)
    await page.getByRole('button', { name: '年度を自動再生', exact: true }).click()
    await expect(select).toHaveValue(String(firstYear))
    await ready(firstYear)
    await expect(select).toHaveValue(String(firstYear + 1))
    await page.getByRole('button', { name: '年度の自動再生を停止', exact: true }).click()
    await ready(firstYear + 1)
  }
  console.log(
    'PASS: playback wraps to each dataset’s first year and continues to the following year',
  )

  await mkdir('tmp/screenshots', { recursive: true })
  for (const width of [1512, 390, 320]) {
    await page.setViewportSize({ width, height: width > 800 ? 982 : 844 })
    await select.selectOption('2010')
    await ready(2010)
    await select.selectOption('1995')
    await ready(1995)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    await page.screenshot({ path: `tmp/screenshots/history-${width}.png`, fullPage: true })
  }
  await page.getByRole('button', { name: '1996年を表示' }).click()
  await ready(1996)
  assert.deepEqual(errors, [])
  console.log(
    'PASS: desktop and mobile year controls, active-year visibility, and no page errors or overflow',
  )
} finally {
  await browser.close()
}
