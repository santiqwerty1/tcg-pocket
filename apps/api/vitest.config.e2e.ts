import { defineConfig } from 'vitest/config'
import { loadDotEnv } from './src/config/dotenv.js'

// End-to-end tests run the real Nest app (supertest) against TEST_DATABASE_URL.
// `test/global-setup.ts` creates the database if needed, applies the migrations and truncates every table.
loadDotEnv()
const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required for the e2e tests (see .env.example)')

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    // One database: run files one at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl,
      SESSION_SECRET: process.env.SESSION_SECRET ?? 'e2e-session-secret-e2e-session-secret-0123456789',
      LOG_LEVEL: 'silent',
    },
  },
})
