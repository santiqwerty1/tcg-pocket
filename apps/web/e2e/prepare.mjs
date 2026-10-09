// Tests de pantallas (Fase 34): before the server starts — the throwaway database created (if missing), migrated and
// emptied, the owner (no TOTP) and the catalog from the fixtures. Needs `@tcg/api` built (dist/). The environment
// (DATABASE_URL, OWNER_EMAIL, OWNER_PASSWORD, ENGINE_REV…) comes from playwright.config.ts.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const API_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'api')
const require = createRequire(join(API_ROOT, 'package.json'))
const pg = require('pg')
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')

const target = new URL(url)
const name = decodeURIComponent(target.pathname.slice(1))
const admin = new URL(url)
admin.pathname = '/postgres'
const adminClient = new pg.Client({ connectionString: admin.toString() })
await adminClient.connect()
try {
  const exists = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
  if (exists.rowCount === 0) await adminClient.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`)
} finally {
  await adminClient.end()
}

const run = (args) => execFileSync(process.execPath, args, { cwd: API_ROOT, env: process.env, stdio: 'inherit' })
run([join(API_ROOT, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'])

const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  const tables = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
  )
  if (tables.rows.length > 0) {
    await client.query(`TRUNCATE ${tables.rows.map((row) => `"${row.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`)
  }
} finally {
  await client.end()
}

run([join(API_ROOT, 'dist', 'cli', 'owner-init.js'), '--no-totp'])
run([join(API_ROOT, 'dist', 'cli', 'catalog-sync.js'), '--from-fixtures', '--engine-rev', process.env.ENGINE_REV])
