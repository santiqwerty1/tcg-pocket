import { defineConfig } from 'vitest/config'

// Unit tests: pure helpers and guards, no database.
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
    env: { NODE_ENV: 'test' },
  },
})
