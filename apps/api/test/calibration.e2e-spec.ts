import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { matchupPerGame } from '@tcg/domain'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { WorkerQueueService } from '../src/simulation/worker-queue.service.js'
import { type FetchLike, LimitlessTransport } from '../src/tournaments/limitless.client.js'
import { TournamentSyncService } from '../src/tournaments/tournament-sync.service.js'
import { TournamentsService } from '../src/tournaments/tournaments.service.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/**
 * Calibration against tournaments (R-012): the meta bank of PMPT #45 (served with its pairings by a fake Limitless
 * from docs/fase0/limitless/) played against itself by a fake worker, and the report next to the matchups. The
 * tournament is served four times under other ids, so that pairings reach the 20 tournament games the summary needs.
 */
const LIMITLESS = join(REPO_ROOT, 'docs/fase0/limitless')
const BIG = '6a95b87b629039f77d8a6954'
const COPIES = [BIG, '6a95b87b629039f77d8a6955', '6a95b87b629039f77d8a6956', '6a95b87b629039f77d8a6957']
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
    const big = [...(read('t1.json') as { id: string }[]), ...(read('t2.json') as { id: string }[])].find(
      (tournament) => tournament.id === BIG,
    )
    const listing = COPIES.map((id) => ({ ...big, id }))
    const fake: FetchLike = async (url) => {
      const path = url.replace(test.env.limitlessBaseUrl, '')
      const json = (status: number, body: unknown) => ({ status, headers: { get: () => null }, json: async () => body })
      if (/^\/tournaments\?/.test(path)) return json(200, /page=1$/.test(path) ? listing : [])
      const [, id, part] = /^\/tournaments\/([^/]+)\/(details|standings|pairings)$/.exec(path) ?? []
      if (id && COPIES.includes(id)) return json(200, read(`big_${part}.json`))
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
    expect(waiting).toMatchObject({ pending: 10, failed: 0, report: { rows: [], compared: 0 } })
    expect(waiting.job).toMatchObject({ id, status: 'queued', bot: 'e2', lists: 5 })

    // A fake worker with a different result in each pairing (deck A wins idx + 1 of 10); the last one fails 3 times.
    const job = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })
    const calibration = (job.params as { calibration: { bank: { listKey: string; archetypeId: string }[] } })
      .calibration
    const snapshots = await test.prisma.deckSnapshot.findMany({
      where: { id: { in: (job.params as { sideA: number[] }).sideA } },
    })
    const archetypeOf = (snapshotId: number | null) =>
      calibration.bank.find((entry) => entry.listKey === snapshots.find((s) => s.id === snapshotId)?.sourceId)
        ?.archetypeId
    const played = new Map<string, number>()
    for (;;) {
      const chunk = (await bearer('post', '/api/worker/claim').send({ ...hello, engineRev: test.env.engineRev })).body
        .chunk as Structured | null
      if (!chunk) break
      const row = await test.prisma.simulationChunk.findUniqueOrThrow({ where: { id: Number(chunk.chunkId) } })
      if (row.idx === 9) {
        await bearer('put', `/api/worker/chunks/${chunk.chunkId}/failure`).send({
          workerId: hello.workerId,
          error: 'Unsupported Trainer Card',
        })
        continue
      }
      const wins = row.idx + 1
      played.set(`${archetypeOf(row.snapshotAId)}|${archetypeOf(row.snapshotBId)}`, wins)
      const sent = await bearer('put', `/api/worker/chunks/${chunk.chunkId}/result`).send({
        workerId: hello.workerId,
        engineRev: test.env.engineRev,
        winsA: wins,
        winsB: 10 - wins,
        ties: 0,
        games: 10,
        durationMs: 100,
      })
      expect(sent.body).toEqual({ accepted: true })
    }

    const view = (await get(`/api/calibration/${id}`)).body as {
      job: Structured
      pending: number
      failed: number
      tournaments: { era: string; matches: number; tournamentsWithPairings: number }
      report: {
        rows: {
          a: string
          b: string
          simulated: { value: number; games: number }
          tournament: { value: number; games: number } | null
          compatible: boolean | null
        }[]
        compared: number
        compatible: number
        archetypes: { id: string; simulated: unknown; tournament: unknown; rivals: number }[]
        minTournamentGames: number
      }
    }
    // A failed pairing ends the job «failed», and the report still says what it has.
    expect(view.job).toMatchObject({ status: 'failed', era: expect.any(String) })
    expect(view).toMatchObject({ pending: 0, failed: 1 })
    expect(view.report.rows).toHaveLength(9)
    // Each row is A's side, simulated and in tournaments: the same direction as the chunk and as matchupPerGame(a, b).
    const tournaments = test.app.get(TournamentsService)
    const { dataset } = await tournaments.scopedDataset({ era: view.tournaments.era, format: 'STANDARD' })
    const matchups = await tournaments.matchupsOf(dataset)
    for (const row of view.report.rows) {
      expect(row.simulated.value).toBeCloseTo(((played.get(`${row.a}|${row.b}`) as number) / 10) * 100, 10)
      const expected = matchupPerGame(matchups, row.a, row.b)
      if (expected === null) expect(row.tournament).toBeNull()
      else expect(row.tournament?.value).toBeCloseTo((expected.wins / (expected.wins + expected.losses)) * 100, 10)
    }
    expect(view.tournaments.tournamentsWithPairings).toBe(COPIES.length)
    // Four times the tournament: some pairings reach 20 games and are judged; the rest are shown, not summarized.
    const compared = view.report.rows.filter((row) => row.compatible !== null)
    expect(compared.length).toBeGreaterThan(0)
    expect(compared.length).toBeLessThan(view.report.rows.length)
    expect(view.report.compared).toBe(compared.length)
    for (const row of compared) expect(row.tournament?.games).toBeGreaterThanOrEqual(view.report.minTournamentGames)
    // Each archetype's two means: over the same rivals (its compared pairings) on both sides, weighted by each
    // rival list's part of the meta.
    const weights = new Map(
      (job.params as { calibration: { bank: { archetypeId: string; weight: number }[] } }).calibration.bank.map(
        (entry) => [entry.archetypeId, entry.weight],
      ),
    )
    expect(view.report.archetypes).toHaveLength(5)
    for (const archetype of view.report.archetypes) {
      const own = compared.filter((row) => row.a === archetype.id || row.b === archetype.id)
      expect(archetype.rivals).toBe(own.length)
      if (own.length === 0) {
        expect(archetype).toMatchObject({ simulated: null, tournament: null })
        continue
      }
      const mean = (pick: 'simulated' | 'tournament') => {
        const terms = own.map((row) => {
          const value = row[pick]?.value as number
          const mine = row.a === archetype.id
          return { value: mine ? value : 100 - value, weight: weights.get(mine ? row.b : row.a) as number }
        })
        const total = terms.reduce((sum, term) => sum + term.weight, 0)
        return terms.reduce((sum, term) => sum + term.value * term.weight, 0) / total
      }
      expect((archetype.simulated as { value: number }).value).toBeCloseTo(mean('simulated'), 8)
      expect((archetype.tournament as { value: number }).value).toBeCloseTo(mean('tournament'), 8)
    }

    const list = (await get('/api/calibration')).body as { id: number; failed: number; summary: Structured | null }[]
    expect(list.map((item) => item.id)).toEqual([id])
    expect(list[0]).toMatchObject({ failed: 1 })
    expect(list[0]?.summary).toMatchObject({ compared: view.report.compared, compatible: view.report.compatible })
    expect((await get('/api/calibration/999999')).status).toBe(404)

    // An alias set after the bank was kept: the report reads the archetypes as they are now. Merging the first list's
    // archetype into the second's makes their pairing a mirror (not compared), and the rest still find their matchups.
    const [first, second] = calibration.bank
    expect(
      (
        await test.http().put(`/api/tournaments/archetypes/${first?.archetypeId}/alias`).set('Cookie', cookie).send({
          canonicalId: second?.archetypeId,
        })
      ).status,
    ).toBe(200)
    const merged = (await get(`/api/calibration/${id}`)).body as typeof view & { mirrors: number }
    expect(merged.mirrors).toBe(played.has(`${first?.archetypeId}|${second?.archetypeId}`) ? 1 : 0)
    // The two lists of the merged archetype are one point: tournaments have one matchup for both.
    const canon = (archetypeId: string) =>
      archetypeId === first?.archetypeId ? (second?.archetypeId as string) : archetypeId
    const rateOf = (x: string, y: string) => {
      const direct = played.get(`${x}|${y}`)
      if (direct !== undefined) return direct / 10
      const reverse = played.get(`${y}|${x}`)
      return reverse === undefined ? undefined : 1 - reverse / 10
    }
    const bankIds = calibration.bank.map((entry) => entry.archetypeId)
    const canonical = [...new Set(bankIds.map(canon))]
    let complete = 0
    for (let i = 0; i < canonical.length; i++) {
      for (let j = i + 1; j < canonical.length; j++) {
        const lists = (u: string) => bankIds.filter((archetypeId) => canon(archetypeId) === u)
        const all = lists(canonical[i] as string).flatMap((x) => lists(canonical[j] as string).map((y) => rateOf(x, y)))
        if (all.every((rate) => rate !== undefined)) complete++
      }
    }
    expect(merged.report.rows).toHaveLength(complete)
    expect(merged.report.archetypes).toHaveLength(canonical.length)
    expect(merged.report.archetypes.some((row) => row.id === first?.archetypeId)).toBe(false)
    const after = await tournaments.matchupsOf(
      (await tournaments.scopedDataset({ era: view.tournaments.era, format: 'STANDARD' })).dataset,
    )
    const firstWeight = weights.get(first?.archetypeId as string) as number
    const secondWeight = weights.get(second?.archetypeId as string) as number
    let mixed = 0
    for (const row of merged.report.rows) {
      const expected = matchupPerGame(after, row.a, row.b)
      if (expected === null) expect(row.tournament).toBeNull()
      else expect(row.tournament?.value).toBeCloseTo((expected.wins / (expected.wins + expected.losses)) * 100, 10)
      // A row with the merged archetype: the rate of its two lists, each by its part of the archetype.
      const side = row.a === second?.archetypeId ? row.b : row.b === second?.archetypeId ? row.a : null
      if (side === null) continue
      const mixture =
        ((rateOf(first?.archetypeId as string, side) as number) * firstWeight +
          (rateOf(second?.archetypeId as string, side) as number) * secondWeight) /
        (firstWeight + secondWeight)
      expect(row.simulated.value).toBeCloseTo((row.a === second?.archetypeId ? mixture : 1 - mixture) * 100, 8)
      mixed++
    }
    expect(mixed).toBeGreaterThan(0)
    // The list's summary is made again with the new aliases.
    const relisted = (await get('/api/calibration')).body as { summary: Structured | null }[]
    expect(relisted[0]?.summary).toMatchObject({ compared: merged.report.compared })
    await test.http().put(`/api/tournaments/archetypes/${first?.archetypeId}/alias`).set('Cookie', cookie).send({
      canonicalId: null,
    })
  })

  it('a pairing split in chunks counts once all of them are played; a cancelled one is not «pending»', async () => {
    // 3 lists: 3 pairings of 1.500 games, each in two chunks (1.000 + 500).
    const started = await post('/api/calibration').send({ bot: 'e2', gamesPerPair: 1500, size: 3 })
    expect(started.body.progress).toMatchObject({ chunks: { total: 6 } })
    const id = started.body.id as number
    const chunk = (await bearer('post', '/api/worker/claim').send({ ...hello, engineRev: test.env.engineRev })).body
      .chunk as Structured
    expect(chunk).toMatchObject({ jobId: id, games: 1000 })
    await bearer('put', `/api/worker/chunks/${chunk.chunkId}/result`).send({
      workerId: hello.workerId,
      engineRev: test.env.engineRev,
      winsA: 600,
      winsB: 400,
      ties: 0,
      games: 1000,
      durationMs: 100,
    })
    // Half a pairing is not a result: the report waits for it.
    const half = (await get(`/api/calibration/${id}`)).body
    expect(half).toMatchObject({ pending: 3, cancelled: 0, report: { rows: [] } })
    expect((await post(`/api/simulations/${id}/cancel`)).body.status).toBe('cancelled')
    const cancelled = (await get(`/api/calibration/${id}`)).body
    expect(cancelled).toMatchObject({ pending: 0, failed: 0, cancelled: 3, report: { rows: [] } })
    const list = (await get('/api/calibration')).body as { id: number; cancelled: number; summary: Structured | null }[]
    expect(list.find((item) => item.id === id)).toMatchObject({ cancelled: 3, summary: { compared: 0 } })
  })
})
