import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // D-023: two CI runners share the PC with Postgres and the simulation worker.
    ...(process.env.CI ? { maxWorkers: 4 } : {}),
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 30_000,
  },
})
