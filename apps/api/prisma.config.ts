import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { defineConfig } from 'prisma/config'

// Prisma 7: the datasource URL lives here, not in schema.prisma. Outside production the repo-root `.env` is loaded
// without overriding variables already set (same rule as src/config/dotenv.ts; inlined so the runtime image, which
// runs `prisma migrate deploy` from this file, needs no TypeScript sources).
if (process.env.NODE_ENV !== 'production') {
  const envFile = fileURLToPath(new URL('../../.env', import.meta.url))
  if (existsSync(envFile)) {
    for (const [key, value] of Object.entries(parseEnv(readFileSync(envFile, 'utf8')))) {
      if (process.env[key] === undefined) process.env[key] = value
    }
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // `prisma generate` does not connect; a placeholder keeps it working without a database (Docker build).
    url: process.env.DATABASE_URL ?? 'postgresql://unset:unset@localhost:5432/unset',
  },
})
