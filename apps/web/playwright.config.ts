/**
 * Tests de pantallas (Fase 34): `pnpm -F @tcg/web test:screens` builds nothing — it needs `@tcg/domain`, `@tcg/api`,
 * `@tcg/web` and `@tcg/worker` built — prepares a throwaway database, starts the API serving the built PWA on port
 * 3210 and drives Chromium (phone size) through the main flows.
 */
import { defineConfig, devices } from '@playwright/test'
import { BASE_URL, DATABASE_URL, FAKE_ENGINE_REV, OWNER, PORT, SESSION_SECRET, STORAGE_STATE } from './e2e/settings.ts'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    ...devices['Pixel 7'],
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'pantallas', testMatch: /\.spec\.ts/, dependencies: ['setup'], use: { storageState: STORAGE_STATE } },
  ],
  webServer: {
    command: 'node e2e/prepare.mjs && node ../api/dist/main.js',
    url: `${BASE_URL}/healthz`,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      PORT: String(PORT),
      DATABASE_URL,
      SESSION_SECRET,
      ENGINE_REV: FAKE_ENGINE_REV,
      OWNER_EMAIL: OWNER.email,
      OWNER_PASSWORD: OWNER.password,
      COOKIE_SECURE: 'false',
      LIMITLESS_SYNC: 'false',
      BACKUP_CRON: 'false',
      NOTIFICATIONS_WATCH: 'false',
    },
  },
})
