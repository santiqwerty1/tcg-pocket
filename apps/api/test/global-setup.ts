/**
 * vitest globalSetup for the e2e suite: makes sure TEST_DATABASE_URL exists, applies the Prisma migrations to it and
 * truncates every table, so each run starts from a clean, migrated database.
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import pg from 'pg'
import { API_ROOT, loadDotEnv } from '../src/config/dotenv.js'

async function ensureDatabase(url: string): Promise<void> {
  const target = new URL(url)
  const name = decodeURIComponent(target.pathname.slice(1))
  const admin = new URL(url)
  admin.pathname = '/postgres'
  const client = new pg.Client({ connectionString: admin.toString() })
  await client.connect()
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`)
  } finally {
    await client.end()
  }
}

export async function truncateAllTables(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const tables = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
    )
    if (tables.rows.length === 0) return
    const list = tables.rows.map((row) => `"${row.tablename}"`).join(', ')
    await client.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`)
  } finally {
    await client.end()
  }
}

export default async function globalSetup(): Promise<void> {
  loadDotEnv()
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('TEST_DATABASE_URL is required (see .env.example)')
  await ensureDatabase(url)
  execFileSync(process.execPath, [join(API_ROOT, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'], {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  })
  await truncateAllTables(url)
}
