import { defineConfig } from 'vitest/config'

// Unit tests: pure helpers and guards, no database.
export default defineConfig({
  test: {
    // D-023: two CI runners share the PC with Postgres and the simulation worker.
    ...(process.env.CI ? { maxWorkers: 4 } : {}),
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
    env: { NODE_ENV: 'test' },
  },
})
