import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
const MIGRATION = join(API_ROOT, 'prisma', 'migrations', '20261103120000_ranked_season_c1_dates', 'migration.sql')
const SQL = readFileSync(MIGRATION, 'utf8')

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

  beforeAll(async () => {
    test = await createTestApp()
    url = test.env.databaseUrl
    await seedOwner(test.app, { totp: false })
    const cookie = await login(test, { secret: null })
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

  /** The migration's script as Prisma runs it: one simple query, so one implicit transaction. */
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

  it('takes the lock the app takes for every season edit (ADVISORY_LOCKS.rankNote)', () => {
    const keys = [...SQL.matchAll(/pg_advisory_xact_lock\((\d+)\)/g)].map((found) => Number(found[1]))
    expect(keys).toEqual([ADVISORY_LOCKS.rankNote])
  })

  it('a fresh database migrated from scratch ends with C1 on 1/12–15/12, and the other seasons as they were', async () => {
    const fresh = new URL(url)
    fresh.pathname = `${fresh.pathname}_c1_fresh`
    const name = decodeURIComponent(fresh.pathname.slice(1))
    const admin = new URL(url)
    admin.pathname = '/postgres'
    const adminClient = new pg.Client({ connectionString: admin.toString() })
    await adminClient.connect()
    try {
      await adminClient.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      await adminClient.query(`CREATE DATABASE "${name}"`)
      execFileSync(
        process.execPath,
        [join(API_ROOT, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'],
        {
          cwd: API_ROOT,
          env: { ...process.env, DATABASE_URL: fresh.toString() },
          stdio: 'ignore',
        },
      )
      const client = new pg.Client({ connectionString: fresh.toString() })
      await client.connect()
      try {
        const rows = await client.query<{ code: string; starts_on: string; ends_on: string }>(
          `SELECT "code", to_char("starts_on", 'YYYY-MM-DD') AS "starts_on", to_char("ends_on", 'YYYY-MM-DD') AS "ends_on"
           FROM "ranked_seasons" ORDER BY "starts_on"`,
        )
        expect(rows.rows.map((row) => [row.code, row.starts_on, row.ends_on])).toEqual([B4A, B4B, NEW])
      } finally {
        await client.end()
      }
    } finally {
      await adminClient.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      await adminClient.end()
    }
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
})
