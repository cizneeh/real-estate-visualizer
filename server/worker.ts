import { createApp } from './app'
import { createEdgeTileStore } from './edgeTileStore'

export default {
  fetch(request, env, ctx) {
    const store = createEdgeTileStore({
      cache: caches.default,
      origin: new URL(request.url).origin,
      waitUntil: (promise) => ctx.waitUntil(promise),
    })
    const app = createApp(() => env.REINFOLIB_API_KEY, store)
    return app.fetch(request)
  },
} satisfies ExportedHandler<Env>
