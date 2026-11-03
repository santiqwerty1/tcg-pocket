import { spawn } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import pg from 'pg'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { API_ROOT } from '../src/config/dotenv.js'
import { ADVISORY_LOCKS } from '../src/prisma/advisory-locks.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/**
 * ranked/c1-dates (3/11/2026): the migration that moves the ranked season C1 from 30/11–14/12 (ptcgpocket.gg) to its
 * official 1/12–15/12. On a fresh database migrated from scratch, and on seeded cases: only the row that still has the
 * old dates moves, never into an overlap, never when a competitive match or a rank note sits on a day that changes
 * season, and under the ranks' lock.
 */
const MIGRATION_NAME = '20261103120000_ranked_season_c1_dates'
const MIGRATION = join(API_ROOT, 'prisma', 'migrations', MIGRATION_NAME, 'migration.sql')
const SQL = readFileSync(MIGRATION, 'utf8')

/**
 * `prisma migrate deploy` on a database, as the release does (each statement of a script sent on its own). With
 * `root`, the migrations of that directory (a scratch copy, through its own `prisma.config.mjs`).
 */
function deploy(databaseUrl: string, root?: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const cli = join(API_ROOT, 'node_modules', 'prisma', 'build', 'index.js')
    const child = spawn(
      process.execPath,
      root ? [cli, 'migrate', 'deploy', '--config', join(root, 'prisma.config.mjs')] : [cli, 'migrate', 'deploy'],
      { cwd: root ?? API_ROOT, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      output += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, output }))
  })
}

type Row = [code: string, startsOn: string, endsOn: string]
const OLD: Row = ['C1', '2026-11-30', '2026-12-14']
const NEW: Row = ['C1', '2026-12-01', '2026-12-15']
const B4A: Row = ['B4a', '2026-09-15', '2026-09-29']
const B4B: Row = ['B4bSP', '2026-10-14', '2026-10-28']

const day = (date: Date) => date.toISOString().slice(0, 10)

