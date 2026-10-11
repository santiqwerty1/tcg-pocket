import { defineConfig } from 'vitest/config'

// D-023: several tests start the engine (real or fake) as processes; on the shared CI machines 5 s is not enough.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], testTimeout: process.env.CI ? 20_000 : 5_000 },
})
