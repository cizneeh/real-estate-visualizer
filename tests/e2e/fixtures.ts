import { mkdir } from 'node:fs/promises'
import { test as base, expect, type Page } from '@playwright/test'

export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const errors: string[] = []
    const unexpected: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('status of 502'))
        errors.push(message.text())
    })
    await page.context().route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin === baseURL) return route.continue()
      if (url.origin === 'https://fonts.googleapis.com')
        return route.fulfill({ contentType: 'text/css', body: '' })
      if (url.href === 'https://tiles.openfreemap.org/styles/dark') {
        return route.fulfill({
          json: {
            version: 8,
            glyphs: 'https://fixture.invalid/glyphs/{fontstack}/{range}.pbf',
            sources: {
              openmaptiles: {
                type: 'vector',
                tiles: ['https://fixture.invalid/tiles/{z}/{x}/{y}.pbf'],
                minzoom: 0,
                maxzoom: 14,
              },
            },
            layers: [
              { id: 'background', type: 'background', paint: { 'background-color': '#101b2d' } },
            ],
          },
        })
      }
      if (url.origin === 'https://fixture.invalid' && url.pathname.startsWith('/tiles/'))
        return route.fulfill({
          status: 200,
          contentType: 'application/x-protobuf',
          body: Buffer.alloc(0),
        })
      if (url.origin === 'https://fixture.invalid' && url.pathname.startsWith('/glyphs/')) {
        const [, , font, range] = url.pathname.split('/')
        const name = Buffer.from(decodeURIComponent(font))
        const span = Buffer.from(range.replace('.pbf', ''))
        const stack = Buffer.concat([
          Buffer.from([10, name.length]),
          name,
          Buffer.from([18, span.length]),
          span,
        ])
        return route.fulfill({
          contentType: 'application/x-protobuf',
          body: Buffer.concat([Buffer.from([10, stack.length]), stack]),
        })
      }
      unexpected.push(url.origin + url.pathname)
      return route.abort()
    })
    await use(page)
    expect(unexpected, 'unexpected external requests').toEqual([])
    expect(errors, 'browser runtime and rendering errors').toEqual([])
  },
})

export async function ready(page: Page) {
  await expect(page.getByRole('status')).toHaveAttribute('data-loading', 'false')
  await expect(page.locator('.map-canvas')).toHaveAttribute('data-rendered', 'true')
}

export async function openPanel(page: Page) {
  const button = page.getByRole('button', { name: 'データパネルを開く' })
  if (
    (await button.isVisible()) &&
    !(await page.locator('.sidebar').getAttribute('class'))?.includes('is-open')
  )
    await button.click()
}

export async function closePanel(page: Page) {
  const button = page
    .locator('.sidebar')
    .getByRole('button', { name: 'データパネルを閉じる', exact: true })
  if (await button.isVisible()) await button.click()
}

export async function pricePixels(page: Page) {
  return page.locator('.maplibregl-canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement
    const gl = canvas.getContext('webgl2')
    if (!gl || gl.isContextLost()) return { count: 0 }
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
    gl.readPixels(
      0,
      0,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    )
    let colored = 0
    let point: { x: number; y: number } | undefined
    const bounds = canvas.getBoundingClientRect()
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 40 && pixels[i + 1] > 70 && pixels[i + 2] > 70) {
        colored++
        if (!point && pixels[i] > 80 && pixels[i + 1] > 140) {
          point = {
            x: ((((i / 4) % gl.drawingBufferWidth) + 0.5) / gl.drawingBufferWidth) * bounds.width,
            y:
              (1 - (Math.floor(i / 4 / gl.drawingBufferWidth) + 0.5) / gl.drawingBufferHeight) *
              bounds.height,
          }
        }
      }
    }
    return { count: colored, point }
  })
}

export async function renderedPricePixels(page: Page) {
  return (await pricePixels(page)).count
}

export async function screenshot(page: Page, name: string) {
  await mkdir('tmp/screenshots', { recursive: true })
  await page.screenshot({ path: `tmp/screenshots/ci-${name}.png`, fullPage: true })
}
