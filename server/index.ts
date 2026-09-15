import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from './app'
import { loadEnvironment } from './environment'

loadEnvironment()
const app = createApp(
  () =>
    process.env.REINFOLIB_API_KEY ??
    process.env.MLIT_API_KEY ??
    process.env.REAL_ESTATE_API_KEY ??
    process.env.API_KEY,
)
app.use('*', serveStatic({ root: './dist' }))
app.get('*', serveStatic({ path: './dist/index.html' }))

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 8787 }, () => {
  console.log('API server ready: http://127.0.0.1:8787')
})
process.on('SIGINT', () => server.close())
process.on('SIGTERM', () => server.close())
