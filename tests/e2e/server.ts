import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Feature } from 'geojson'
import { createApp } from '../../server/app'

const center = [139.7671, 35.6812]
const point = (properties: Record<string, unknown>, coordinates = center): Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates },
  properties,
})

const app = createApp(() => 'fixture-key', {
  async get(rawUrl) {
    const url = new URL(rawUrl)
    const year = Number(url.searchParams.get('year'))
    let features: Feature[]
    if (url.pathname.endsWith('/XKT015')) {
      features = [point({ S12_001_ja: '東京' })]
    } else if (url.pathname.endsWith('/XPT001')) {
      features = [50_000_000, 70_000_000].map((price) =>
        point({
          u_transaction_price_total_ja: `${price}円`,
          u_area_ja: '50㎡',
          city_name_ja: '千代田区',
          district_name_ja: '丸の内',
          land_type_name_ja: '中古マンション等',
          point_in_time_name_ja: '2025年第4四半期',
        }),
      )
    } else if (url.pathname.endsWith('/XPT002')) {
      const survey = url.searchParams.get('priceClassification') === '1'
      const price = (survey ? 1_200_000 : 1_000_000) - (year === 2024 ? 100_000 : 0)
      const common = {
        land_price_type: survey ? 1 : 0,
        point_id: 'ci-site-a',
        location: '東京都千代田区丸の内１丁目１番',
        residence_display_name_ja: 'CI丸の内',
        u_current_years_price_ja: `${price}(円/㎡)`,
        last_years_price: price - 100_000,
        year_on_year_change_rate: '5.0',
        use_category_name_ja: '1,住宅地',
        ward_town_village_name_ja: '千代田区',
        u_cadastral_ja: '200(㎡)',
      }
      features = survey
        ? [point(common)]
        : [
            point(common),
            point(
              {
                ...common,
                point_id: 'ci-site-b',
                location: '東京都千代田区丸の内２丁目',
                residence_display_name_ja: 'CI隣接地点',
                u_current_years_price_ja: '800000(円/㎡)',
              },
              [center[0] + 0.003, center[1] + 0.001],
            ),
          ]
    } else {
      throw new Error('Unexpected fixture upstream URL')
    }
    return { at: Date.now(), features }
  },
})
app.use('*', serveStatic({ root: './dist' }))
app.get('*', serveStatic({ path: './dist/index.html' }))
const server = serve({
  fetch: app.fetch,
  hostname: '127.0.0.1',
  port: Number(process.env.E2E_PORT ?? 5190),
})
process.on('SIGINT', () => server.close())
process.on('SIGTERM', () => server.close())
