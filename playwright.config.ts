import { defineConfig } from '@playwright/test'

const port = process.env.E2E_PORT ?? '5190'
const origin = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: 'tmp/playwright',
  reporter: 'list',
  use: {
    baseURL: origin,
    browserName: 'chromium',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 960 } } },
    {
      name: 'mobile',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: 'npx tsx tests/e2e/server.ts',
    url: `${origin}/api/health`,
    env: { E2E_PORT: port },
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
