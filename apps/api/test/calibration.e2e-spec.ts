import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { WorkerQueueService } from '../src/simulation/worker-queue.service.js'
import { type FetchLike, LimitlessTransport } from '../src/tournaments/limitless.client.js'
import { TournamentSyncService } from '../src/tournaments/tournament-sync.service.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/**
 * Calibration against tournaments (R-012): the meta bank of PMPT #45 (served with its pairings by a fake Limitless
 * from docs/fase0/limitless/) played against itself by a fake worker, and the report next to the matchups.
 */
const LIMITLESS = join(REPO_ROOT, 'docs/fase0/limitless')
const BIG = '6a95b87b629039f77d8a6954'
const read = (file: string): unknown => JSON.parse(readFileSync(join(LIMITLESS, file), 'utf8'))
type Structured = Record<string, unknown>

describe('calibration (e2e)', () => {
  let test: TestApp
  let cookie: string
  let workerToken: string

  beforeAll(async () => {
    test = await createTestApp()
    test.app.get(WorkerQueueService).longPollMs = 50
    await seedOwner(test.app, { totp: false })
    cookie = await login(test, { secret: null })
    const summary = await test.app
      .get(CatalogSyncService)
      .sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    expect(summary.status).toBe('applied')
    workerToken = (await post('/api/tokens').send({ name: 'pc', kind: 'worker', scopes: ['worker:claim'] })).body.token
    const listing = [...(read('t1.json') as { id: string }[]), ...(read('t2.json') as { id: string }[])].filter(
      (tournament) => tournament.id === BIG,
    )
    const fake: FetchLike = async (url) => {
      const path = url.replace(test.env.limitlessBaseUrl, '')
      const json = (status: number, body: unknown) => ({ status, headers: { get: () => null }, json: async () => body })
      if (/^\/tournaments\?/.test(path)) return json(200, /page=1$/.test(path) ? listing : [])
      if (path === `/tournaments/${BIG}/details`) return json(200, read('big_details.json'))
      if (path === `/tournaments/${BIG}/standings`) return json(200, read('big_standings.json'))
      if (path === `/tournaments/${BIG}/pairings`) return json(200, read('big_pairings.json'))
      return json(404, { message: 'unknown path' })
    }
    test.app.get(LimitlessTransport).fetch = fake
    await test.app.get(TournamentSyncService).run({ now: new Date('2026-10-07T00:00:00Z') })
  }, 120_000)

  afterAll(async () => {
    await test.close()
  })

  function get(path: string) {
    return test.http().get(path).set('Cookie', cookie)
  }
  function post(path: string) {
    return test.http().post(path).set('Cookie', cookie)
  }
  function bearer(method: 'post' | 'put', path: string) {
    return test.http()[method](path).set('Authorization', `Bearer ${workerToken}`)
  }
  const hello = { workerId: 'worker-cal-01', name: 'pc', cliVersion: '0.2.1', cores: 8, version: '0.2.6' }

  it('queues the bank against itself with the chosen bot and reports it next to the tournament matchups', async () => {
    expect((await post('/api/calibration').send({ bot: 'h' })).status).toBe(400)
    const started = await post('/api/calibration').send({ bot: 'e2', gamesPerPair: 10, size: 5 })
    expect(started.status).toBe(201)
    expect(started.body).toMatchObject({ kind: 'matrix', players: ['e2', 'e2'], replaySample: 0 })
    expect(started.body.label).toMatch(/^Calibración · expectiminimax, profundidad 2 · /)
    // 5 lists against each other: 10 pairings, one chunk each.
    expect(started.body.progress).toMatchObject({ totalGames: 100, chunks: { total: 10 } })
    const id = started.body.id as number

    // While nothing is played, the report waits for every pairing.
    const waiting = (await get(`/api/calibration/${id}`)).body
    expect(waiting).toMatchObject({ pending: 10, report: { rows: [], compared: 0 } })
    expect(waiting.job).toMatchObject({ id, status: 'queued', bot: 'e2', lists: 5 })

    // A fake worker: deck A wins 7 of 10 in every pairing.
    for (;;) {
      const chunk = (await bearer('post', '/api/worker/claim').send({ ...hello, engineRev: test.env.engineRev })).body
        .chunk as Structured | null
      if (!chunk) break
      const sent = await bearer('put', `/api/worker/chunks/${chunk.chunkId}/result`).send({
        workerId: hello.workerId,
        engineRev: test.env.engineRev,
        winsA: 7,
        winsB: 3,
        ties: 0,
        games: 10,
        durationMs: 100,
      })
      expect(sent.body).toEqual({ accepted: true })
    }

    const view = (await get(`/api/calibration/${id}`)).body as {
      job: Structured
      pending: number
      tournaments: { matches: number; tournamentsWithPairings: number }
      report: {
        rows: {
          simulated: { value: number; games: number }
          tournament: { games: number } | null
          inside: boolean | null
        }[]
        compared: number
        inside: number
        archetypes: { id: string; simulated: number | null }[]
        minTournamentGames: number
      }
    }
    expect(view.job).toMatchObject({ status: 'done', era: expect.any(String) })
    expect(view.pending).toBe(0)
    expect(view.report.rows).toHaveLength(10)
    expect(view.report.rows.every((row) => row.simulated.value === 70 && row.simulated.games === 10)).toBe(true)
    expect(view.tournaments.tournamentsWithPairings).toBe(1)
    expect(view.tournaments.matches).toBeGreaterThan(0)
    // The top archetypes of PMPT #45 met each other there: some pairings have tournament games.
    expect(view.report.rows.some((row) => row.tournament !== null)).toBe(true)
    const judged = view.report.rows.filter((row) => row.inside !== null)
    expect(view.report.compared).toBe(judged.length)
    expect(view.report.inside).toBe(judged.filter((row) => row.inside).length)
    expect(view.report.archetypes).toHaveLength(5)

    const list = (await get('/api/calibration')).body as { id: number; summary: Structured | null }[]
    expect(list.map((item) => item.id)).toEqual([id])
    expect(list[0]?.summary).toMatchObject({ compared: view.report.compared, inside: view.report.inside })
    expect((await get('/api/calibration/999999')).status).toBe(404)
  })
})
