import { expect } from '@playwright/test'
import { openPanel, screenshot, test } from './fixtures'

test.use({ reducedMotion: 'no-preference' })

test('history reveals catch up with incoming data and finish as soon as loading ends', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const animate = Element.prototype.animate
    Element.prototype.animate = function (keyframes, options) {
      const animation = animate.call(this, keyframes, options)
      if (this.matches('.history-line, .history-dot')) animation.pause()
      return animation
    }
  })
  const releases = new Map<number, () => void>()
  const gates = new Map(
    [2022, 2024, 2025].map((year) => [
      year,
      new Promise<void>((resolve) => releases.set(year, resolve)),
    ]),
  )
  await page.route('**/api/tiles/**', async (route) => {
    const url = new URL(route.request().url())
    const year = Number(url.searchParams.get('year'))
    const land = url.searchParams.get('dataset') === 'land'
    if (land) await gates.get(year)
    await route.fulfill({
      json: {
        fetchedAt: new Date().toISOString(),
        points:
          land && year >= 2022
            ? [
                {
                  id: '0-1',
                  historyId: '0-1',
                  coordinates: [139.7671, 35.6812],
                  location: '東京都千代田区丸の内１丁目１番',
                  address: '東京都千代田区丸の内１丁目',
                  municipality: '千代田区',
                  category: '住宅地',
                  price: (year - 2021) * 400_000,
                  change: 5,
                },
              ]
            : [],
      },
    })
  })
  try {
    await page.goto('/')
    await openPanel(page)
    await page.locator('.rank-row').first().click()
    const detail = page.getByRole('complementary', { name: '地点の詳細' })
    const region = detail.getByRole('region', { name: '価格の推移' })
    const chart = detail.locator('.history-chart')
    await expect(chart.locator('.history-loading-band')).toHaveCount(3)
    await expect(detail.locator('.spin, .history-progress')).toHaveCount(0)
    await chart.scrollIntoViewIfNeeded()
    await screenshot(page, `${info.project.name}-history-bands`)

    releases.get(2022)?.()
    const olderLine = chart.locator('.history-line[data-year="2022"]')
    await expect(olderLine).toHaveCount(1)
    expect(await olderLine.evaluate((element) => element.getAnimations()[0]?.playState)).toBe(
      'paused',
    )

    releases.get(2025)?.()
    const previousLine = chart.locator('.history-line[data-year="2025"]')
    await expect(previousLine).toHaveCount(1)
    const reveal = await previousLine.evaluate((element) => {
      const animation = element.getAnimations()[0]
      const effect = animation.effect as KeyframeEffect
      return {
        duration: effect.getTiming().duration,
        offset: effect.getKeyframes()[0].strokeDashoffset,
      }
    })
    expect(Number(reveal.duration)).toBeLessThanOrEqual(180)
    expect(Number.parseFloat(String(reveal.offset))).toBe(-1)
    expect(await olderLine.evaluate((element) => element.getAnimations().length)).toBe(0)

    releases.get(2024)?.()
    await expect(region).toHaveAttribute('aria-busy', 'false')
    await expect(chart.locator('.history-line')).toHaveCount(4)
    expect(await chart.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(
      0,
    )
    await expect(chart.locator('.history-loading-band')).toHaveCount(0)
    await screenshot(page, `${info.project.name}-history-complete`)

    await detail.getByRole('button', { name: '詳細を閉じる' }).click()
    await openPanel(page)
    await page.locator('.rank-row').first().click()
    await expect(chart.locator('.history-line')).toHaveCount(4)
    expect(await chart.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(
      0,
    )
  } finally {
    for (const release of releases.values()) release()
  }
})
