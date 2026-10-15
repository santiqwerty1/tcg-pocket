import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

/**
 * The URL for Prisma's command line (`migrate deploy`, the release_command), from the app's. The app connects with
 * `pg`, which reads `sslmode=verify-full` and trusts the CA of `NODE_EXTRA_CA_CERTS`. Prisma's migration engine reads
 * neither: it takes `verify-full` as `prefer` and connected to a server with a certificate of any CA (the same finding
 * in chat-hub's H6.7). Its own words are `sslaccept=strict` and the CA's file in `sslcert`. Without a CA file, strict
 * with the system's roots: Supabase's private CA fails, loudly, instead of being accepted.
 *
 * The CA is the URL's `sslrootcert` (libpq's word, which `pg` also reads: the last one, and an empty one as absent)
 * or else `NODE_EXTRA_CA_CERTS`, made absolute from the working directory as Node does (Prisma would resolve a
 * relative path from `prisma/`). Prisma reads only the first certificate of that file: one CA per file
 * (certs/README.md).
 *
 * In production only `verify-full`, named once (as `parseEnv` for the app): with `require`, `verify-ca` or `prefer`
 * the migrations applied themselves to an impostor. `DATABASE_TLS=off` is only for trying the image (the docker job).
 */
export function migrationUrl(url: string, caFile: string | undefined, production = false, tlsOff = false): string {
  let parsed: URL | null = null
  try {
    parsed = new URL(url)
  } catch {}
  const modes = parsed?.searchParams.getAll('sslmode') ?? []
  const mode = modes.length === 1 ? modes[0] : null
  if (production && !tlsOff && mode !== 'verify-full') {
    throw new Error(
      'DATABASE_URL: in production it must carry sslmode=verify-full (DATABASE_TLS=off is only for trying the image)',
    )
  }
  if (!parsed || mode !== 'verify-full') return url
  const ca = parsed.searchParams.getAll('sslrootcert').at(-1) || caFile
  parsed.searchParams.delete('sslrootcert')
  parsed.searchParams.set('sslmode', 'require')
  parsed.searchParams.set('sslaccept', 'strict')
  if (ca) parsed.searchParams.set('sslcert', resolve(ca))
  return parsed.toString()
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // `prisma generate` does not connect; a placeholder keeps it working without a database (Docker build).
    url: process.env.DATABASE_URL
      ? migrationUrl(
          process.env.DATABASE_URL,
          process.env.NODE_EXTRA_CA_CERTS,
          process.env.NODE_ENV === 'production',
          process.env.DATABASE_TLS === 'off',
        )
      : 'postgresql://unset:unset@localhost:5432/unset',
  },
})