describe('migration 20261103120000_ranked_season_c1_dates (e2e)', () => {
  let test: TestApp
  let url: string
  let deckId: number
  let revisionId: number
  let cookie: string

  beforeAll(async () => {
    test = await createTestApp()
    url = test.env.databaseUrl
    await seedOwner(test.app, { totp: false })
    cookie = await login(test, { secret: null })
    const summary = await test.app
      .get(CatalogSyncService)
      .sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    expect(summary.status).toBe('applied')
    const deck = await test
      .http()
      .post('/api/decks')
      .set('Cookie', cookie)
      .send({ name: 'Mazo de prueba', energies: ['fire'], cards: [] })
    expect(deck.status).toBe(201)
    deckId = Number(deck.body.id)
    const stored = await test.prisma.deck.findUniqueOrThrow({ where: { id: deckId } })
    revisionId = stored.currentRevisionId as number
  })

  afterAll(async () => {
    await test.close()
  })

  /**
   * The migration's script on the seeded cases, as one query (Prisma sends each statement apart: the test with the real
   * `prisma migrate deploy` below checks that its explicit transaction holds the lock).
   */
  async function migrate(connectionString = url): Promise<void> {
    const client = new pg.Client({ connectionString })
    await client.connect()
    try {
      await client.query(SQL)
    } finally {
      await client.end()
    }
  }

  async function seasons(): Promise<Row[]> {
    const rows = await test.prisma.rankedSeason.findMany({ orderBy: { startsOn: 'asc' } })
    return rows.map((row) => [row.code, day(row.startsOn), day(row.endsOn)])
  }

  /** Only these seasons, and no matches nor rank notes. */
  async function reset(rows: Row[]): Promise<void> {
    await test.prisma.match.deleteMany()
    await test.prisma.rankChange.deleteMany()
    await test.prisma.rankedSeason.deleteMany()
    await test.prisma.rankedSeason.createMany({
      data: rows.map(([code, startsOn, endsOn]) => ({
        code,
        name: `Temporada ${code}`,
        startsOn: new Date(`${startsOn}T00:00:00Z`),
        endsOn: new Date(`${endsOn}T00:00:00Z`),
      })),
    })
  }

  async function match(playedAt: string, mode: 'competitive' | 'casual' = 'competitive'): Promise<void> {
    await test.prisma.match.create({
      data: { deckId, deckRevisionId: revisionId, result: 'win', mode, playedAt: new Date(playedAt) },
    })
  }

  it('takes the lock the app takes for every season edit (ADVISORY_LOCKS.rankNote), inside its one DO block', () => {
    const keys = [...SQL.matchAll(/\b(?:SELECT|PERFORM)\s+pg_advisory_xact_lock\((\d+)\)/g)].map((found) =>
      Number(found[1]),
    )
    expect(keys).toEqual([ADVISORY_LOCKS.rankNote])
    // One statement: no explicit transaction, and the lock and the UPDATE inside the same block.
    const code = SQL.replace(/^--.*$/gm, '').trim()
    expect(code).toMatch(
      /^DO \$\$\s*BEGIN\s+PERFORM pg_advisory_xact_lock\(\d+\);\s+UPDATE "ranked_seasons"[\s\S]*END\s*\$\$;$/,
    )
    expect(code).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/m)
  })

  describe('with the real `prisma migrate deploy` on a fresh database', () => {
    let fresh: string
    let name: string
    let admin: pg.Client
    let client: pg.Client

    beforeAll(async () => {
      const target = new URL(url)
      target.pathname = `${target.pathname}_c1_fresh`
      fresh = target.toString()
      name = decodeURIComponent(target.pathname.slice(1))
      const adminUrl = new URL(url)
      adminUrl.pathname = '/postgres'
      admin = new pg.Client({ connectionString: adminUrl.toString() })
      await admin.connect()
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      await admin.query(`CREATE DATABASE "${name}"`)
      expect((await deploy(fresh)).code).toBe(0)
      client = new pg.Client({ connectionString: fresh })
      await client.connect()
    })

    afterAll(async () => {
      await client?.end()
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      await admin.end()
    })

    async function freshSeasons(): Promise<Row[]> {
      const rows = await client.query<{ code: string; starts_on: string; ends_on: string }>(
        `SELECT "code", to_char("starts_on", 'YYYY-MM-DD') AS "starts_on", to_char("ends_on", 'YYYY-MM-DD') AS "ends_on"
         FROM "ranked_seasons" ORDER BY "starts_on"`,
      )
      return rows.rows.map((row) => [row.code, row.starts_on, row.ends_on])
    }

    it('migrated from scratch, it ends with C1 on 1/12–15/12 and the other seasons as they were', async () => {
      expect(await freshSeasons()).toEqual([B4A, B4B, NEW])
    })

    it('review of #176: its connection holds the ranks’ lock while its UPDATE waits for a held C1 row', async () => {
      // As before this migration: C1 with the old dates, and the migration pending.
      await client.query(`DELETE FROM "_prisma_migrations" WHERE "migration_name" = $1`, [MIGRATION_NAME])
      await client.query(
        `UPDATE "ranked_seasons" SET "starts_on" = DATE '2026-11-30', "ends_on" = DATE '2026-12-14' WHERE "code" = 'C1'`,
      )
      // Another session holds the C1 row (a season edit of the app in flight).
      const holder = new pg.Client({ connectionString: fresh })
      await holder.connect()
      try {
        await holder.query('BEGIN')
        await holder.query(`SELECT 1 FROM "ranked_seasons" WHERE "code" = 'C1' FOR UPDATE`)
        const holderPid = (await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid
        const running = deploy(fresh)
        // The migration's connection: the one waiting for a lock in this database.
        let waiter: number | null = null
        for (let tries = 0; tries < 300 && waiter === null; tries++) {
          const rows = await admin.query<{ pid: number }>(
            `SELECT DISTINCT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
             WHERE NOT l.granted AND a.datname = $1 AND l.pid <> $2`,
            [name, holderPid],
          )
          waiter = rows.rows[0]?.pid ?? null
          if (waiter === null) await new Promise((resolve) => setTimeout(resolve, 100))
        }
        expect(waiter).not.toBeNull()
        // It holds the ranks' advisory lock (a bigint key: classid 0, objid the key, objsubid 1) while it waits.
        const advisory = await admin.query(
          `SELECT 1 FROM pg_locks
           WHERE pid = $1 AND locktype = 'advisory' AND classid = 0 AND objid = $2 AND objsubid = 1 AND granted`,
          [waiter, ADVISORY_LOCKS.rankNote],
        )
        expect(advisory.rowCount).toBe(1)
        expect(await freshSeasons()).toEqual([B4A, B4B, OLD])
        await holder.query('COMMIT')
        const result = await running
        expect(result.code, result.output).toBe(0)
        expect(await freshSeasons()).toEqual([B4A, B4B, NEW])
      } finally {
        await holder.end()
      }
    })

    it('review of #176: a failure inside the block rolls C1 back and Prisma records the real error', async () => {
      // A scratch copy of the migrations, with this one failing right after its UPDATE.
      const root = mkdtempSync(join(tmpdir(), 'tcg-rankedc1-fail-'))
      try {
        cpSync(join(API_ROOT, 'prisma'), join(root, 'prisma'), { recursive: true })
        const failing = SQL.replace(/(\n\s*\);\n)(END\n\$\$;)/, '$1  PERFORM 1/0;\n$2')
        expect(failing).not.toBe(SQL)
        writeFileSync(join(root, 'prisma', 'migrations', MIGRATION_NAME, 'migration.sql'), failing)
        writeFileSync(
          join(root, 'prisma.config.mjs'),
          "export default { schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' }, datasource: { url: process.env.DATABASE_URL } }\n",
        )
        await client.query(`DELETE FROM "_prisma_migrations" WHERE "migration_name" = $1`, [MIGRATION_NAME])
        await client.query(
          `UPDATE "ranked_seasons" SET "starts_on" = DATE '2026-11-30', "ends_on" = DATE '2026-12-14' WHERE "code" = 'C1'`,
        )
        const result = await deploy(fresh, root)
        expect(result.code).not.toBe(0)
        expect(result.output).toContain('division by zero')
        expect(result.output).not.toContain('current transaction is aborted')
        // The UPDATE ran before the failure and rolled back with it.
        expect(await freshSeasons()).toEqual([B4A, B4B, OLD])
        const row = await client.query<{ finished_at: Date | null; logs: string | null }>(
          `SELECT "finished_at", "logs" FROM "_prisma_migrations" WHERE "migration_name" = $1`,
          [MIGRATION_NAME],
        )
        expect(row.rows).toHaveLength(1)
        expect(row.rows[0]?.finished_at).toBeNull()
        expect(row.rows[0]?.logs).toContain('division by zero')
        // With the failed row out of the way (what `migrate resolve --rolled-back` allows), the real one applies.
        await client.query(`DELETE FROM "_prisma_migrations" WHERE "migration_name" = $1`, [MIGRATION_NAME])
        expect((await deploy(fresh)).code).toBe(0)
        expect(await freshSeasons()).toEqual([B4A, B4B, NEW])
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })
  })

  it('moves C1 when it still has the old dates; a second run changes nothing', async () => {
    await reset([B4A, B4B, OLD])
    const before = await test.prisma.rankedSeason.findUniqueOrThrow({ where: { code: 'C1' } })
    await migrate()
    expect(await seasons()).toEqual([B4A, B4B, NEW])
    const after = await test.prisma.rankedSeason.findUniqueOrThrow({ where: { code: 'C1' } })
    expect(after.name).toBe('Temporada C1')
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime())
    await migrate()
    expect(await seasons()).toEqual([B4A, B4B, NEW])
  })

  it('leaves alone a C1 the owner corrected, and creates none when there is no C1', async () => {
    const edited: Row = ['C1', '2026-11-29', '2026-12-14']
    await reset([B4A, B4B, edited])
    await migrate()
    expect(await seasons()).toEqual([B4A, B4B, edited])
    const onlyStart: Row = ['C1', '2026-11-30', '2026-12-13']
    await reset([onlyStart])
    await migrate()
    expect(await seasons()).toEqual([onlyStart])
    await reset([B4A, B4B])
    await migrate()
    expect(await seasons()).toEqual([B4A, B4B])
  })

  it('never makes an overlap: a season the owner added on 15/12 keeps C1 where it was', async () => {
    const next: Row = ['C2', '2026-12-15', '2026-12-29']
    await reset([B4A, B4B, OLD, next])
    await migrate()
    expect(await seasons()).toEqual([B4A, B4B, OLD, next])
  })

  it('a competitive match or a rank note on a day that changes season (30/11, 15/12 in Buenos Aires) keeps it', async () => {
    // 30/11 at 21:00 in Buenos Aires: it would leave C1.
    await reset([B4A, B4B, OLD])
    await match('2026-12-01T00:00:00Z')
    await migrate()
    expect(await seasons()).toEqual([B4A, B4B, OLD])
    // 15/12 at 10:00 in Buenos Aires: it would join C1.
    await reset([B4A, B4B, OLD])
    await match('2026-12-15T13:00:00Z')
    await migrate()
    expect(await seasons()).toEqual([B4A, B4B, OLD])
    // A rank noted a millisecond before a match at 00:00 of 15/12 belongs to 15/12.
    await reset([B4A, B4B, OLD])
    await test.prisma.rankChange.create({ data: { at: new Date('2026-12-15T02:59:59.999Z'), rank: 'ultra-1' } })
    await migrate()
    expect(await seasons()).toEqual([B4A, B4B, OLD])
    // A casual match those days, or a competitive one on days that do not change (1/12 to 14/12), moves it.
    await reset([B4A, B4B, OLD])
    await match('2026-12-01T00:00:00Z', 'casual')
    await match('2026-12-01T03:00:00Z')
    await match('2026-12-15T02:59:59Z')
    await test.prisma.rankChange.create({ data: { at: new Date('2026-12-15T02:59:59.998Z'), rank: 'ultra-1' } })
    await migrate()
    expect(await seasons()).toEqual([B4A, B4B, NEW])
  })

  it('waits for the ranks’ lock: a season edit in flight finishes first', async () => {
    await reset([B4A, B4B, OLD])
    const holder = new pg.Client({ connectionString: url })
    await holder.connect()
    try {
      await holder.query('BEGIN')
      await holder.query(`SELECT pg_advisory_xact_lock(${ADVISORY_LOCKS.rankNote})`)
      let done = false
      const running = migrate().then(() => {
        done = true
      })
      await new Promise((resolve) => setTimeout(resolve, 750))
      expect(done).toBe(false)
      expect(await seasons()).toEqual([B4A, B4B, OLD])
      await holder.query('COMMIT')
      await running
      expect(await seasons()).toEqual([B4A, B4B, NEW])
    } finally {
      await holder.end()
    }
  })

  it('review of #176: a backup whose C1 still has the old dates says so in the restore dry-run', async () => {
    const notice = (notices: string[]) => notices.filter((text) => text.includes('temporada C1 del 30/11 al 14/12'))
    const dryRun = async () => {
      const exported = await test.http().get('/api/backup/export').set('Cookie', cookie).responseType('blob')
      expect(exported.status).toBe(200)
      const document = JSON.parse(gunzipSync(exported.body as Buffer).toString('utf8')) as Record<string, unknown>
      const response = await test
        .http()
        .post('/api/backup/import?mode=dry-run')
        .set('Cookie', cookie)
        .attach('file', gzipSync(Buffer.from(JSON.stringify(document))), 'backup.json.gz')
      expect(response.status).toBe(200)
      return response.body.diff.notices as string[]
    }
    await reset([B4A, B4B, OLD])
    expect(notice(await dryRun())).toEqual([
      'El backup trae la temporada C1 del 30/11 al 14/12, las fechas de antes de la noticia oficial: después de restaurar, corregila en Ranked (va del 1/12 al 15/12).',
    ])
    await reset([B4A, B4B, NEW])
    expect(notice(await dryRun())).toEqual([])
  })
})
