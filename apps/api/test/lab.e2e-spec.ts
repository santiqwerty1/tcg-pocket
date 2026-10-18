import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import {
  bonferroniZ,
  engineEdition,
  eraRange,
  metaScore,
  poolForZone,
  type SelectableEnergy,
  scoreDifference,
  usableWith,
} from '@tcg/domain'
import { CatalogService } from '../src/catalog/catalog.service.js'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { LabService } from '../src/lab/lab.service.js'
import { EngineStatusService } from '../src/simulation/snapshots.service.js'
import { WorkerQueueService } from '../src/simulation/worker-queue.service.js'
import { type FetchLike, LimitlessTransport } from '../src/tournaments/limitless.client.js'
import { TournamentSyncService } from '../src/tournaments/tournament-sync.service.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/**
 * Laboratorio de mazos (T-008): the meta bank of PMPT #45 (393 lists, served by a fake Limitless from
 * docs/fase0/limitless/), a test against it and a whole automatic search played by a fake worker (no engine).
 */
const LIMITLESS = join(REPO_ROOT, 'docs/fase0/limitless')
const CSV_PATH = join(REPO_ROOT, 'docs/context/tcgcollectiontracterexport-2026-10-06.csv')
const DECKS_PATH = join(REPO_ROOT, 'docs/context/mazos_40_listas.md')
const BIG = '6a95b87b629039f77d8a6954'

const read = (file: string): unknown => JSON.parse(readFileSync(join(LIMITLESS, file), 'utf8'))

type Structured = Record<string, unknown>

interface Score {
  value: number
  ci95: [number, number]
  games: number
  rivals: number
}

describe('laboratorio (e2e)', () => {
  let test: TestApp
  let cookie: string
  let workerToken: string
  let deckIds: string[]
  let mcpUrl: URL
  let mcpToken: string
  const clients: Client[] = []

  beforeAll(async () => {
    test = await createTestApp()
    test.app.get(WorkerQueueService).longPollMs = 50
    await seedOwner(test.app, { totp: false })
    cookie = await login(test, { secret: null })
    const summary = await test.app
      .get(CatalogSyncService)
      .sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    expect(summary.status).toBe('applied')
    const preview = await post('/api/collection/imports').attach('file', readFileSync(CSV_PATH), 'export.csv')
    expect((await post(`/api/collection/imports/${preview.body.id}/apply`)).status).toBe(200)
    const drafts = (await post('/api/decks/import').send({ text: readFileSync(DECKS_PATH, 'utf8') })).body.drafts as {
      title: string
      draft: { energies: string[]; cards: unknown[] }
    }[]
    const decks = drafts.map((d) => ({
      name: d.title,
      energies: d.draft.energies.length > 0 ? d.draft.energies : ['psychic'],
      cards: d.draft.cards,
    }))
    expect((await post('/api/decks/import/commit').send({ decks })).status).toBe(201)
    deckIds = ((await get('/api/decks')).body.items as { id: string }[])
      .map((deck) => deck.id)
      .sort((a, b) => Number(a) - Number(b))
    workerToken = (await post('/api/tokens').send({ name: 'pc', kind: 'worker', scopes: ['worker:claim'] })).body.token

    // Fake Limitless with a single tournament: PMPT #45.
    const listing = [...(read('t1.json') as { id: string }[]), ...(read('t2.json') as { id: string }[])].filter(
      (tournament) => tournament.id === BIG,
    )
    const fake: FetchLike = async (url) => {
      const path = url.replace(test.env.limitlessBaseUrl, '')
      const json = (status: number, body: unknown) => ({
        status,
        headers: { get: () => null },
        json: async () => body,
      })
      if (/^\/tournaments\?/.test(path)) return json(200, /page=1$/.test(path) ? listing : [])
      if (path === `/tournaments/${BIG}/details`) return json(200, read('big_details.json'))
      if (path === `/tournaments/${BIG}/standings`) return json(200, read('big_standings.json'))
      // H-055: its rounds too, so the archetypes have matchups and an expected rate against the meta.
      if (path === `/tournaments/${BIG}/pairings`) return json(200, read('big_pairings.json'))
      return json(404, { message: 'unknown path' })
    }
    test.app.get(LimitlessTransport).fetch = fake
    await test.app.get(TournamentSyncService).run({ now: new Date('2026-10-07T00:00:00Z') })
    mcpToken = (await post('/api/tokens').send({ name: 'claude', kind: 'mcp', scopes: ['mcp:read', 'mcp:write'] })).body
      .token
    await test.app.listen(0, '127.0.0.1')
    const { port } = test.app.getHttpServer().address() as AddressInfo
    mcpUrl = new URL(`http://127.0.0.1:${port}/api/mcp`)
  }, 120_000)

  afterAll(async () => {
    for (const client of clients) await client.close().catch(() => undefined)
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
  const hello = { workerId: 'worker-lab-01', name: 'pc-de-prueba', cliVersion: '0.1.0', cores: 8, version: '0.1.0' }

  /**
   * Plays every chunk handed out until the queue is empty (or `limit` chunks); `wins` decides the result from the
   * snapshots.
   */
  async function playAll(
    wins: (a: number, b: number, games: number, chunkId: number) => number,
    limit = Number.POSITIVE_INFINITY,
  ): Promise<number> {
    let played = 0
    while (played < limit) {
      const claim = await bearer('post', '/api/worker/claim').send({ ...hello, engineRev: test.env.engineRev })
      const chunk = claim.body.chunk as Structured | null
      if (!chunk) return played
      await report(chunk.chunkId as number, wins)
      played += 1
    }
    return played
  }

  /** The result of a chunk already claimed. */
  async function report(chunkId: number, wins: (a: number, b: number, games: number, chunkId: number) => number) {
    const row = await test.prisma.simulationChunk.findUniqueOrThrow({ where: { id: chunkId } })
    const winsA = wins(row.snapshotAId as number, row.snapshotBId as number, row.games, row.id)
    const result = await bearer('put', `/api/worker/chunks/${row.id}/result`).send({
      workerId: hello.workerId,
      engineRev: test.env.engineRev,
      winsA,
      winsB: row.games - winsA,
      ties: 0,
      games: row.games,
      durationMs: 100,
    })
    expect(result.body).toEqual({ accepted: true })
  }

  it('meta bank: the most played archetypes of the era with their list, weights adding up to 1', async () => {
    const bank = await get('/api/lab/bank?size=5')
    expect(bank.status).toBe(200)
    expect(bank.body).toMatchObject({ era: 'B4a', format: 'STANDARD', size: 5, lists: 393 })
    const rivals = bank.body.rivals as { share: number; weight: number; listKey: string; cards: unknown[] }[]
    expect(rivals).toHaveLength(5)
    expect(rivals.reduce((sum, rival) => sum + rival.weight, 0)).toBeCloseTo(1, 10)
    for (let i = 1; i < rivals.length; i++) {
      expect(rivals[i - 1]?.share).toBeGreaterThanOrEqual(rivals[i]?.share ?? 0)
    }
    for (const rival of rivals) {
      expect(rival.listKey).toMatch(/^[0-9a-f]{14}$/)
      expect(rival.cards.length).toBeGreaterThan(0)
    }
    expect(bank.body.coverage).toBeCloseTo(
      rivals.reduce((sum, rival) => sum + rival.share, 0),
      10,
    )
    expect((await get('/api/lab/bank?size=99')).status).toBe(400)
    // Bots' review, item 8: with second lists (banks of 10 or more) the size still counts archetypes.
    const ten = (await get('/api/lab/bank?size=10')).body as { size: number; rivals: { archetypeId: string }[] }
    expect(ten.size).toBe(new Set(ten.rivals.map((rival) => rival.archetypeId)).size)
    expect(ten.size).toBeLessThanOrEqual(10)
    expect(ten.rivals.length).toBeGreaterThan(ten.size)
  })

  it('T-017 D3: a bank of 10 or more brings a second list for its most played archetypes', async () => {
    const bank = (await get('/api/lab/bank?size=10')).body as {
      rivals: { archetypeId: string; listKey: string; weight: number; second: boolean }[]
    }
    const seconds = bank.rivals.filter((rival) => rival.second)
    expect(seconds.length).toBeGreaterThan(0)
    expect(seconds.length).toBeLessThanOrEqual(3)
    expect(new Set(bank.rivals.map((rival) => rival.archetypeId)).size).toBe(10)
    expect(new Set(bank.rivals.map((rival) => rival.listKey)).size).toBe(bank.rivals.length)
    expect(bank.rivals.reduce((sum, rival) => sum + rival.weight, 0)).toBeCloseTo(1, 8)
    // Small banks stay one list per archetype.
    const small = (await get('/api/lab/bank?size=5')).body as { rivals: { second: boolean }[] }
    expect(small.rivals.some((rival) => rival.second)).toBe(false)
  })

  it('T-017 D4: a bank against «mi meta» or one rival; a test against them keeps it and is no score against the meta', async () => {
    const meta = (await get('/api/lab/bank?size=5')).body as {
      objective: { kind: string }
      rivals: { archetypeId: string; archetypeName: string; weight: number }[]
    }
    expect(meta.objective).toMatchObject({ kind: 'meta', labelEs: 'el meta de los torneos' })
    const [first, second] = meta.rivals
    if (!first || !second) throw new Error('empty bank')
    // No matches of mine against archetypes of the era yet: it says so.
    const none = await get('/api/lab/bank?objective=mine')
    expect(none.status).toBe(422)
    expect(none.body.error.code).toBe('empty_bank')
    // Nine matches against the first, three against the second, one against something else, on the same day.
    const sets = await test.prisma.setRelease.findMany()
    const range = eraRange(
      'B4a',
      sets.map((set) => ({
        code: set.code,
        nameEn: set.nameEn,
        releaseDate: set.releaseDate.toISOString().slice(0, 10),
        opensEra: set.opensEra,
      })),
    )
    if (!range) throw new Error('no era B4a')
    const deck = await test.prisma.deck.findUniqueOrThrow({ where: { id: Number(deckIds[0]) } })
    const playedAt = new Date(range.from.getTime() + 86_400_000)
    // Review of #47: 4 matches against archetypes (an effective n under 10) are too few for a bank.
    await test.prisma.match.createMany({
      data: [first, first, first, second].map((rival) => ({
        deckId: deck.id,
        deckRevisionId: deck.currentRevisionId as number,
        result: 'win' as const,
        mode: 'competitive' as const,
        opponentText: rival.archetypeName,
        playedAt,
      })),
    })
    const thin = await get('/api/lab/bank?objective=mine')
    expect(thin.status).toBe(422)
    expect(thin.body.error.message).toMatch(/^Todavía no alcanza/)
    await test.prisma.match.deleteMany({ where: { deckId: deck.id } })
    const opponents = [
      ...Array.from({ length: 9 }, () => first.archetypeName),
      ...Array.from({ length: 3 }, () => second.archetypeName),
      'otro mazo',
    ]
    await test.prisma.match.createMany({
      data: opponents.map((opponentText) => ({
        deckId: deck.id,
        deckRevisionId: deck.currentRevisionId as number,
        result: 'win' as const,
        mode: 'competitive' as const,
        opponentText,
        playedAt,
      })),
    })
    const mine = (await get('/api/lab/bank?objective=mine&size=5')).body
    expect(mine.objective).toMatchObject({
      kind: 'mine',
      labelEs: 'mi meta (12 partidas)',
      matched: 12,
      unmatched: 1,
      unmatchedNames: ['otro mazo'],
      halfLifeDays: 14,
      // All on the same day: an effective n of 12, under 30 (orientativo).
      effectiveMatches: 12,
      orientative: true,
    })
    expect(mine.objective.games[first.archetypeId]).toBe(9)
    // All on the same day: 9 to 3.
    expect(mine.rivals.map((rival: { archetypeId: string }) => rival.archetypeId)).toEqual([
      first.archetypeId,
      second.archetypeId,
    ])
    expect(mine.rivals[0].weight).toBeCloseTo(0.75, 10)
    // One rival: its two most representative lists, the whole weight.
    const one = (await get(`/api/lab/bank?objective=rival&archetypeId=${first.archetypeId}`)).body
    expect(one.objective).toMatchObject({
      kind: 'rival',
      archetypeId: first.archetypeId,
      labelEs: `solo ${first.archetypeName}`,
    })
    expect(new Set(one.rivals.map((rival: { archetypeId: string }) => rival.archetypeId))).toEqual(
      new Set([first.archetypeId]),
    )
    expect(one.rivals.reduce((sum: number, rival: { weight: number }) => sum + rival.weight, 0)).toBeCloseTo(1, 10)
    expect((await get('/api/lab/bank?objective=rival')).status).toBe(400)
    expect((await get('/api/lab/bank?objective=rival&archetypeId=no-existe')).status).toBe(404)

    // A test against that rival: its label and view say so, and it is not the deck's score against the meta.
    const created = await post('/api/lab/test').send({
      decks: [{ deckId: deckIds[3] }],
      objective: 'rival',
      archetypeId: first.archetypeId,
      gamesPerRival: 10,
      seed: 7100,
    })
    expect(created.status).toBe(200)
    expect(created.body.label).toBe(`Contra solo ${first.archetypeName} (B4a): ${created.body.label.split(': ')[1]}`)
    expect(await playAll((_a, _b, games) => Math.round(games * 0.6))).toBe(one.rivals.length)
    const done = (await get(`/api/lab/jobs/${created.body.id}`)).body
    expect(done).toMatchObject({
      job: { status: 'done' },
      objective: { kind: 'rival', archetypeId: first.archetypeId },
    })
    // Review of #47: its score says against what, not «contra el meta».
    expect(done.decks[0].search.text).toContain(`contra ${first.archetypeName} (n = `)
    expect(await test.app.get(LabService).deckScore(Number(deckIds[3]))).toBeNull()
    // A search against one rival keeps it too.
    const search = await post('/api/lab/explore').send({
      deck: { deckId: deckIds[3] },
      objective: 'rival',
      archetypeId: first.archetypeId,
      config: { gamesPerRival: 10, variantsPerRound: 1, maxRounds: 1, confirmGames: 0, verifyGames: 0, pool: 'all' },
      seed: 7200,
    })
    expect(search.status).toBe(200)
    expect(search.body.label).toContain(` contra solo ${first.archetypeName} (B4a)`)
    const searchJob = (await get(`/api/lab/jobs/${search.body.id}`)).body
    expect(searchJob.objective).toMatchObject({ kind: 'rival', archetypeId: first.archetypeId })
    expect(new Set(searchJob.rivals.map((rival: { archetypeId: string }) => rival.archetypeId))).toEqual(
      new Set([first.archetypeId]),
    )
    await post(`/api/simulations/${search.body.id}/cancel`)
    // Consistency takes no objective: it measures against the meta.
    const consistency = await post('/api/lab/consistency').send({
      deckId: deckIds[3],
      objective: 'rival',
      archetypeId: first.archetypeId,
    })
    expect(consistency.status).toBe(400)
    await test.prisma.match.deleteMany({ where: { deckId: deck.id } })
  })

  it('test against the meta: a «comparar» job against the bank, scored with its weights', async () => {
    const dry = await post('/api/lab/test').send({ decks: [{ deckId: deckIds[1] }], size: 5, dryRun: true })
    expect(dry.status).toBe(200)
    expect(dry.body.preview).toMatchObject({ pairings: 5, totalGames: 500 })
    const created = await post('/api/lab/test').send({
      decks: [{ deckId: deckIds[1] }],
      size: 5,
      gamesPerRival: 100,
      seed: 7000,
    })
    expect(created.status).toBe(200)
    expect(created.body).toMatchObject({ kind: 'compare', lab: 'test', progress: { totalGames: 500 } })
    expect(created.body.label).toMatch(/^Contra el meta B4a: /)
    const jobId = created.body.id as number

    // Rival snapshots by list key, to give each rival its own result.
    const lab = (await get(`/api/lab/jobs/${jobId}`)).body
    const rivals = lab.rivals as { snapshot: number; weight: number }[]
    const winsAgainst = new Map(rivals.map((rival, at) => [rival.snapshot, 20 + at * 10]))
    expect(await playAll((_a, b) => winsAgainst.get(b) ?? 0)).toBe(5)

    const done = (await get(`/api/lab/jobs/${jobId}`)).body
    expect(done).toMatchObject({ mode: 'test', era: 'B4a', size: 5, job: { status: 'done' } })
    expect(done.note).toMatch(/^Juegan bots/)
    const deck = done.decks[0] as { role: string; search: { score: Score; text: string }; perRival: unknown[] }
    const expected = rivals.reduce((sum, rival, at) => sum + rival.weight * (20 + at * 10), 0)
    expect(deck.role).toBe('deck')
    expect(deck.search.score.value).toBeCloseTo(expected, 8)
    expect(deck.search.score.games).toBe(500)
    expect(deck.search.text).toMatch(/contra el meta \(n = 500, IC\u00a0/)
    expect(deck.perRival).toHaveLength(5)
    expect(['played', 'known', 'new']).toContain((done.decks[0] as { novelty: { kind: string } }).novelty.kind)
    expect((await get('/api/lab/jobs')).body.items.map((item: { id: number }) => item.id)).toContain(jobId)
    // Fase 15: the deck's latest Laboratorio score shows up in «¿qué mazo llevo hoy?».
    expect(
      (await test.http().patch(`/api/decks/${deckIds[1]}`).set('Cookie', cookie).send({ builtInGame: true })).status,
    ).toBe(200)
    const today = (await get('/api/decks-today?sort=lab')).body as {
      items: { deck: { id: string }; lab: { value: number; jobId: number; text: string } | null }[]
    }
    const tested = today.items.find((item) => item.deck.id === deckIds[1])
    expect(tested?.lab).toMatchObject({ jobId })
    expect(tested?.lab?.value).toBeCloseTo(expected, 8)
    await test.http().patch(`/api/decks/${deckIds[1]}`).set('Cookie', cookie).send({ builtInGame: false })
    expect((await get(`/api/simulations/${jobId}`)).body.lab).toBe('test')
  })

  it('«Actualizar todos» (14/10): one test of the lists without a score of this era, once, followed on each row', async () => {
    const built = [deckIds[7], deckIds[8], deckIds[9]] as string[]
    const patch = (id: string, builtInGame: boolean) =>
      test.http().patch(`/api/decks/${id}`).set('Cookie', cookie).send({ builtInGame })
    for (const id of built) expect((await patch(id, true)).status).toBe(200)
    // A copy of the first one's list: the same list goes once.
    const source = (await get(`/api/decks/${built[0]}`)).body as {
      energies: string[]
      cards: { card: { id: string }; count: number }[]
    }
    const copy = await post('/api/decks').send({
      name: 'Copia para actualizar',
      energies: source.energies,
      cards: source.cards.map((entry) => ({ cardId: entry.card.id, count: entry.count })),
    })
    expect(copy.status).toBe(201)
    const copyId = String(copy.body.id)
    expect((await patch(copyId, true)).status).toBe(200)
    type Row = {
      deck: { id: string }
      lab: { jobId: number; era: string; bot: string; stale: boolean } | null
      labOthers: { bot: string; jobId: number }[]
      labRunning: { jobId: number; status: string; gamesDone: number; totalGames: number } | null
    }
    const rows = async () => {
      const view = (await get('/api/decks-today')).body as { items: Row[]; labDue: number }
      return { ...view, mine: view.items.filter((row) => [...built, copyId].includes(row.deck.id)) }
    }
    const before = await rows()
    expect(before.mine.every((row) => row.lab === null && row.labRunning === null)).toBe(true)
    expect(before.labDue).toBeGreaterThanOrEqual(4)

    // The plan: how many, how many games and how long; nothing is queued.
    const jobsBefore = await test.prisma.simulationJob.count()
    const plan = await post('/api/decks-today/refresh').send({ dryRun: true })
    expect(plan.status).toBe(200)
    expect(plan.body).toMatchObject({ era: 'B4a', jobs: [], sameList: 1 })
    expect(plan.body.queued).toEqual(expect.arrayContaining(built))
    expect(plan.body.queued).not.toContain(copyId)
    expect(plan.body.games).toBeGreaterThan(0)
    expect(plan.body.estimatedSeconds).toBeGreaterThan(0)
    expect(await test.prisma.simulationJob.count()).toBe(jobsBefore)

    // A double click queues once: the second one finds the lock taken («busy») or, when it comes after, the test.
    const [a, b] = await Promise.all([
      post('/api/decks-today/refresh').send({}),
      post('/api/decks-today/refresh').send({}),
    ])
    expect([a.status, b.status].sort()).toEqual(expect.arrayContaining([200]))
    for (const response of [a, b]) expect([200, 409]).toContain(response.status)
    const created = [a, b].flatMap((response) => (response.status === 200 ? (response.body.jobs as number[]) : []))
    expect(created).toHaveLength(1)
    const late = [a, b].find((response) => response.status === 409 || response.body.jobs?.length === 0)
    if (late?.status === 409) expect(late.body.error.code).toBe('busy')
    else expect(late?.body).toMatchObject({ queued: [], running: 3 })
    const [jobId] = created as [number]
    const job = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: jobId } })
    expect(job.label).toBe('Actualizar todos')
    expect((job.params as { lab: { mode: string; era: string } }).lab).toMatchObject({ mode: 'test', era: 'B4a' })
    // Santi's ask (review of #109): ahead of every job in the queue.
    const others = await test.prisma.simulationJob.aggregate({
      where: { id: { not: jobId }, status: { in: ['queued', 'running'] } },
      _max: { priority: true },
    })
    expect(job.priority).toBeGreaterThan(Math.max(0, others._max.priority ?? 0))
    // Review of #109: a second click after the first (the lock let go) queues nothing.
    const again = await post('/api/decks-today/refresh').send({})
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ queued: [], jobs: [], running: 4, sameList: 0 })
    // Each row follows its test, the copy too (same list); nothing is due any more.
    const queued = await rows()
    for (const row of queued.mine) expect(row.labRunning).toMatchObject({ jobId, status: 'queued', gamesDone: 0 })
    expect(queued.labDue).toBe(before.labDue - 4)
    // A test of another era's meta is not this era's test (self-review: «running» of any era).
    await test.prisma.$executeRaw`
      UPDATE simulation_jobs SET params = jsonb_set(params, '{lab,era}', '"B4"') WHERE id = ${jobId}`
    expect((await rows()).mine.every((row) => row.labRunning === null)).toBe(true)
    await test.prisma.$executeRaw`
      UPDATE simulation_jobs SET params = jsonb_set(params, '{lab,era}', '"B4a"') WHERE id = ${jobId}`

    // Played: the rows get the score of this era.
    await playAll((_a, _b, games) => Math.round(games * 0.55))
    const played = await rows()
    for (const row of played.mine) {
      expect(row.labRunning).toBeNull()
      expect(row.lab).toMatchObject({ jobId, era: 'B4a', bot: 'e2', stale: false })
    }
    expect((await post('/api/decks-today/refresh').send({ dryRun: true })).body).toMatchObject({ queued: [] })
    // H-007: a score of another engine is another game (self-review: no test said so).
    await test.prisma.simulationJob.update({ where: { id: jobId }, data: { engineRev: 'another-engine' } })
    expect((await rows()).mine.every((row) => row.lab === null)).toBe(true)
    await test.prisma.simulationJob.update({ where: { id: jobId }, data: { engineRev: test.env.engineRev } })

    // Review of the coordinator (14/10): a test with e3 neither shows as the deck's test nor replaces the e2 score.
    const e3 = await post('/api/lab/test').send({ decks: [{ deckId: built[0] }], players: ['e3', 'e3'], seed: 7300 })
    expect(e3.status).toBe(200)
    const playing = await rows()
    expect(playing.mine.find((row) => row.deck.id === built[0])?.labRunning).toBeNull()
    await playAll((_a, _b, games) => Math.round(games * 0.3))
    const withE3 = (await rows()).mine.find((row) => row.deck.id === built[0])
    expect(withE3?.lab).toMatchObject({ jobId, bot: 'e2' })
    expect(withE3?.labOthers).toEqual([expect.objectContaining({ bot: 'e3', jobId: e3.body.id })])

    // A score of another era is old: shown as such, due again, and not what «Laboratorio» sorts by. The second deck
    // gets a test of its own of this era first (a lower score than the old ones: the sort must not mix them).
    const own = await post('/api/lab/test').send({ decks: [{ deckId: built[1] }], seed: 7400 })
    expect(own.status).toBe(200)
    await playAll((_a, _b, games) => Math.round(games * 0.2))
    await test.prisma.$executeRaw`
      UPDATE simulation_jobs SET params = jsonb_set(params, '{lab,era}', '"B4"') WHERE id = ${jobId}`
    const old = await rows()
    for (const row of old.mine) {
      if (row.deck.id === built[1]) expect(row.lab).toMatchObject({ jobId: own.body.id, era: 'B4a', stale: false })
      else expect(row.lab).toMatchObject({ jobId, era: 'B4', stale: true })
    }
    expect(old.labDue).toBe(before.labDue - 1)
    const sorted = ((await get('/api/decks-today?sort=lab')).body.items as Row[]).filter((row) =>
      [...built, copyId].includes(row.deck.id),
    )
    expect(sorted[0]?.deck.id).toBe(built[1])
    expect(sorted.slice(1).every((row) => row.lab?.stale)).toBe(true)
    expect((await post('/api/decks-today/refresh').send({ dryRun: true })).body.queued).toEqual(
      expect.arrayContaining([built[0], built[2]]),
    )

    // Review of #109: a test that failed scores the lists it played whole; a list it did not finish is said («Reintentar
    // lo que falló») and not queued again on every click.
    const retest = await post('/api/decks-today/refresh').send({})
    expect(retest.body.jobs).toHaveLength(1)
    const [failedJob] = retest.body.jobs as [number]
    const chunks = await test.prisma.simulationChunk.findMany({ where: { jobId: failedJob }, orderBy: { idx: 'asc' } })
    const badSnapshot = chunks[0]?.snapshotAId as number
    await playAll((a, _b, games) => (a === badSnapshot ? games : Math.round(games * 0.4)))
    await test.prisma.simulationChunk.updateMany({
      where: { jobId: failedJob, snapshotAId: badSnapshot },
      data: { status: 'failed' },
    })
    await test.prisma.simulationChunk.updateMany({
      where: { jobId: failedJob, snapshotAId: badSnapshot, idx: { gt: chunks[0]?.idx ?? 0 } },
      data: { status: 'done' },
    })
    await test.prisma.simulationJob.update({ where: { id: failedJob }, data: { status: 'failed' } })
    const afterFail = await rows()
    const badDeck = (await test.prisma.deckSnapshot.findUniqueOrThrow({ where: { id: badSnapshot } })).deckId
    for (const row of afterFail.mine.filter((item) => item.deck.id !== built[1])) {
      if (String(badDeck) === row.deck.id || (row.deck.id === copyId && String(badDeck) === built[0])) {
        expect((row as Row & { labFailed: { jobId: number } | null }).labFailed).toEqual({ jobId: failedJob })
      } else {
        expect(row.lab).toMatchObject({ jobId: failedJob, era: 'B4a', stale: false })
      }
    }
    const planAfterFail = (await post('/api/decks-today/refresh').send({ dryRun: true })).body as {
      queued: string[]
      failed: { deckId: string; jobId: number }[]
    }
    expect(planAfterFail.queued).toEqual([])
    expect(planAfterFail.failed).toContainEqual({ deckId: String(badDeck), jobId: failedJob })

    // Needs a session.
    expect((await test.http().post('/api/decks-today/refresh').send({})).status).toBe(401)
    for (const id of [...built, copyId]) await patch(id, false)
  })

  it('consistency against the meta (D-019): the games split by weight among the bank, for workers 0.2.1+', async () => {
    const created = await post('/api/lab/consistency').send({ deckId: deckIds[1], size: 5, games: 100, seed: 11 })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ kind: 'consistency', players: ['e2', 'e2'], progress: { totalGames: 100 } })
    expect(created.body.label).toMatch(/^Consistencia contra el meta B4a de .*Mega-Blaziken/)
    const claimAs = (version: string) =>
      bearer('post', '/api/worker/claim').send({ ...hello, version, engineRev: test.env.engineRev })
    // A 0.2.0 worker would ignore the rivals and measure the goldfish curve: it does not get it.
    expect((await claimAs('0.2.0')).body.chunk).toBeNull()
    const chunk = (await claimAs('0.2.1')).body.chunk as {
      chunkId: number
      games: number
      consistency: { bot: string; rivals: { deck: string; games: number }[] }
    }
    expect(chunk.games).toBe(100)
    expect(chunk.consistency.bot).toBe('e2')
    expect(chunk.consistency.rivals).toHaveLength(5)
    expect(chunk.consistency.rivals.reduce((sum, rival) => sum + rival.games, 0)).toBe(100)
    const bank = (await get('/api/lab/bank?size=5')).body.rivals as { weight: number }[]
    chunk.consistency.rivals.forEach((rival, at) => {
      expect(rival.deck).toMatch(/Energy:/)
      expect(Math.abs(rival.games - (bank[at]?.weight ?? 0) * 100)).toBeLessThan(1)
    })
    const histogram = (games: number) => ({ games, firstOnTurn: [0, 5, games - 15, 0, 0, 0, 0, 0], never: 10 })
    const result = await bearer('put', `/api/worker/chunks/${chunk.chunkId}/result`).send({
      workerId: hello.workerId,
      engineRev: test.env.engineRev,
      winsA: 80,
      winsB: 20,
      ties: 0,
      games: 100,
      durationMs: 10,
      extra: {
        ready: { first: histogram(50), second: histogram(50) },
        attack: { first: histogram(50), second: histogram(50) },
      },
    })
    expect(result.body).toEqual({ accepted: true })
    const latest = (await get(`/api/simulations/consistency/deck/${deckIds[1]}`)).body
    expect(latest.result).toBeNull()
    expect(latest.meta.job.id).toBe(created.body.id)
    expect(latest.meta.consistency).toMatchObject({ mode: 'meta', era: 'B4a', games: { all: 100 } })
    expect(latest.meta.consistency.rivals).toHaveLength(5)
    expect(latest.meta.consistency.rivals[0]).toMatchObject({ label: expect.any(String), games: expect.any(Number) })
    expect((await post('/api/lab/consistency').send({ deckId: deckIds[1], bot: 'et' })).status).toBe(400)
    // Review of #28: with a bank of 10, an archetype's second list says so.
    const ten = await post('/api/lab/consistency').send({ deckId: deckIds[1], size: 10, games: 100, seed: 12 })
    expect(ten.status).toBe(201)
    const tenJob = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: ten.body.id } })
    expect(JSON.stringify(tenJob.params)).toContain('(2.ª lista)')
    expect((await post(`/api/simulations/${ten.body.id}/cancel`)).status).toBeLessThan(300)
  })

  it('recent tournament lists to play against (Fase 23): the top 8 of PMPT #45, checked against the engine', async () => {
    const recent = await get('/api/play/recent-lists')
    expect(recent.status).toBe(200)
    expect(recent.body).toMatchObject({ era: 'B4a', format: 'STANDARD', days: 7 })
    const items = recent.body.items as { placing: number; listKey: string; playable: boolean; tournamentName: string }[]
    expect(items.length).toBeGreaterThan(0)
    expect(items[0]).toMatchObject({ placing: 1, tournamentName: expect.stringMatching(/^PMPT #45/) })
    expect(items.every((item) => item.placing <= 8)).toBe(true)
    const playable = items.find((item) => item.playable)
    expect(playable).toBeDefined()
    // That list can be the bot's deck.
    const game = await post('/api/play').send({ human: { deckId: deckIds[1] }, rival: { listKey: playable?.listKey } })
    expect(game.status).toBe(201)
    expect(game.body.rival.listKey).toBe(playable?.listKey)
    await post(`/api/play/${game.body.id}/abandon`)
    expect((await get('/api/play/recent-lists?top=1')).body.items).toHaveLength(1)
    expect((await get('/api/play/recent-lists?top=0')).status).toBe(400)
  })

  it('build from a core (Fase 19): the lists that play the core give the rest; the collection caps it', async () => {
    const all = await post('/api/lab/core').send({ cards: ['B1-36'], pool: 'all' })
    expect(all.status).toBe(200)
    expect(all.body).toMatchObject({ era: 'B4a', pool: 'all', energies: ['fire'], total: 20, problems: [], left: [] })
    expect(all.body.basis).toMatchObject({ kind: 'together' })
    expect(all.body.basis.text).toMatch(/^Lo que juegan las \d+ listas de la era con Mega-Blaziken ex$/)
    const byName = new Map(
      (all.body.cards as { nameEs: string; count: number; reason: string }[]).map((c) => [c.nameEs, c]),
    )
    expect(byName.get('Mega-Blaziken ex')).toMatchObject({ count: 2, reason: 'core' })
    expect(byName.get('Torchic')).toMatchObject({ count: 2, reason: 'line' })
    expect(byName.get('Caramelo Raro')).toMatchObject({ count: 2, reason: 'line' })

    // The collection (the CSV of 6/10, where deck 2 — Mega-Blaziken ex — is complete).
    const mine = await post('/api/lab/core').send({ cards: ['B1-36'] })
    expect(mine.body).toMatchObject({ pool: 'collection', left: [] })
    const mineCards = mine.body.cards as { nameEs: string; count: number }[]
    expect(mineCards.find((card) => card.nameEs === 'Mega-Blaziken ex')?.count).toBe(2)
    expect(mineCards.reduce((sum, card) => sum + card.count, 0)).toBe(mine.body.total)

    expect((await post('/api/lab/core').send({ cards: [] })).status).toBe(400)
    expect((await post('/api/lab/core').send({ cards: ['ZZ-999'] })).status).toBe(400)
  })

  it('a pasted list is tested like a deck; one that does not parse says why', async () => {
    const text = readFileSync(DECKS_PATH, 'utf8')
    const start = text.indexOf('\n### 2. ')
    const section = text.slice(start + 1, text.indexOf('\n### 3. '))
    const dry = await post('/api/lab/test').send({
      decks: [{ text: section, energies: ['fire'] }],
      size: 3,
      dryRun: true,
    })
    expect(dry.status).toBe(200)
    expect(dry.body.preview.sideA[0]).toMatchObject({ sourceType: 'text', simulable: true })
    const bad = await post('/api/lab/test').send({ decks: [{ text: 'nada que leer' }], size: 3, dryRun: true })
    expect(bad.status).toBe(400)
  })

  it('automatic search: rounds of variants, the winner is verified and replaces the incumbent, a confirmation, the end', async () => {
    const config = {
      gamesPerRival: 10,
      variantsPerRound: 3,
      maxRounds: 2,
      patience: 2,
      confirmGames: 20,
      verifyGames: 20,
      pool: 'all',
      // Fase 42: these predate the games by weight, the replay with e3 and carreras (their own tests below).
      byWeight: false,
      confirmBot: null,
      race: false,
    }
    const dry = await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 5, config, dryRun: true })
    expect(dry.status).toBe(200)
    expect(dry.body.firstRound).toHaveLength(3)
    expect(dry.body.pool).toBeGreaterThan(50)
    expect(dry.body.games).toEqual({
      perRound: 4 * 5 * 10,
      max: (4 * 5 * 10 + 2 * 5 * 20) * 2 + 2 * 5 * 20,
      probe: 0,
      fill: 0,
      robustness: 0,
    })
    // H-021: the plan says its seed, and that seed plays this same first round.
    expect(typeof dry.body.seed).toBe('number')
    const again = await post('/api/lab/explore').send({
      deck: { deckId: deckIds[1] },
      size: 5,
      config,
      dryRun: true,
      seed: dry.body.seed,
    })
    expect(again.body.seed).toBe(dry.body.seed)
    expect(again.body.firstRound).toEqual(dry.body.firstRound)
    // Fase 16: under an event's rules. «Sin ex» breaks the starting list (Mega-Blaziken ex): refused, with why.
    const noEx = await test
      .http()
      .post('/api/events')
      .set('Cookie', cookie)
      .send({ name: 'Sin ex', rules: { noEx: true } })
    const refused = await post('/api/lab/explore').send({
      deck: { deckId: deckIds[1] },
      size: 5,
      config,
      dryRun: true,
      eventId: noEx.body.id,
    })
    expect(refused.status).toBe(422)
    expect(refused.body.error.code).toBe('event_rules')
    expect(refused.body.error.message).toContain('Sin ex')
    // Only Fire Pokémon: the variants never bring another type in.
    const fire = await test
      .http()
      .post('/api/events')
      .set('Cookie', cookie)
      .send({ name: 'Fuego', rules: { types: ['fire'] } })
    const onlyFire = await post('/api/lab/explore').send({
      deck: { deckId: deckIds[1] },
      size: 5,
      config,
      dryRun: true,
      eventId: fire.body.id,
    })
    if (onlyFire.status === 200) {
      expect(onlyFire.body.pool).toBeLessThan(dry.body.pool)
    } else {
      // The starting deck plays a non-Fire Pokémon: the rule is checked before anything.
      expect(onlyFire.body.error.code).toBe('event_rules')
    }

    const created = await post('/api/lab/explore').send({
      deck: { deckId: deckIds[1] },
      size: 5,
      config,
      seed: 9000,
      locked: ['B1-36'],
    })
    expect(created.status).toBe(200)
    expect(created.body).toMatchObject({ kind: 'explore', lab: 'explore', status: 'queued', replaySample: 0 })
    expect(created.body.progress.totalGames).toBe(200)
    const jobId = created.body.id as number
    const job = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: jobId } })
    const state = (
      job.params as {
        lab: {
          explore: {
            base: number
            rounds: { candidates: number[] }[]
            frozen?: { pool: [string, number, number][]; affinity: unknown[] }
          }
        }
      }
    ).lab.explore
    const base = state.base
    // H-021: the pool is kept as it was at the start, for every later round. Review of #27: for every Energy Zone, and
    // filtered with the one in play (the plan shows the starting list's).
    expect(state.frozen?.pool.length).toBeGreaterThan(dry.body.pool)
    const thawed = (state.frozen?.pool ?? []).map(([cardId, maxCopies, weight]) => {
      const card = test.app.get(CatalogService).requireIndex().cardById(cardId)
      return { cardId, groupId: card?.functionalGroupId ?? cardId, nameEn: card?.nameEn ?? '', maxCopies, weight }
    })
    // (The plan counts the cards drawn on their own: a pre-evolution that only comes along has weight 0.)
    expect(
      poolForZone(thawed, dry.body.base.energies, test.app.get(CatalogService).requireIndex()).filter(
        (card) => card.weight > 0,
      ),
    ).toHaveLength(dry.body.pool)
    const [, winner] = state.rounds[0]?.candidates ?? []
    if (winner === undefined) throw new Error('no second variant')

    // Same seed per rival within the round (common random numbers).
    const round0 = await test.prisma.simulationChunk.findMany({ where: { jobId }, orderBy: { idx: 'asc' } })
    const seeds = new Map<number, Set<string>>()
    for (const chunk of round0) {
      const set = seeds.get(chunk.snapshotBId as number) ?? new Set()
      set.add(chunk.seed.toString())
      seeds.set(chunk.snapshotBId as number, set)
    }
    expect([...seeds.values()].every((set) => set.size === 1)).toBe(true)
    expect(new Set([...seeds.values()].map((set) => [...set][0])).size).toBe(5)

    // Round 0: the second variant wins 9 of 10, everything else half: it passes the screen. The verification
    // (H-010) replays it against the starting list on fresh seeds and it wins again. Round 1: nobody beats it.
    const played = await playAll((a, _b, games) => (a === winner ? Math.round(games * 0.9) : games / 2))
    expect(played).toBe(20 + 10 + 20 + 10)

    const lab = (await get(`/api/lab/jobs/${jobId}`)).body
    expect(lab).toMatchObject({ mode: 'explore', job: { status: 'done' } })
    expect(lab.explore).toMatchObject({ phase: 'done', stopReason: 'rounds', base, best: winner, roundsDone: 2 })
    expect(
      lab.explore.rounds.map((round: { kind: string; accepted: number | null }) => [round.kind, round.accepted]),
    ).toEqual([
      ['search', null],
      ['verify', winner],
      ['search', null],
      ['confirm', null],
    ])
    expect(lab.explore.rounds[0].screened).toBe(winner)
    // H-010: the confirmation backs it (90 % against 50 % on fresh games).
    expect(lab.explore.confirmation).toMatchObject({ verdict: 'better' })
    expect(lab.explore.confirmation.differenceText).toMatch(/^\+40,0 puntos \(IC\u00a0\+/u)
    const best = lab.decks[0] as {
      role: string
      snapshot: number
      confirm: { score: Score }
      changes: { add: unknown[]; remove: { cardId: string }[] }
    }
    expect(best).toMatchObject({ role: 'best', snapshot: winner })
    expect(best.confirm.score.games).toBe(100)
    expect(best.confirm.score.value).toBeCloseTo(90, 8)
    expect(best.changes.add.length).toBeGreaterThan(0)
    expect(best.changes.remove.map((change) => change.cardId)).not.toContain('B1-36')
    // T-017 E1/E2: against the list it came from (90 % against 50 %), and why its cards came in. Review of #20: the
    // number shown is its verification's, on fresh games; the round that picked it, which flatters it, goes alongside.
    const explained = lab.decks[0] as {
      vsParent: { value: number; paired: boolean; measuredIn: string; complete: boolean; selectionText: string }
      why: { archetypeShare: number | null; eraShare: number | null; missing: number }[]
    }
    expect(explained.vsParent).toMatchObject({ paired: false, measuredIn: 'verify', complete: true })
    expect(explained.vsParent.value).toBeCloseTo(40, 6)
    expect(explained.vsParent.selectionText).toMatch(/^\+40,0 puntos/u)
    // A variant that was never verified is measured in its round.
    const other = lab.decks.find((deck: { role: string }) => deck.role === 'variant')
    expect(other.vsParent).toMatchObject({ measuredIn: 'round', complete: true, selectionText: null })
    expect(explained.why.length).toBeGreaterThan(0)
    for (const card of explained.why) {
      expect(card.archetypeShare).not.toBeNull()
      expect(card.eraShare).toBeGreaterThanOrEqual(0)
      expect(card.missing).toBeGreaterThanOrEqual(0)
    }
    expect(Array.isArray(lab.explore.leftOut)).toBe(true)
    const baseRow = lab.decks.find((deck: { role: string }) => deck.role === 'base')
    expect(baseRow.confirm.score.games).toBe(100)
    expect(baseRow.confirm.score.value).toBeCloseTo(50, 8)
    // «¿Cuál llevo hoy?» reads the deck's score from this search's chunks: the confirmation's, not the search's.
    const fromSearch = await test.app.get(LabService).deckScore(Number(deckIds[1]))
    expect(fromSearch?.jobId).toBe(jobId)
    expect(fromSearch?.score.score).toMatchObject({ games: 100 })
    expect(fromSearch?.score.score?.value).toBeCloseTo(50, 8)
    // Review of #109: a confirmation that failed halfway leaves the search's score (the search was whole), and the
    // list is not marked as failed.
    const baseChunks = await test.prisma.simulationChunk.findMany({
      where: { jobId, snapshotAId: baseRow.snapshot },
      orderBy: { idx: 'desc' },
    })
    await test.prisma.simulationChunk.update({ where: { id: baseChunks[0]?.id as number }, data: { status: 'failed' } })
    await test.prisma.simulationJob.update({ where: { id: jobId }, data: { status: 'failed' } })
    const afterFail = (await test.app.get(LabService).deckLabStatus([Number(deckIds[1])], 'B4a')).get(
      Number(deckIds[1]),
    )
    expect(afterFail?.failed).toBeNull()
    expect(afterFail?.score?.jobId).toBe(jobId)
    expect(afterFail?.score?.score.score?.games).not.toBe(100)
    await test.prisma.simulationChunk.update({ where: { id: baseChunks[0]?.id as number }, data: { status: 'done' } })
    await test.prisma.simulationJob.update({ where: { id: jobId }, data: { status: 'done' } })
    expect(lab.decks.filter((deck: { role: string }) => deck.role === 'variant')).toHaveLength(5)
    const total = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: jobId } })
    expect(total.totalGames).toBe(200 + 200 + 200 + 200)
  }, 60_000)

  it('H-010: a variant that only won the screen by luck does not stay; the confirmation says when it is unclear', async () => {
    const config = {
      gamesPerRival: 10,
      variantsPerRound: 2,
      maxRounds: 1,
      patience: 3,
      confirmGames: 20,
      verifyGames: 20,
      pool: 'all',
      // Fase 42: these predate the games by weight, the replay with e3 and carreras (their own tests below).
      byWeight: false,
      confirmBot: null,
      race: false,
    }
    const created = await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 3, config, seed: 9100 })
    expect(created.status).toBe(200)
    const job = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: created.body.id } })
    const state = (job.params as { lab: { explore: { base: number; rounds: { candidates: number[] }[] } } }).lab.explore
    const [lucky] = state.rounds[0]?.candidates ?? []
    if (lucky === undefined) throw new Error('no variant')
    // The lucky variant wins 9 of 10 in the search round (chunk seeds of round 0) and half on fresh seeds.
    const round0 = new Set(
      (await test.prisma.simulationChunk.findMany({ where: { jobId: created.body.id } })).map((chunk) => chunk.id),
    )
    const played = await playAll((a, _b, games, chunkId) =>
      a === lucky && round0.has(chunkId) ? Math.round(games * 0.9) : games / 2,
    )
    const lab = (await get(`/api/lab/jobs/${created.body.id}`)).body
    expect(played).toBe(9 + 6)
    expect(
      lab.explore.rounds.map((round: { kind: string; accepted: number | null }) => [round.kind, round.accepted]),
    ).toEqual([
      ['search', null],
      ['verify', null],
    ])
    expect(lab.explore).toMatchObject({ phase: 'done', stopReason: 'rounds', best: state.base, confirmation: null })
    // Review of #15: the swap the verification rejected is no longer a candidate for the combos.
    const after = (await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: created.body.id } })).params as {
      lab: { explore: { swaps?: { variant: number }[] } }
    }
    expect((after.lab.explore.swaps ?? []).map((swap) => swap.variant)).not.toContain(lucky)
  }, 60_000)

  it('a search that finds nothing better ends without a confirmation; a cancelled one stops queueing', async () => {
    const config = {
      gamesPerRival: 10,
      variantsPerRound: 2,
      maxRounds: 5,
      patience: 1,
      confirmGames: 20,
      pool: 'collection',
      byWeight: false,
      race: false,
    }
    const created = await post('/api/lab/explore').send({ deck: { deckId: deckIds[0] }, size: 3, config, seed: 4000 })
    expect(created.status).toBe(200)
    expect(await playAll((_a, _b, games) => games / 2)).toBe(9)
    const lab = (await get(`/api/lab/jobs/${created.body.id}`)).body
    expect(lab.explore).toMatchObject({ phase: 'done', stopReason: 'patience', best: lab.explore.base })
    expect(lab.job.status).toBe('done')

    const other = await post('/api/lab/explore').send({ deck: { deckId: deckIds[0] }, size: 3, config, seed: 4100 })
    expect((await post(`/api/simulations/${other.body.id}/cancel`)).body.status).toBe('cancelled')
    expect(await playAll(() => 0)).toBe(0)
  }, 60_000)

  it('T-017 C4: what a round measured steers the next one, and two swaps that helped are tried together', async () => {
    const config = {
      gamesPerRival: 10,
      variantsPerRound: 3,
      maxRounds: 2,
      patience: 3,
      confirmGames: 20,
      verifyGames: 20,
      pool: 'all',
      // Fase 42: these predate the games by weight, the replay with e3 and carreras (their own tests below).
      byWeight: false,
      confirmBot: null,
      race: false,
    }
    const created = await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 3, config, seed: 9402 })
    expect(created.status).toBe(200)
    const read = async () =>
      (
        (await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: created.body.id } })).params as {
          lab: {
            explore: {
              base: number
              rounds: { candidates: number[] }[]
              combos?: number[]
              swaps?: { variant: number }[]
            }
          }
        }
      ).lab.explore
    const [better, alsoBetter, worse] = (await read()).rounds[0]?.candidates ?? []
    // Round 0: two variants win 6 of 10 (not enough for the screen), one 4, the starting list 5. (With seed 9400 the two
    // that win both bring in a Helio and together they would make an invalid deck: no combo, as it should be.)
    const wins = (a: number, games: number) =>
      a === better || a === alsoBetter ? Math.round(games * 0.6) : a === worse ? Math.round(games * 0.4) : games / 2
    await playAll((a, _b, games) => wins(a, games))
    const state = await read()
    expect(state.rounds.map((round) => round.candidates.length)).toEqual([3, 3])
    // Round 1 opens with the combo of the two that helped.
    expect(state.combos).toHaveLength(1)
    expect(state.rounds[1]?.candidates[0]).toBe(state.combos?.[0])
    // Review of the stack: once measured, the combo does not join the swaps a later combo is built from (C7).
    expect((state.swaps ?? []).map((swap) => swap.variant)).not.toContain(state.combos?.[0])
    const lab = (await get(`/api/lab/jobs/${created.body.id}`)).body
    expect(lab.explore.combos).toEqual(state.combos)
    expect(lab.explore.learned.length).toBeGreaterThan(0)
    expect(lab.explore.learned[0]).toMatchObject({ sign: expect.stringMatching(/^[+-]$/), n: expect.any(Number) })
  }, 60_000)

  it('T-017 D2: «Frenar y confirmar» ends the round in play with what it has and confirms what was found', async () => {
    const config = {
      gamesPerRival: 10,
      variantsPerRound: 2,
      maxRounds: 6,
      patience: 6,
      confirmGames: 20,
      verifyGames: 20,
      pool: 'all',
      // Fase 42: these predate the games by weight, the replay with e3 and carreras (their own tests below).
      byWeight: false,
      confirmBot: null,
      race: false,
    }
    const created = await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 3, config, seed: 9500 })
    const id = created.body.id as number
    const job = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })
    const [winner] =
      (job.params as { lab: { explore: { rounds: { candidates: number[] }[] } } }).lab.explore.rounds[0]?.candidates ??
      []
    // Round 0 (3 lists × 3 rivals) and the verification (2 × 3): the winner stays.
    const played = await playAll((a, _b, games) => (a === winner ? Math.round(games * 0.9) : games / 2), 9 + 6)
    expect(played).toBe(15)
    // Round 1 is queued: stop it. Nothing is in play, so it ends right away and the confirmation is queued.
    const stopped = await post(`/api/lab/jobs/${id}/stop`)
    expect(stopped.status).toBe(200)
    expect(stopped.body.explore).toMatchObject({ phase: 'confirm', stopReason: 'user', stopReasonEs: 'la frenaste' })
    expect(await playAll((a, _b, games) => (a === winner ? Math.round(games * 0.9) : games / 2))).toBe(6)
    const lab = (await get(`/api/lab/jobs/${id}`)).body
    expect(lab.job.status).toBe('done')
    expect(lab.explore).toMatchObject({ phase: 'done', stopReason: 'user', best: winner })
    expect(lab.explore.confirmation).toMatchObject({ verdict: 'better' })
    // Stopping twice is refused.
    expect((await post(`/api/lab/jobs/${id}/stop`)).status).toBe(400)
  }, 60_000)

  it('review of #22: with a chunk in play, «Frenar» waits for it; the confirmation never lands in the stopped round', async () => {
    const config = {
      gamesPerRival: 10,
      variantsPerRound: 2,
      maxRounds: 6,
      patience: 6,
      confirmGames: 20,
      verifyGames: 20,
      pool: 'all',
      // Fase 42: these predate the games by weight, the replay with e3 and carreras (their own tests below).
      byWeight: false,
      confirmBot: null,
      race: false,
    }
    const created = await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 3, config, seed: 9510 })
    const id = created.body.id as number
    type Rounds = {
      lab: { explore: { rounds: { kind: string; candidates: number[]; fromIdx: number; toIdx: number }[] } }
    }
    const rounds = async () =>
      ((await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })).params as unknown as Rounds).lab.explore
        .rounds
    const [winner] = (await rounds())[0]?.candidates ?? []
    const wins = (a: number, _b: number, games: number) => (a === winner ? Math.round(games * 0.9) : games / 2)
    // Round 0 (3 lists × 3 rivals) and the verification (2 × 3): the winner stays and round 1 is queued.
    expect(await playAll(wins, 9 + 6)).toBe(15)
    const before = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })
    // A worker takes one chunk of round 1; the other 8 are still queued.
    const claim = await bearer('post', '/api/worker/claim').send({ ...hello, engineRev: test.env.engineRev })
    const inPlay = (claim.body.chunk as Structured).chunkId as number
    const stopped = await post(`/api/lab/jobs/${id}/stop`)
    expect(stopped.status).toBe(200)
    expect(stopped.body.explore).toMatchObject({ phase: 'search', stopRequested: true })
    expect(stopped.body.explore.rounds.at(-1)).toMatchObject({ kind: 'search', stopped: true, decided: false })
    expect(await test.prisma.simulationChunk.count({ where: { jobId: id, status: 'queued' } })).toBe(0)
    const after = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })
    expect(after.totalGames).toBe(before.totalGames - 8 * 10)
    // Asked again while it finishes: refused, with the reason.
    const again = await post(`/api/lab/jobs/${id}/stop`)
    expect(again.status).toBe(400)
    expect(again.body.error.message).toMatch(/^Ya la frenaste/u)
    // The chunk in play comes back: the round ends with what it has and the confirmation is queued after its range.
    await report(inPlay, wins)
    const confirming = (await get(`/api/lab/jobs/${id}`)).body
    expect(confirming.explore).toMatchObject({ phase: 'confirm', stopReason: 'user' })
    const all = await rounds()
    const cut = all.at(-2)
    const confirm = all.at(-1)
    expect(cut?.kind).toBe('search')
    expect(confirm?.kind).toBe('confirm')
    expect(confirm?.fromIdx).toBeGreaterThanOrEqual(cut?.toIdx ?? Number.POSITIVE_INFINITY)
    const confirmChunks = await test.prisma.simulationChunk.findMany({
      where: { jobId: id, idx: { gte: confirm?.fromIdx ?? 0 } },
    })
    expect(confirmChunks).toHaveLength(6)
    expect(await playAll(wins)).toBe(6)
    const lab = (await get(`/api/lab/jobs/${id}`)).body
    expect(lab.explore).toMatchObject({ phase: 'done', stopReason: 'user', best: winner })
    expect(lab.explore.confirmation).toMatchObject({ verdict: 'better' })
  }, 60_000)

  it('review of #22: «Frenar» during a verification lets it finish, so the variant it checks can still stay', async () => {
    const config = {
      gamesPerRival: 10,
      variantsPerRound: 2,
      maxRounds: 6,
      patience: 6,
      confirmGames: 20,
      verifyGames: 20,
      pool: 'all',
      // Fase 42: these predate the games by weight, the replay with e3 and carreras (their own tests below).
      byWeight: false,
      confirmBot: null,
      race: false,
    }
    const created = await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 3, config, seed: 9520 })
    const id = created.body.id as number
    const job = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })
    const [winner] =
      (job.params as { lab: { explore: { rounds: { candidates: number[] }[] } } }).lab.explore.rounds[0]?.candidates ??
      []
    const wins = (a: number, _b: number, games: number) => (a === winner ? Math.round(games * 0.9) : games / 2)
    // Round 0 only: its winner goes to verification (2 lists × 3 rivals, queued).
    expect(await playAll(wins, 9)).toBe(9)
    const stopped = await post(`/api/lab/jobs/${id}/stop`)
    expect(stopped.status).toBe(200)
    expect(stopped.body.explore).toMatchObject({ phase: 'search', stopRequested: true })
    expect(stopped.body.explore.rounds.at(-1)).toMatchObject({ kind: 'verify', stopped: false, decided: false })
    expect(await test.prisma.simulationChunk.count({ where: { jobId: id, status: 'queued' } })).toBe(6)
    // The verification plays in full and backs it; then the confirmation, and no new round.
    expect(await playAll(wins)).toBe(6 + 6)
    const lab = (await get(`/api/lab/jobs/${id}`)).body
    expect(
      lab.explore.rounds.map((round: { kind: string; accepted: number | null }) => [round.kind, round.accepted]),
    ).toEqual([
      ['search', null],
      ['verify', winner],
      ['confirm', null],
    ])
    expect(lab.explore).toMatchObject({ phase: 'done', stopReason: 'user', best: winner, stopRequested: true })
  }, 60_000)

  it('bots review, item 5: a complete variant that wins the stopped round is verified, then confirmed', async () => {
    const config = {
      gamesPerRival: 10,
      variantsPerRound: 2,
      maxRounds: 6,
      patience: 6,
      confirmGames: 20,
      verifyGames: 20,
      pool: 'all',
      // Fase 42: these predate the games by weight, the replay with e3 and carreras (their own tests below).
      byWeight: false,
      confirmBot: null,
      race: false,
    }
    const created = await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 3, config, seed: 9530 })
    const id = created.body.id as number
    const job = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })
    const [winner, other] =
      (job.params as { lab: { explore: { rounds: { candidates: number[] }[] } } }).lab.explore.rounds[0]?.candidates ??
      []
    const wins = (a: number, _b: number, games: number) => (a === winner ? Math.round(games * 0.9) : games / 2)
    // Round 0: the starting list and the winner play all their rivals; the other variant's chunks are still queued.
    const queued = await test.prisma.simulationChunk.findMany({ where: { jobId: id }, orderBy: { idx: 'asc' } })
    const others = queued.filter((chunk) => chunk.snapshotAId === other)
    expect(others).toHaveLength(3)
    // Hold the other variant back (leased by another worker for an hour), play the rest, then put it back in the queue.
    const held = { id: { in: others.map((chunk) => chunk.id) } }
    await test.prisma.simulationChunk.updateMany({
      where: held,
      data: { status: 'leased', workerId: 'held', leaseUntil: new Date(Date.now() + 60 * 60 * 1000) },
    })
    expect(await playAll(wins)).toBe(6)
    await test.prisma.simulationChunk.updateMany({
      where: held,
      data: { status: 'queued', workerId: null, leaseUntil: null },
    })
    const stopped = await post(`/api/lab/jobs/${id}/stop`)
    expect(stopped.status).toBe(200)
    // The winner was complete: it goes to verification instead of being thrown away.
    expect(stopped.body.explore.rounds.at(-2)).toMatchObject({ kind: 'search', stopped: true, screened: winner })
    expect(stopped.body.explore.rounds.at(-1)).toMatchObject({ kind: 'verify', candidates: [winner] })
    expect(await playAll(wins)).toBe(6 + 6)
    const lab = (await get(`/api/lab/jobs/${id}`)).body
    expect(
      lab.explore.rounds.map((round: { kind: string; accepted: number | null }) => [round.kind, round.accepted]),
    ).toEqual([
      ['search', null],
      ['verify', winner],
      ['confirm', null],
    ])
    expect(lab.explore).toMatchObject({ phase: 'done', stopReason: 'user', best: winner })
  }, 60_000)

  it('review of the stack: an accepted Energy change sets the pool of the next rounds; fixed variants fit the round', async () => {
    // A deck with two Energy types: from round 1, one variant tries one of them alone.
    let deckId: string | undefined
    for (const id of deckIds) {
      if (((await get(`/api/decks/${id}`)).body.energies as string[]).length === 2) {
        deckId = id
        break
      }
    }
    if (!deckId) throw new Error('no deck with two types')
    const config = {
      gamesPerRival: 10,
      variantsPerRound: 1,
      maxRounds: 3,
      patience: 3,
      confirmGames: 20,
      verifyGames: 0,
      pool: 'all',
      // Fase 42: these predate the games by weight, the replay with e3 and carreras (their own tests below).
      byWeight: false,
      confirmBot: null,
      race: false,
    }
    const created = await post('/api/lab/explore').send({ deck: { deckId }, size: 3, config, seed: 9700 })
    expect(created.status).toBe(200)
    const id = created.body.id as number
    type State = {
      base: number
      incumbent: number
      rounds: { candidates: number[] }[]
      accepted?: unknown[]
    }
    const read = async () =>
      ((await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })).params as { lab: { explore: State } }).lab
        .explore
    const energiesOf = async (sid: number) =>
      (await test.prisma.deckSnapshot.findUniqueOrThrow({ where: { id: sid } })).energies as string[]
    // Round 0: nothing better (everyone half). While it plays, the variant's difference says «jugando».
    const claim = await bearer('post', '/api/worker/claim').send({ ...hello, engineRev: test.env.engineRev })
    const playing = (await get(`/api/lab/jobs/${id}`)).body
    const variantRow = playing.decks.find((deck: { role: string }) => deck.role === 'variant')
    expect(variantRow.vsParent).toMatchObject({ text: 'jugando', complete: false })
    await report((claim.body.chunk as Structured).chunkId as number, (_a, _b, games) => games / 2)
    expect(await playAll((_a, _b, games) => games / 2, 5)).toBe(5)
    const first = await read()
    expect(first.rounds).toHaveLength(2)
    // Round 1: one variant only (variantsPerRound 1), the Energy one first among the fixed ones; it wins.
    const [energyOne] = first.rounds[1]?.candidates ?? []
    if (energyOne === undefined) throw new Error('no round 1 variant')
    expect(first.rounds[1]?.candidates).toHaveLength(1)
    const zone = await energiesOf(energyOne)
    expect(zone).not.toEqual(await energiesOf(first.base))
    expect(zone).toHaveLength(1)
    expect(await playAll((a, _b, games) => (a === energyOne ? games : games / 2), 6)).toBe(6)
    const second = await read()
    expect(second.incumbent).toBe(energyOne)
    // An Energy change alone is not a card swap to undo later.
    expect(second.accepted ?? []).toHaveLength(0)
    const lab = (await get(`/api/lab/jobs/${id}`)).body
    const best = lab.decks.find((deck: { snapshot: number }) => deck.snapshot === energyOne)
    expect(best.energyChange).toMatchObject({ to: zone })
    // Round 2: its variants are saved with the new zone, and what they add can be paid with it.
    const index = test.app.get(CatalogService).requireIndex()
    for (const sid of second.rounds[2]?.candidates ?? []) {
      const energies = await energiesOf(sid)
      if (energies.join() !== zone.join()) continue
      const row = lab.decks.find((deck: { snapshot: number }) => deck.snapshot === sid)
      for (const line of (row?.changes?.add ?? []) as { cardId: string }[]) {
        const card = index.cardById(line.cardId)
        if (card) expect(usableWith(card, zone as SelectableEnergy[])).toBe(true)
      }
    }
    expect(second.rounds[2]?.candidates).toHaveLength(1)
    await post(`/api/simulations/${id}/cancel`)
  }, 60_000)

  it('fase 42: each rival plays by its weight, the same for every list; a confirmed find is replayed with e3', async () => {
    const config = {
      gamesPerRival: 20,
      variantsPerRound: 2,
      maxRounds: 1,
      patience: 3,
      confirmGames: 20,
      verifyGames: 20,
      pool: 'all',
    }
    const created = await post('/api/lab/explore').send({
      deck: { deckId: deckIds[1] },
      size: 3,
      config: { ...config, race: false },
      seed: 9800,
    })
    expect(created.status).toBe(200)
    const id = created.body.id as number
    const job = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })
    const params = job.params as {
      lab: { rivals: { snapshot: number; weight: number }[]; explore: { rounds: { candidates: number[] }[] } }
    }
    const [winner] = params.lab.explore.rounds[0]?.candidates ?? []
    // Round 0: 3 lists × 3 rivals; each rival's games follow its weight (10 at least), 60 per list in all.
    const chunks = await test.prisma.simulationChunk.findMany({ where: { jobId: id } })
    const byRival = new Map<number, Set<number>>()
    for (const chunk of chunks) {
      const set = byRival.get(chunk.snapshotBId as number) ?? new Set<number>()
      set.add(chunk.games)
      byRival.set(chunk.snapshotBId as number, set)
    }
    expect([...byRival.values()].every((set) => set.size === 1)).toBe(true)
    const perRival = params.lab.rivals.map((rival) => [...(byRival.get(rival.snapshot) ?? [])][0] ?? 0)
    expect(perRival.reduce((sum, games) => sum + games, 0)).toBe(60)
    expect(Math.min(...perRival)).toBeGreaterThanOrEqual(10)
    const heaviest = params.lab.rivals.reduce(
      (top, rival, at) => (rival.weight > (params.lab.rivals[top]?.weight ?? 0) ? at : top),
      0,
    )
    expect(perRival[heaviest]).toBe(Math.max(...perRival))

    // The winner wins 9 of 10 with any bot: verified, confirmed, and replayed with e3 as a test of its own.
    const wins = (a: number, _b: number, games: number) =>
      a === winner ? Math.round(games * 0.9) : Math.floor(games / 2)
    expect(await playAll(wins, 9 + 6 + 6)).toBe(21)
    const confirmed = (await get(`/api/lab/jobs/${id}`)).body
    expect(confirmed.explore.confirmation).toMatchObject({ verdict: 'better' })
    expect(confirmed.explore.robustness).toMatchObject({ bot: 'e3', status: 'queued', robustness: null })
    const replay = await test.prisma.simulationJob.findUniqueOrThrow({
      where: { id: confirmed.explore.robustness.jobId },
    })
    expect(replay).toMatchObject({
      kind: 'compare',
      players: ['e3', 'e3'],
      label: `Confirmación con e3 de #${id}`,
      // Review of #49: behind the rest (D-024).
      priority: -1,
    })
    expect((replay.params as { lab: { robustnessOf: number } }).lab.robustnessOf).toBe(id)
    expect(await playAll(wins)).toBe(6)
    const done = (await get(`/api/lab/jobs/${id}`)).body
    expect(done.explore.robustness).toMatchObject({
      bot: 'e3',
      status: 'done',
      verdict: 'better',
      robustness: 'robust',
      robustnessEs: 'robusto: con e3 también sale mejor',
    })
    // The replay is not a test of the deck: its score stays the search's.
    const score = await test.app.get(LabService).deckScore(Number(deckIds[1]))
    expect(score?.jobId === replay.id).toBe(false)
  }, 60_000)

  it('review of #49: «sensible al bot» when e3 says worse, «no alcanza» when it cannot tell; none with e3 already', async () => {
    const config = {
      gamesPerRival: 10,
      variantsPerRound: 2,
      maxRounds: 1,
      patience: 3,
      confirmGames: 20,
      verifyGames: 20,
      pool: 'all',
      race: false,
    }
    const search = async (seed: number, players?: [string, string]) => {
      const created = await post('/api/lab/explore').send({
        deck: { deckId: deckIds[1] },
        size: 3,
        config,
        seed,
        ...(players ? { players } : {}),
      })
      expect(created.status).toBe(200)
      const job = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: created.body.id } })
      const [winner] =
        (job.params as { lab: { explore: { rounds: { candidates: number[] }[] } } }).lab.explore.rounds[0]
          ?.candidates ?? []
      return { id: created.body.id as number, winner: winner as number }
    }
    const findsIt = (winner: number) => (a: number, _b: number, games: number) =>
      a === winner ? Math.round(games * 0.9) : Math.floor(games / 2)
    const view = async (id: number) => (await get(`/api/lab/jobs/${id}`)).body

    // e3 says the found list is worse: «sensible al bot».
    const worse = await search(9810)
    expect(await playAll(findsIt(worse.winner), 9 + 6 + 6)).toBe(21)
    const replayId = (await view(worse.id)).explore.robustness.jobId as number
    // Its games by weight, as the confirmation's: 60 per list in all, not 20 for every rival.
    const replayChunks = await test.prisma.simulationChunk.findMany({ where: { jobId: replayId } })
    const ofList = replayChunks.filter((chunk) => chunk.snapshotAId === worse.winner)
    expect(ofList.reduce((sum, chunk) => sum + chunk.games, 0)).toBe(60)
    expect(new Set(ofList.map((chunk) => chunk.games)).size).toBeGreaterThan(1)
    expect(
      await playAll((a, _b, games) => (a === worse.winner ? Math.round(games * 0.1) : Math.floor(games / 2))),
    ).toBe(6)
    expect((await view(worse.id)).explore.robustness).toMatchObject({
      status: 'done',
      verdict: 'worse',
      robustness: 'bot_sensitive',
    })

    // e3 cannot tell (both at half): «no alcanza», not «sensible al bot».
    const even = await search(9820)
    expect(await playAll(findsIt(even.winner), 21)).toBe(21)
    expect(await playAll((_a, _b, games) => Math.floor(games / 2))).toBe(6)
    expect((await view(even.id)).explore.robustness).toMatchObject({
      status: 'done',
      verdict: 'unclear',
      robustness: 'inconclusive',
      robustnessEs: expect.stringMatching(/^con e3 no alcanza para decir/),
    })

    // A search already played with e3 is not replayed with it.
    const withE3 = await search(9830, ['e3', 'e3'])
    expect(await playAll(findsIt(withE3.winner), 21)).toBe(21)
    const played = await view(withE3.id)
    expect(played.explore.confirmation).toMatchObject({ verdict: 'better' })
    expect(played.explore.robustness).toBeNull()

    // A replay marked pending (the app restarted before queueing it) is queued by the sweep; cancelled, it says so.
    const job = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: withE3.id } })
    const params = job.params as { lab: { explore: { robustness?: unknown } } }
    params.lab.explore.robustness = { jobId: null, bot: 'e2' }
    await test.prisma.simulationJob.update({ where: { id: withE3.id }, data: { params: params as never } })
    expect((await view(withE3.id)).explore.robustness).toMatchObject({ status: 'pending', jobId: null })
    expect(await test.app.get(LabService).sweepRobustness()).toBe(1)
    const swept = (await view(withE3.id)).explore.robustness
    expect(swept).toMatchObject({ bot: 'e2', status: 'queued' })
    expect(await test.app.get(LabService).sweepRobustness()).toBe(0)
    await post(`/api/simulations/${swept.jobId}/cancel`)
    expect((await view(withE3.id)).explore.robustness).toMatchObject({ status: 'cancelled', robustness: null })
  }, 120_000)
  it('fase 42, carreras: after the first half the clearly worse variant stops; the rest play the second half', async () => {
    const config = {
      gamesPerRival: 20,
      variantsPerRound: 3,
      maxRounds: 1,
      patience: 3,
      confirmGames: 0,
      verifyGames: 0,
      pool: 'all',
      byWeight: false,
      confirmBot: null,
      // Off by default until measured (review of #53).
      race: true,
    }
    const created = await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 3, config, seed: 9900 })
    expect(created.status).toBe(200)
    const id = created.body.id as number
    type Round = {
      candidates: number[]
      stage?: number
      dropped?: number[]
      stageIdx?: number
      accepted: number | null
    }
    const read = async () =>
      (
        (await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })).params as {
          lab: { explore: { base: number; rounds: Round[] } }
        }
      ).lab.explore
    const [good, even, bad] = (await read()).rounds[0]?.candidates ?? []
    if (good === undefined || even === undefined || bad === undefined) throw new Error('three variants')
    // The first half: 4 lists × 3 rivals, 10 games each (half of 20).
    const first = await test.prisma.simulationChunk.findMany({ where: { jobId: id }, orderBy: { idx: 'asc' } })
    expect(first).toHaveLength(12)
    expect(first.every((chunk) => chunk.games === 10 && chunk.firstGame === 0)).toBe(true)
    const wins = (a: number, _b: number, games: number) =>
      a === good ? Math.round(games * 0.9) : a === bad ? Math.round(games * 0.1) : Math.round(games / 2)
    expect(await playAll(wins, 12)).toBe(12)
    // The bad one (10 % against 50 %) leaves; the even one and the good one play the second half with the incumbent,
    // from game 10, with seeds of their own (the same for every list against each rival).
    const half = (await read()).rounds[0]
    expect(half).toMatchObject({ stage: 2, dropped: [bad] })
    const second = await test.prisma.simulationChunk.findMany({
      where: { jobId: id, idx: { gte: half?.stageIdx ?? 0 } },
      orderBy: { idx: 'asc' },
    })
    expect(second).toHaveLength(9)
    expect(new Set(second.map((chunk) => chunk.snapshotAId))).toEqual(new Set([(await read()).base, good, even]))
    expect(second.some((chunk) => chunk.snapshotAId === bad)).toBe(false)
    expect(second.every((chunk) => chunk.games === 10 && chunk.firstGame === 10)).toBe(true)
    const seedsOf = (rows: typeof first) => {
      const byRival = new Map<number, Set<string>>()
      for (const chunk of rows) {
        const set = byRival.get(chunk.snapshotBId as number) ?? new Set<string>()
        set.add(chunk.seed.toString())
        byRival.set(chunk.snapshotBId as number, set)
      }
      return byRival
    }
    const firstSeeds = seedsOf(first)
    for (const [rival, seeds] of seedsOf(second)) {
      expect(seeds.size).toBe(1)
      expect(firstSeeds.get(rival)?.has([...seeds][0] ?? '')).toBe(false)
    }
    expect(await playAll(wins)).toBe(9)
    const lab = (await get(`/api/lab/jobs/${id}`)).body
    expect(lab.explore).toMatchObject({ phase: 'done', best: good })
    expect(lab.explore.rounds[0]).toMatchObject({ accepted: good, dropped: [bad] })
    const total = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })
    expect(total.totalGames).toBe(12 * 10 + 9 * 10)
    // The one that left is measured against the incumbent on the first half.
    const left = lab.decks.find((deck: { snapshot: number }) => deck.snapshot === bad)
    expect(left.vsParent.value).toBeCloseTo(-40, 6)
  }, 60_000)

  it('review of #53: «Frenar» in a first half skips the second; an incumbent that missed a pairing keeps everyone', async () => {
    const config = {
      gamesPerRival: 20,
      variantsPerRound: 2,
      maxRounds: 2,
      patience: 3,
      confirmGames: 0,
      verifyGames: 0,
      pool: 'all',
      byWeight: false,
      confirmBot: null,
      race: true,
    }
    type Round = { candidates: number[]; incumbent: number; stage?: number; dropped?: number[]; toIdx: number }
    const read = async (id: number) =>
      (
        (await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })).params as {
          lab: { explore: { rounds: Round[] } }
        }
      ).lab.explore
    const half = (_a: number, _b: number, games: number) => Math.floor(games / 2)

    // «Frenar» while the first half plays: it decides with what it has, no second half.
    const stopped = (await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 3, config, seed: 9910 }))
      .body.id as number
    expect(await playAll(half, 4)).toBe(4)
    expect((await post(`/api/lab/jobs/${stopped}/stop`)).status).toBe(200)
    const cut = (await read(stopped)).rounds[0]
    expect(cut?.stage).toBe(1)
    expect(cut?.dropped).toBeUndefined()
    expect(await test.prisma.simulationChunk.count({ where: { jobId: stopped, idx: { gte: cut?.toIdx ?? 0 } } })).toBe(
      0,
    )
    expect((await get(`/api/lab/jobs/${stopped}`)).body.job.status).toBe('done')

    // The incumbent's first pairing fails in the first half: nobody can be compared with it, so nobody leaves, not even
    // the variant at 10 %.
    const failing = (await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 3, config, seed: 9920 }))
      .body.id as number
    const start = (await read(failing)).rounds[0]
    const [, bad] = start?.candidates ?? []
    for (let attempt = 0; attempt < 3; attempt++) {
      const chunk = (await bearer('post', '/api/worker/claim').send({ ...hello, engineRev: test.env.engineRev })).body
        .chunk as Structured
      const row = await test.prisma.simulationChunk.findUniqueOrThrow({ where: { id: chunk.chunkId as number } })
      expect(row.snapshotAId).toBe(start?.incumbent)
      await bearer('put', `/api/worker/chunks/${row.id}/failure`).send({ workerId: hello.workerId, error: 'panic' })
    }
    expect(await playAll((a, _b, games) => (a === bad ? Math.round(games * 0.1) : Math.floor(games / 2)), 8)).toBe(8)
    const kept = (await read(failing)).rounds[0]
    expect(kept).toMatchObject({ stage: 2, dropped: [] })
    expect(
      await test.prisma.simulationChunk.count({ where: { jobId: failing, idx: { gte: start?.toIdx ?? 0 } } }),
    ).toBe(9)
    await post(`/api/simulations/${failing}/cancel`)
  }, 60_000)

  it('review of #53: with per-game results the two halves pair game by game', async () => {
    const hello25 = { ...hello, workerId: 'worker-lab-race', version: '0.2.5', cliVersion: '0.2.0' }
    await bearer('post', '/api/worker/claim').send({ ...hello25, engineRev: test.env.engineRev })
    const config = {
      gamesPerRival: 20,
      variantsPerRound: 2,
      maxRounds: 1,
      patience: 3,
      confirmGames: 0,
      verifyGames: 0,
      pool: 'all',
      byWeight: false,
      confirmBot: null,
      race: true,
    }
    const created = await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 3, config, seed: 9930 })
    const id = created.body.id as number
    const job = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })
    expect((job.params as { perGame?: boolean }).perGame).toBe(true)
    const [good, bad] =
      (job.params as { lab: { explore: { rounds: { candidates: number[] }[] } } }).lab.explore.rounds[0]?.candidates ??
      []
    // Game i: the good one wins its first 9 of 10, the bad one its first 1, the rest their first 5 (the same games).
    let played = 0
    for (;;) {
      const claim = await bearer('post', '/api/worker/claim').send({ ...hello25, engineRev: test.env.engineRev })
      const chunk = claim.body.chunk as Structured | null
      if (!chunk) break
      const row = await test.prisma.simulationChunk.findUniqueOrThrow({ where: { id: chunk.chunkId as number } })
      const rate = row.snapshotAId === good ? 0.9 : row.snapshotAId === bad ? 0.1 : 0.5
      const winsA = Math.round(row.games * rate)
      const each = (f: (i: number) => string) => Array.from({ length: row.games }, (_, i) => f(i)).join('')
      await bearer('put', `/api/worker/chunks/${row.id}/result`).send({
        workerId: hello25.workerId,
        engineRev: test.env.engineRev,
        winsA,
        winsB: row.games - winsA,
        ties: 0,
        games: row.games,
        durationMs: 100,
        extra: {
          perGame: {
            winners: each((i) => (i < winsA ? 'A' : 'B')),
            starters: each((i) => (i % 2 === 0 ? 'A' : 'B')),
            endings: each(() => 'P'),
            turns: Array.from({ length: row.games }, () => 12),
            stagesA: each(() => '1'),
            stagesB: each(() => '1'),
          },
        },
      })
      played += 1
    }
    // The first half (3 lists × 3 rivals), then the second half of the incumbent and the good one (2 × 3).
    expect(played).toBe(9 + 6)
    const lab = (await get(`/api/lab/jobs/${id}`)).body
    expect(lab.explore.rounds[0]).toMatchObject({ accepted: good, dropped: [bad] })
    const best = lab.decks.find((deck: { snapshot: number }) => deck.snapshot === good)
    const left = lab.decks.find((deck: { snapshot: number }) => deck.snapshot === bad)
    // Both halves together, game by game (20 games each against every rival), and the one out on its first half.
    expect(best.vsParent).toMatchObject({ paired: true, complete: true })
    expect(best.vsParent.value).toBeCloseTo(40, 6)
    expect(left.vsParent).toMatchObject({ paired: true })
    expect(left.vsParent.value).toBeCloseTo(-40, 6)
    // The per-game worker leaves: the next tests' jobs must not ask for per-game results.
    await test.prisma.workerNode.updateMany({ data: { lastSeenAt: new Date(Date.now() - 60 * 60 * 1000) } })
  }, 60_000)

  it('T-017 E3: cards to try come in even without copies; a pasted list can lock cards', async () => {
    const config = {
      gamesPerRival: 10,
      variantsPerRound: 3,
      maxRounds: 1,
      confirmGames: 0,
      verifyGames: 0,
      pool: 'collection',
      byWeight: false,
      confirmBot: null,
    }
    const index = test.app.get(CatalogService).requireIndex()
    // A trainer the meta plays (so the engine does) and the collection has no copy of: «colección» alone never draws it.
    const owned = await test.prisma.collectionStock.findMany({
      where: { amountOwned: { gt: 0 } },
      select: { cardId: true },
    })
    const ownedGroups = new Set(owned.map((row) => index.cardById(row.cardId)?.functionalGroupId))
    const bank = (await get('/api/lab/bank?size=10')).body as { rivals: { cards: { cardId: string }[] }[] }
    const candidates = bank.rivals.flatMap((rival) => rival.cards.map((card) => card.cardId))
    const pick = candidates.find((cardId) => {
      const card = index.cardById(cardId)
      return card?.cardType === 'trainer' && !ownedGroups.has(card.functionalGroupId)
    })
    if (!pick) throw new Error('no unowned trainer in the meta')
    const asked = { id: index.cardById(pick)?.functionalGroupId as string, displayCardId: pick }
    const plan = await post('/api/lab/explore').send({
      deck: { deckId: deckIds[1] },
      size: 3,
      config,
      include: [asked.displayCardId],
      dryRun: true,
    })
    expect(plan.status).toBe(200)
    expect(plan.body.baseCards.length).toBeGreaterThan(0)
    const created = await post('/api/lab/explore').send({
      deck: { deckId: deckIds[1] },
      size: 3,
      config,
      include: [asked.displayCardId],
      seed: 9950,
    })
    expect(created.status).toBe(200)
    const lab = (await get(`/api/lab/jobs/${created.body.id}`)).body
    expect(lab.explore.include.map((card: { cardId: string }) => card.cardId)).toEqual([asked.id])
    // One variant of the first round brings it in.
    const variants = lab.decks.filter((deck: { role: string }) => deck.role === 'variant')
    expect(
      variants.some((deck: { changes: { add: { cardId: string }[] } | null }) =>
        deck.changes?.add.some((card) => index.cardById(card.cardId)?.functionalGroupId === asked.id),
      ),
    ).toBe(true)
    await post(`/api/simulations/${created.body.id}/cancel`)
    // Review of #64: each refusal says why — an unknown card (one the zone cannot pay is no longer refused).
    const refuse = async (cardId: string) =>
      (await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 3, config, include: [cardId] })).body
        .error?.message as string
    expect(await refuse('ZZ-999')).toMatch(/desconocida/)
    // (The test engine plays every card, so «el motor no la juega» has no case here; the code path is the same.)
    const status = await test.app.get(EngineStatusService).status()
    // Deck 2 is Fire: a Fighting Pokémon without an ability that the engine plays cannot attack.
    const fighting = index.catalog.groups.find((group) => {
      const card = index.cardById(group.displayCardId)
      return (
        card?.cardType === 'pokemon' &&
        card.ability === null &&
        card.attacks.length > 0 &&
        card.attacks.every((attack) => attack.cost.includes('fighting')) &&
        engineEdition(card, index, status) !== null
      )
    })
    if (!fighting) throw new Error('no Fighting Pokémon')
    // Santi's ask of 14/10 (Onix in the Mega-Steelix ex deck): it is tried anyway — a wall, a Pokémon to retreat into,
    // a base — and the plan says why it cannot attack instead of refusing it.
    const offType = await post('/api/lab/explore').send({
      deck: { deckId: deckIds[1] },
      size: 3,
      config,
      include: [fighting.displayCardId],
      dryRun: true,
    })
    expect(offType.status).toBe(200)
    expect(offType.body.include).toEqual([
      expect.objectContaining({
        cardId: fighting.id,
        note: expect.stringMatching(/^no puede atacar con las energías de la lista/),
      }),
    ])
    const bringsFighting = (add: { cardId: string }[] | undefined) =>
      (add ?? []).some((card) => index.cardById(card.cardId)?.functionalGroupId === fighting.id)
    // The zone's filter keeps it: the guaranteed variant of the first round brings it in…
    const [tried] = offType.body.firstRound as { add: { cardId: string }[] }[]
    expect(bringsFighting(tried?.add)).toBe(true)
    // …and so does the one of the next round (the filter there starts from the frozen pool).
    const twoRounds = await post('/api/lab/explore').send({
      deck: { deckId: deckIds[1] },
      size: 3,
      config: { ...config, maxRounds: 2 },
      include: [fighting.displayCardId],
      seed: 9955,
    })
    expect(twoRounds.status).toBe(200)
    const offTypeJob = twoRounds.body.id as number
    const firstView = (await get(`/api/lab/jobs/${offTypeJob}`)).body
    expect(firstView.explore.include[0].note).toMatch(/^no puede atacar con las energías de la lista/)
    const firstChunks = await test.prisma.simulationChunk.count({ where: { jobId: offTypeJob } })
    const half = (_a: number, _b: number, games: number) => Math.floor(games / 2)
    expect(await playAll(half, firstChunks)).toBe(firstChunks)
    const secondView = (await get(`/api/lab/jobs/${offTypeJob}`)).body
    const second = (secondView.explore.rounds as { index: number; kind: string; candidates: number[] }[]).find(
      (round) => round.index === 1,
    )
    if (!second) throw new Error('no second round')
    expect(second.kind).toBe('search')
    const secondDecks = (
      secondView.decks as { snapshot: number; changes: { add: { cardId: string }[] } | null; why: unknown[] }[]
    ).filter((deck) => second.candidates.includes(deck.snapshot))
    const again = secondDecks.find((deck) => bringsFighting(deck.changes?.add))
    expect(again).toBeDefined()
    // Deuda 1 of 14/10: no made-up «% de la era» for a card to try (its weight is the most played card's).
    expect(again?.why).toContainEqual(
      expect.objectContaining({ cardId: expect.any(String), asked: true, eraShare: null }),
    )
    await post(`/api/simulations/${offTypeJob}/cancel`)

    // Review of #64: an evolution whose pre-evolution the list lacks brings it along in the guaranteed variant.
    const deckGroups = new Set(
      ((await get(`/api/decks/${deckIds[1]}`)).body.cards as { card: { id: string } }[]).map(
        (entry) => index.cardById(entry.card.id)?.functionalGroupId,
      ),
    )
    const stage1 = index.catalog.groups.find((group) => {
      const card = index.cardById(group.displayCardId)
      if (card?.cardType !== 'pokemon' || !card.evolvesFrom || card.energy !== 'fire') return false
      const pre = index.catalog.groups.find((other) => index.cardById(other.displayCardId)?.nameEn === card.evolvesFrom)
      const preCard = pre ? index.cardById(pre.displayCardId) : undefined
      return (
        !deckGroups.has(group.id) &&
        !!pre &&
        !deckGroups.has(pre.id) &&
        // Review of #64: a pre-evolution the collection does not have comes along too.
        !ownedGroups.has(pre.id) &&
        preCard?.evolvesFrom === null &&
        engineEdition(card, index, status) !== null &&
        !!preCard &&
        engineEdition(preCard, index, status) !== null
      )
    })
    if (!stage1) throw new Error('no Fire Stage 1')
    const evolved = await post('/api/lab/explore').send({
      deck: { deckId: deckIds[1] },
      size: 3,
      config,
      include: [stage1.displayCardId],
      dryRun: true,
    })
    expect(evolved.status).toBe(200)
    const [brought] = evolved.body.firstRound as { add: { cardId: string }[] }[]
    const broughtGroups = (brought?.add ?? []).map((card) => index.cardById(card.cardId)?.functionalGroupId)
    expect(broughtGroups).toContain(stage1.id)
    expect(broughtGroups.length).toBe(2)

    // Review of #107: deck 20 plays two Onix (B1a-38); Onix A1-150 asked for takes the place of one of them (it used
    // to never come in), and both carry their code.
    const steelix = await post('/api/lab/explore').send({
      deck: { deckId: deckIds[19] },
      size: 3,
      config,
      include: ['A1-150'],
      dryRun: true,
    })
    expect(steelix.status).toBe(200)
    expect(steelix.body.include).toEqual([
      expect.objectContaining({
        cardId: 'A1-150',
        nameEs: 'Onix (A1-150)',
        note: expect.stringMatching(/, pero evoluciona en .*Mega-Steelix ex$/),
      }),
    ])
    const [swap] = steelix.body.firstRound as {
      add: { nameEs: string; count: number }[]
      remove: { nameEs: string }[]
    }[]
    expect(swap?.add).toEqual([expect.objectContaining({ nameEs: 'Onix (A1-150)', count: 1 })])
    expect(swap?.remove).toEqual([expect.objectContaining({ nameEs: 'Onix (B1a-38)' })])

    // Self-review of the follow-up: the guaranteed variant never leaves a pre-evolution alone either. Deck 2 with
    // Sinistea and Polteageist (Sinistea only comes along in Fire), asking for a card it lacks, over many seeds.
    const base2 = (await get(`/api/decks/${deckIds[1]}`)).body as {
      energies: string[]
      cards: { card: { id: string; cardType: string }; count: number }[]
    }
    const trainerLines = base2.cards.filter((entry) => entry.card.cardType === 'trainer')
    const [drop1, drop2] = trainerLines
    if (!drop1 || !drop2) throw new Error('deck shape')
    const withLine = [
      ...base2.cards
        .filter((entry) => entry !== drop1 && entry !== drop2)
        .map((entry) => ({ cardId: entry.card.id, count: entry.count })),
      ...(drop1.count > 1 ? [{ cardId: drop1.card.id, count: drop1.count - 1 }] : []),
      ...(drop2.count > 1 ? [{ cardId: drop2.card.id, count: drop2.count - 1 }] : []),
      { cardId: 'B2-74', count: 1 },
      { cardId: 'B2-75', count: 1 },
    ]
    const sinistea = await post('/api/decks').send({ name: 'Con Sinistea', energies: ['fire'], cards: withLine })
    expect(sinistea.status).toBe(201)
    let guaranteedSeen = 0
    for (let seed = 0; seed < 30; seed++) {
      const plan = await post('/api/lab/explore').send({
        deck: { deckId: sinistea.body.id },
        size: 3,
        config: { ...config, variantsPerRound: 1 },
        include: [asked.displayCardId],
        seed: 7_000_000 + seed,
        dryRun: true,
      })
      expect(plan.status).toBe(200)
      const [guaranteed] = plan.body.firstRound as { remove: { cardId: string }[] }[]
      if (!guaranteed) continue
      guaranteedSeen += 1
      const removed = new Set(guaranteed.remove.map((card) => card.cardId))
      expect(removed.has('B2-75') && !removed.has('B2-74')).toBe(false)
    }
    expect(guaranteedSeen).toBeGreaterThan(20)

    // A card the list has one copy of is a card to try too («otro Onix»): the guaranteed variant brings a second one.
    const deckCards = (await get(`/api/decks/${deckIds[1]}`)).body.cards as { card: { id: string }; count: number }[]
    const single = deckCards.find((entry) => {
      const card = index.cardById(entry.card.id)
      if (!card || entry.count !== 1) return false
      const sameName = deckCards.filter((other) => index.cardById(other.card.id)?.nameEn === card.nameEn)
      return sameName.length === 1 && engineEdition(card, index, status) !== null
    })
    if (!single) throw new Error('no card with one copy')
    const singleGroup = index.cardById(single.card.id)?.functionalGroupId as string
    const secondCopy = await post('/api/lab/explore').send({
      deck: { deckId: deckIds[1] },
      size: 3,
      config,
      include: [single.card.id],
      dryRun: true,
    })
    expect(secondCopy.status).toBe(200)
    const [another] = secondCopy.body.firstRound as { add: { cardId: string; count: number }[] }[]
    expect(another?.add).toContainEqual(expect.objectContaining({ count: 1 }))
    expect(another?.add.some((card) => index.cardById(card.cardId)?.functionalGroupId === singleGroup)).toBe(true)

    // A pasted list: the plan gives its cards, and a locked one never goes out.
    const text = readFileSync(DECKS_PATH, 'utf8')
    const section = text.slice(text.indexOf('\n### 2. ') + 1, text.indexOf('\n### 3. '))
    const pastedPlan = await post('/api/lab/explore').send({
      deck: { text: section, energies: ['fire'] },
      size: 3,
      config,
      dryRun: true,
    })
    const [kept] = pastedPlan.body.baseCards as { cardId: string }[]
    if (!kept) throw new Error('no cards')
    const pasted = await post('/api/lab/explore').send({
      deck: { text: section, energies: ['fire'] },
      size: 3,
      config: { ...config, variantsPerRound: 6 },
      locked: [kept.cardId],
      seed: 9960,
    })
    expect(pasted.status).toBe(200)
    const pastedLab = (await get(`/api/lab/jobs/${pasted.body.id}`)).body
    const keptGroup = index.cardById(kept.cardId)?.functionalGroupId
    for (const deck of pastedLab.decks.filter((item: { role: string }) => item.role === 'variant')) {
      for (const card of (deck.changes?.remove ?? []) as { cardId: string }[]) {
        expect(index.cardById(card.cardId)?.functionalGroupId).not.toBe(keptGroup)
      }
    }
    await post(`/api/simulations/${pasted.body.id}/cancel`)
  }, 60_000)

  it("review of #113: a card to try names only evolutions that can come in, with the best list's zone", async () => {
    const config = {
      gamesPerRival: 10,
      variantsPerRound: 3,
      maxRounds: 1,
      confirmGames: 0,
      verifyGames: 0,
      pool: 'collection',
      byWeight: false,
      confirmBot: null,
    }
    const index = test.app.get(CatalogService).requireIndex()
    const megaSteelix = index.cardById('B1a-52')?.functionalGroupId
    if (!megaSteelix) throw new Error('no Mega-Steelix ex')
    // Deck 20 without Mega-Steelix ex (two trainers of one copy go up to two): Onix A1-150 is asked for.
    const steelixDeck = (await get(`/api/decks/${deckIds[19]}`)).body as {
      energies: string[]
      cards: { card: { id: string; cardType: string }; count: number }[]
    }
    let raised = 0
    const cards = steelixDeck.cards
      .filter((entry) => index.cardById(entry.card.id)?.functionalGroupId !== megaSteelix)
      .map((entry) => {
        const up = entry.card.cardType === 'trainer' && entry.count === 1 && raised < 2
        if (up) raised += 1
        return { cardId: entry.card.id, count: up ? 2 : entry.count }
      })
    const created = await post('/api/decks').send({ name: 'Onix sin Mega', energies: steelixDeck.energies, cards })
    expect(created.status).toBe(201)
    const ask = (extra: Record<string, unknown> = {}) =>
      post('/api/lab/explore').send({
        deck: { deckId: created.body.id },
        size: 3,
        config,
        include: ['A1-150'],
        dryRun: true,
        ...extra,
      })
    const noteOf = (body: { include: { note: string | null }[] }) => body.include[0]?.note
    // Metal: Onix (Fighting) cannot attack, but evolves into Mega-Steelix ex.
    const plain = await ask()
    expect(plain.status).toBe(200)
    expect(noteOf(plain.body)).toMatch(/, pero evoluciona en .*Mega-Steelix ex$/)
    // An event that does not allow Mega-Steelix ex: the note does not name it.
    const event = await test
      .http()
      .post('/api/events')
      .set('Cookie', cookie)
      .send({ name: 'Sin Mega-Steelix', rules: { banned: [megaSteelix] } })
    expect(event.status).toBe(201)
    const banned = await ask({ eventId: event.body.id })
    expect(banned.status).toBe(200)
    expect(noteOf(banned.body)).toMatch(/^no puede atacar con las energías de la lista/)
    expect(noteOf(banned.body)).not.toMatch(/Mega-Steelix/)
    // An engine that does not play it: neither (the test engine plays every card, so it is stubbed here).
    const engine = test.app.get(EngineStatusService)
    const real = await engine.status()
    const editions = new Set(index.cardsOfGroup(megaSteelix).map((card) => card.engineId))
    const spy = vi
      .spyOn(engine, 'status')
      .mockResolvedValue(((engineId: string) => (editions.has(engineId) ? false : real(engineId))) as typeof real)
    try {
      const unplayed = await ask()
      expect(unplayed.status).toBe(200)
      expect(noteOf(unplayed.body)).toMatch(/^no puede atacar con las energías de la lista/)
      expect(noteOf(unplayed.body)).not.toMatch(/Mega-Steelix/)
    } finally {
      spy.mockRestore()
    }
    // In a search, the zone of the best list so far: with an incumbent on Fighting, Onix attacks (no note).
    const search = await ask({ dryRun: false, seed: 9113 })
    expect(search.status).toBe(200)
    const id = search.body.id as number
    expect(noteOf((await get(`/api/lab/jobs/${id}`)).body.explore)).toMatch(/Mega-Steelix ex$/)
    const job = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })
    const params = job.params as { sideA: number[]; lab: { explore: { base: number; incumbent: number } } }
    const {
      id: _id,
      createdAt: _at,
      ...base
    } = await test.prisma.deckSnapshot.findUniqueOrThrow({
      where: { id: params.lab.explore.base },
    })
    const fighting = await test.prisma.deckSnapshot.create({
      data: { ...base, energies: ['fighting'], cards: base.cards as never, problems: base.problems as never },
    })
    params.sideA = [...params.sideA, fighting.id]
    params.lab.explore.incumbent = fighting.id
    await test.prisma.simulationJob.update({ where: { id }, data: { params: params as never } })
    expect(noteOf((await get(`/api/lab/jobs/${id}`)).body.explore)).toBeNull()
    await post(`/api/simulations/${id}/cancel`)
  }, 60_000)

  it('T-017 E4: a list added to a search in play plays its next round', async () => {
    const config = {
      gamesPerRival: 10,
      variantsPerRound: 2,
      maxRounds: 2,
      patience: 3,
      confirmGames: 0,
      verifyGames: 0,
      pool: 'all',
      byWeight: false,
      confirmBot: null,
    }
    const created = await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 3, config, seed: 9970 })
    const id = created.body.id as number
    // Another deck of mine, as cards (as «Sumar a la búsqueda» sends the best of a test).
    const other = (await get(`/api/decks/${deckIds[2]}`)).body as {
      name: string
      energies: string[]
      cards: { card: { id: string }; count: number }[]
    }
    const deck = {
      cards: other.cards.map((entry) => ({ cardId: entry.card.id, count: entry.count })),
      energies: other.energies,
      name: other.name,
    }
    const added = await post(`/api/lab/jobs/${id}/candidates`).send({ deck })
    expect(added.status).toBe(200)
    const [handed] = added.body.explore.pending as number[]
    if (handed === undefined) throw new Error('not pending')
    // Twice is refused — also the same list as one of my decks (review of #64: by the list, not the snapshot).
    expect((await post(`/api/lab/jobs/${id}/candidates`).send({ deck })).status).toBe(400)
    expect((await post(`/api/lab/jobs/${id}/candidates`).send({ deck: { deckId: deckIds[2] } })).status).toBe(400)
    // The starting list itself, as cards, is already in.
    const start = (await get(`/api/decks/${deckIds[1]}`)).body as typeof other
    const itself = {
      cards: start.cards.map((entry) => ({ cardId: entry.card.id, count: entry.count })),
      energies: start.energies,
    }
    expect((await post(`/api/lab/jobs/${id}/candidates`).send({ deck: itself })).status).toBe(400)
    // Two at once with the same new list: one gets in.
    const twice = await Promise.all([
      post(`/api/lab/jobs/${id}/candidates`).send({ deck: { deckId: deckIds[4] } }),
      post(`/api/lab/jobs/${id}/candidates`).send({ deck: { deckId: deckIds[4] } }),
    ])
    expect(twice.map((response) => response.status).sort()).toEqual([200, 400])
    // Round 0 (3 lists × 3 rivals); round 1 plays it first, on top of its own variants.
    expect(await playAll((_a, _b, games) => Math.floor(games / 2), 9)).toBe(9)
    const after = (await get(`/api/lab/jobs/${id}`)).body
    expect(after.explore.rounds[1].candidates[0]).toBe(handed)
    expect(after.explore.added).toContain(handed)
    expect(after.explore.pending).toEqual([])
    // Review of #64: a list added by hand is no swap: nothing of it goes into what the combos are built from.
    const state = (await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })).params as {
      lab: { explore: { swaps?: { variant: number }[] } }
    }
    expect((state.lab.explore.swaps ?? []).map((swap) => swap.variant)).not.toContain(handed)
    // The last round is in play: nothing more can join.
    expect((await post(`/api/lab/jobs/${id}/candidates`).send({ deck: { deckId: deckIds[3] } })).status).toBe(400)
    await post(`/api/simulations/${id}/cancel`)
    expect((await post(`/api/lab/jobs/${id}/candidates`).send({ deck: { deckId: deckIds[3] } })).status).toBe(400)
  }, 60_000)

  it('review of #64: a list waiting keeps a search going past its patience; one that cannot play is lost, and said', async () => {
    const config = {
      gamesPerRival: 10,
      variantsPerRound: 1,
      maxRounds: 4,
      patience: 1,
      confirmGames: 0,
      verifyGames: 0,
      pool: 'all',
      byWeight: false,
      confirmBot: null,
    }
    const created = await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 3, config, seed: 9975 })
    const id = created.body.id as number
    const handed = (await post(`/api/lab/jobs/${id}/candidates`).send({ deck: { deckId: deckIds[5] } })).body.explore
      .pending[0] as number
    // Round 0: nothing better, and patience is 1, but a list waits: one more round, with it.
    expect(await playAll((_a, _b, games) => Math.floor(games / 2), 6)).toBe(6)
    const going = (await get(`/api/lab/jobs/${id}`)).body
    expect(going.explore.phase).toBe('search')
    expect(going.explore.rounds[1].candidates).toContain(handed)
    // Another list waits when the search is stopped: it never plays, leaves the job, and the search says so.
    const late = (await post(`/api/lab/jobs/${id}/candidates`).send({ deck: { deckId: deckIds[6] } })).body.explore
      .pending[0] as number
    expect((await post(`/api/lab/jobs/${id}/stop`)).status).toBe(200)
    expect(await playAll((_a, _b, games) => Math.floor(games / 2))).toBeGreaterThanOrEqual(0)
    const ended = (await get(`/api/lab/jobs/${id}`)).body
    expect(ended.explore).toMatchObject({ phase: 'done', pending: [], lost: [late] })
    const job = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })
    expect((job.params as { sideA: number[] }).sideA).not.toContain(late)
  }, 60_000)

  it('review of #64: a list added to a search under an event keeps its rules and the locked cards', async () => {
    const fire = await post('/api/events').send({ name: 'Fuego para sumar', rules: { types: ['fire'] } })
    const config = {
      gamesPerRival: 10,
      variantsPerRound: 1,
      maxRounds: 3,
      confirmGames: 0,
      verifyGames: 0,
      pool: 'all',
    }
    const created = await post('/api/lab/explore').send({
      deck: { deckId: deckIds[1] },
      size: 3,
      config,
      seed: 9985,
      ...(fire.status < 300 ? { eventId: fire.body.id } : {}),
      locked: ['B1-36'],
    })
    expect(created.status).toBe(200)
    const id = created.body.id as number
    // A list without the locked card is refused, with which one.
    const index = test.app.get(CatalogService).requireIndex()
    const start = (await get(`/api/decks/${deckIds[1]}`)).body as {
      energies: string[]
      cards: { card: { id: string }; count: number }[]
    }
    const lockedGroup = index.cardById('B1-36')?.functionalGroupId
    const isLocked = (cardId: string) => index.cardById(cardId)?.functionalGroupId === lockedGroup
    // The locked card out (its copies become X Speed): refused for that, by name.
    const withoutLocked = start.cards.map((entry) => ({
      cardId: isLocked(entry.card.id) ? 'P-A-2' : entry.card.id,
      count: entry.count,
    }))
    const missing = await post(`/api/lab/jobs/${id}/candidates`).send({
      deck: { cards: withoutLocked, energies: start.energies },
    })
    expect(missing.status).toBe(400)
    expect(missing.body.error.message).toMatch(/le faltan cartas que la búsqueda no toca/)
    // The locked card kept, but a Grass Pokémon in a Fire-only event: refused for the event's rules.
    const victim = start.cards.find(
      (entry) => !isLocked(entry.card.id) && index.cardById(entry.card.id)?.cardType === 'trainer',
    )
    if (!victim) throw new Error('no trainer to swap')
    const grassy = start.cards.map((entry) => ({
      cardId: entry.card.id === victim.card.id ? 'A1-1' : entry.card.id,
      count: entry.card.id === victim.card.id ? 1 : entry.count,
    }))
    if (victim.count > 1) grassy.push({ cardId: victim.card.id, count: victim.count - 1 })
    const breaks = await post(`/api/lab/jobs/${id}/candidates`).send({
      deck: { cards: grassy, energies: start.energies },
    })
    expect(breaks.status).toBe(400)
    expect(breaks.body.error.message).toMatch(/no cumple las reglas de «Fuego para sumar»/)
    await post(`/api/simulations/${id}/cancel`)
  }, 60_000)

  it('after the move: two sweeps queue one replay; a replay that cannot be queued is given up after 5 tries', async () => {
    const config = {
      gamesPerRival: 10,
      variantsPerRound: 2,
      maxRounds: 1,
      patience: 3,
      confirmGames: 20,
      verifyGames: 0,
      pool: 'all',
      race: false,
      confirmBot: null,
    }
    const created = await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 3, config, seed: 9980 })
    const id = created.body.id as number
    expect(await playAll((_a, _b, games) => Math.floor(games / 2))).toBeGreaterThan(0)
    const pending = async (patch: (lab: { rivals: { snapshot: number }[] }) => void) => {
      const job = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })
      const params = job.params as { lab: { rivals: { snapshot: number }[]; explore: { robustness?: unknown } } }
      params.lab.explore.robustness = { jobId: null, bot: 'e2' }
      patch(params.lab)
      await test.prisma.simulationJob.update({ where: { id }, data: { params: params as never } })
    }
    const lab = test.app.get(LabService)
    // Two sweeps at once: one replay stays, the other is cancelled.
    await pending(() => undefined)
    await Promise.all([lab.sweepRobustness(), lab.sweepRobustness()])
    const replays = await test.prisma.simulationJob.findMany({ where: { label: `Confirmación con e2 de #${id}` } })
    expect(replays.filter((job) => job.status !== 'cancelled')).toHaveLength(1)
    for (const replay of replays) await post(`/api/simulations/${replay.id}/cancel`)
    // A replay that cannot be queued (a rival snapshot that no longer exists): five tries, then given up.
    await pending((labParams) => {
      for (const rival of labParams.rivals) rival.snapshot = 999_999
    })
    for (let attempt = 0; attempt < 5; attempt++) expect(await lab.sweepRobustness()).toBe(1)
    expect(await lab.sweepRobustness()).toBe(0)
    const job = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })
    expect((job.params as { lab: { explore: { robustness: unknown } } }).lab.explore.robustness).toMatchObject({
      jobId: null,
      attempts: 5,
      failed: true,
    })
  }, 60_000)

  it('T-017 C3: a probe round measures what each card is worth; the weakest third goes out more often', async () => {
    const config = {
      gamesPerRival: 20,
      variantsPerRound: 2,
      maxRounds: 1,
      patience: 3,
      confirmGames: 0,
      verifyGames: 0,
      pool: 'all',
      byWeight: false,
      confirmBot: null,
      probe: true,
    }
    // Review of #78: the plan counts the probe round — its lists and the deck, 10 games against each rival.
    const plan = await post('/api/lab/explore').send({
      deck: { deckId: deckIds[1] },
      size: 3,
      config,
      seed: 9990,
      dryRun: true,
    })
    expect(plan.status).toBe(200)
    const planned = (plan.body.firstRound as unknown[]).length
    expect(plan.body.games.probe).toBe((planned + 1) * 3 * 10)
    expect(plan.body.games.max).toBe(plan.body.games.perRound + plan.body.games.probe)
    expect(plan.body.estimatedSeconds.probe).toBeGreaterThan(0)
    // Review of #78: a probe round under an event that allows no filler is refused, and says why.
    const event = await post('/api/events').send({
      name: 'Sin rellenos',
      rules: { banned: ['P-A-1', 'P-A-2', 'P-A-3', 'P-A-4'] },
    })
    expect(event.status).toBeLessThan(300)
    const refused = await post('/api/lab/explore').send({
      deck: { deckId: deckIds[1] },
      size: 3,
      config,
      eventId: event.body.id,
      dryRun: true,
    })
    expect(refused.status).toBe(400)
    expect(refused.body.error).toMatchObject({ code: 'no_probe' })
    expect(refused.body.error.message).toMatch(/ningún relleno .*el evento no lo permite/)
    // Without the probe, the same event is fine.
    expect(
      (
        await post('/api/lab/explore').send({
          deck: { deckId: deckIds[1] },
          size: 3,
          config: { ...config, probe: false },
          eventId: event.body.id,
          dryRun: true,
        })
      ).status,
    ).toBe(200)

    const created = await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 3, config, seed: 9990 })
    expect(created.status).toBe(200)
    const id = created.body.id as number
    type Round = { candidates: number[]; probe?: boolean; decided: boolean; accepted: number | null }
    const read = async () =>
      (
        (await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })).params as {
          lab: {
            explore: { rounds: Round[]; weakest?: string[]; learned?: Record<string, { sum: number; n: number }> }
          }
        }
      ).lab.explore
    const first = (await read()).rounds[0]
    expect(first?.probe).toBe(true)
    const probes = first?.candidates ?? []
    expect(probes.length).toBeGreaterThan(4)
    expect(probes).toHaveLength(planned)
    // Review of #78: the probes have labels of their own («−1 Torchic»), not the first search round's «v0.<n>».
    const labels = (
      await test.prisma.deckSnapshot.findMany({ where: { id: { in: probes } }, select: { label: true } })
    ).map((row) => row.label)
    for (const label of labels) expect(label).toMatch(/ · −1 \S/)
    expect(new Set(labels).size).toBe(labels.length)
    // Half the games of a search round (10 of 20) for every probe and the deck.
    const chunks = await test.prisma.simulationChunk.findMany({ where: { jobId: id } })
    expect(chunks.every((chunk) => chunk.games === 10)).toBe(true)
    expect(chunks).toHaveLength((probes.length + 1) * 3)
    // The deck without one copy of the first probed card wins 70 %: that card is the most expendable.
    const [expendable] = probes
    expect(
      await playAll(
        (a, _b, games) => (a === expendable ? Math.round(games * 0.7) : Math.floor(games / 2)),
        chunks.length,
      ),
    ).toBe(chunks.length)
    const after = await read()
    expect(after.rounds[0]).toMatchObject({ decided: true, accepted: null })
    // The search round that follows is the first one (the probe is no search round): with maxRounds 1, it is queued.
    expect(after.rounds[1]).toMatchObject({ decided: false })
    expect(after.rounds[1]?.probe).toBeUndefined()
    const searchLabels = (
      await test.prisma.deckSnapshot.findMany({
        where: { id: { in: after.rounds[1]?.candidates ?? [] } },
        select: { label: true },
      })
    ).map((row) => row.label)
    expect(searchLabels.length).toBeGreaterThan(0)
    for (const label of searchLabels) expect(label).toMatch(/ · v0\.\d+$/)
    const lab = (await get(`/api/lab/jobs/${id}`)).body
    expect(lab.explore.rounds[0]).toMatchObject({ probe: true })
    expect(lab.explore.roundsDone).toBe(0)
    const [top] = lab.explore.probe as { cardId: string; value: number }[]
    expect(top?.value).toBeCloseTo(20, 6)
    expect(after.weakest).toContain(top?.cardId)
    expect(lab.explore.weakest.map((card: { cardId: string }) => card.cardId)).toContain(top?.cardId)
    // What it measured feeds what the search learns: taking that card out helped — all of it to «−card», whole (review
    // of #78: it was split with the filler, and «+Lupa» piled up a measure per card).
    expect(after.learned?.[`-${top?.cardId}`]?.sum).toBeCloseTo(20, 6)
    expect(after.learned?.[`-${top?.cardId}`]?.n).toBe(1)
    expect(Object.keys(after.learned ?? {}).filter((key) => key.startsWith('+'))).toEqual([])
    // Review of #78: Claude sees it too — the probe round as such, what each card is worth and what goes out more often.
    const client = new Client({ name: 'e2e', version: '1.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers: { Authorization: `Bearer ${mcpToken}` } } }),
    )
    clients.push(client)
    const results = (await client.callTool({ name: 'lab_results', arguments: { job: id } })) as {
      structuredContent?: Structured
    }
    const search = results.structuredContent?.search as {
      probe: { cards: string[]; outMoreOften: string[] }
      rounds: { kind: string }[]
    }
    expect(search.rounds[0]?.kind).toMatch(/^prueba/)
    expect(search.rounds[1]?.kind).toBe('búsqueda')
    const topName = (lab.explore.probe as { nameEs: string }[])[0]?.nameEs as string
    expect(search.probe.cards[0]).toBe(
      `${topName}, una copia menos: ${(lab.explore.probe as { text: string }[])[0]?.text}`,
    )
    expect(search.probe.cards[0]).toMatch(/una copia menos: \+20,0 puntos/)
    expect(search.probe.outMoreOften).toContain(topName)
    await post(`/api/simulations/${id}/cancel`)
  }, 60_000)

  it('T-017 A3: a list says which of its cards the bots play badly; a variant that brings one in says so', async () => {
    const index = test.app.get(CatalogService).requireIndex()
    // Pokémon Communication swaps a card for a random Pokémon of the deck; deck 2 does not play it. Chosen by id
    // (review of #82: not with the function under test).
    const search = index.cardById('A2-146')
    if (!search) throw new Error('no Pokémon Communication')
    const created = await post('/api/lab/explore').send({
      deck: { deckId: deckIds[1] },
      size: 3,
      config: { gamesPerRival: 10, variantsPerRound: 2, maxRounds: 1, confirmGames: 0, verifyGames: 0, pool: 'all' },
      include: [search.id],
      seed: 9995,
    })
    expect(created.status).toBe(200)
    const lab = (await get(`/api/lab/jobs/${created.body.id}`)).body
    const brought = lab.decks.find((deck: { changes: { add: { cardId: string }[] } | null }) =>
      deck.changes?.add.some((card) => index.cardById(card.cardId)?.functionalGroupId === search.functionalGroupId),
    )
    expect(brought).toMatchObject({ bringsBlindSpot: true })
    expect(
      brought.blindSpots.some((card: { reasons: string[] }) =>
        card.reasons.some((reason) => reason.includes('el orden del mazo')),
      ),
    ).toBe(true)
    const base = lab.decks.find((deck: { role: string }) => deck.role === 'base')
    expect(base.bringsBlindSpot).toBe(false)
    await post(`/api/simulations/${created.body.id}/cancel`)
  }, 60_000)

  it('H-055: «posible punto ciego del bot» in the Laboratorio, «¿Cuál llevo hoy?», the deck and Claude', async () => {
    const client = new Client({ name: 'e2e', version: '1.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers: { Authorization: `Bearer ${mcpToken}` } } }),
    )
    clients.push(client)
    const call = async (name: string, args: Record<string, unknown> = {}) =>
      ((await client.callTool({ name, arguments: args })) as { structuredContent?: Structured }).structuredContent ?? {}
    const patch = (id: string, body: Record<string, unknown>) =>
      test.http().patch(`/api/decks/${id}`).set('Cookie', cookie).send(body)
    // Deck 40 (Mega-Venusaur ex: Ivysaur does no damage) and deck 2, which has no such card; both lose every game.
    const venusaur = deckIds[39] as string
    const plain = deckIds[1] as string
    const jobs: Record<string, number> = {}
    for (const [deckId, seed] of [
      [venusaur, 9300],
      [plain, 9301],
    ] as const) {
      const created = await post('/api/lab/test').send({ decks: [{ deckId }], size: 3, gamesPerRival: 20, seed })
      expect(created.status).toBe(200)
      jobs[deckId] = created.body.id as number
      expect((await patch(deckId, { builtInGame: true })).status).toBe(200)
    }
    expect(await playAll(() => 0)).toBeGreaterThanOrEqual(6)
    // Deck 2 plays the most played archetype of the bank, so it has a tournament number to be far from.
    const top = ((await get(`/api/lab/jobs/${jobs[plain]}`)).body.rivals as { archetypeId: string }[])[0]?.archetypeId
    expect((await patch(plain, { tournamentArchetypeId: top })).status).toBe(200)
    const ivysaur =
      /^Posible punto ciego del bot: e2 casi nunca evoluciona a Ivysaur, que no hace daño, así que el mazo casi no llega a /
    try {
      // The Laboratorio, on the list.
      const venusaurLab = (await get(`/api/lab/jobs/${jobs[venusaur]}`)).body
      expect(venusaurLab.decks[0].botBlindSpot.text).toMatch(ivysaur)
      const far =
        /^Posible punto ciego del bot: 0\u00a0% simulado contra [\d,]+\u00a0% del arquetipo en torneos\. Probalo con f2 o e3\.$/
      // Against the meta, deck 2's score against what its archetype makes in tournaments.
      expect((await get(`/api/lab/jobs/${jobs[plain]}`)).body.decks[0].botBlindSpot?.text).toMatch(far)
      // «¿Cuál llevo hoy?», under the Laboratorio's number.
      type Row = {
        deck: { id: string }
        tournament: { value: number; ci95: [number, number] } | null
        lab: { value: number; ci95: [number, number]; bot: string } | null
        blindSpot: { text: string } | null
      }
      const today = (await get('/api/decks-today')).body as { items: Row[] }
      const rowOf = (id: string) => today.items.find((item) => item.deck.id === id) as Row
      expect(rowOf(venusaur).lab).toMatchObject({ value: 0, bot: 'e2' })
      expect(rowOf(venusaur).blindSpot?.text).toMatch(ivysaur)
      // Deck 2 has no card of the list rules: only the number far from its archetype's in tournaments can say it.
      const plainRow = rowOf(plain)
      expect(plainRow.lab).toMatchObject({ value: 0, bot: 'e2' })
      expect(plainRow.tournament).not.toBeNull()
      expect(plainRow.tournament?.ci95[0]).toBeGreaterThan(15)
      expect(plainRow.blindSpot?.text).toMatch(far)
      // Review of #119: a score against a NOEX bank is not compared with the STANDARD tournament number.
      const plainJob = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: jobs[plain] as number } })
      const params = plainJob.params as { lab: Record<string, unknown> }
      const asFormat = (format: string) =>
        test.prisma.simulationJob.update({
          where: { id: plainJob.id },
          data: { params: { ...params, lab: { ...params.lab, format } } as object },
        })
      await asFormat('NOEX')
      try {
        const noex = ((await get('/api/decks-today')).body as { items: Row[] }).items.find(
          (item) => item.deck.id === plain,
        )
        expect(noex?.lab).toMatchObject({ value: 0 })
        expect(noex?.blindSpot).toBeNull()
      } finally {
        await asFormat(String(params.lab.format))
      }
      // The deck sheet's simulation column: the list rules only (it pools the rivals each simulation chose).
      const columnOf = async (id: string) =>
        ((await get(`/api/decks/${id}/comparison`)).body.columns as { source: string; blindSpot?: unknown }[]).find(
          (column) => column.source === 'simulation',
        )
      expect(((await columnOf(venusaur))?.blindSpot as { text: string } | undefined)?.text).toMatch(ivysaur)
      expect((await columnOf(plain))?.blindSpot).toBeNull()
      // Claude.
      const results = await call('lab_results', { job: jobs[venusaur] })
      expect((results.decks as { botBlindSpot?: string }[])[0]?.botBlindSpot).toMatch(ivysaur)
      const picked = (await call('decks_pick_today', { limit: 40 })).decks as { deck: string; botBlindSpot?: string }[]
      expect(picked.find((row) => row.deck.startsWith(`#${venusaur} `))?.botBlindSpot).toMatch(ivysaur)
      expect(picked.find((row) => row.deck.startsWith(`#${plain} `))?.botBlindSpot).toMatch(/simulado contra/)
    } finally {
      for (const id of [venusaur, plain]) await patch(id, { builtInGame: false, tournamentArchetypeId: null })
    }
  }, 120_000)

  it('T-017 C8: after the probe, every way to fill the two weakest places; the best three are verified together', async () => {
    const config = {
      gamesPerRival: 10,
      variantsPerRound: 2,
      maxRounds: 2,
      patience: 3,
      confirmGames: 0,
      verifyGames: 10,
      pool: 'all',
      byWeight: false,
      confirmBot: null,
      fill: true,
    }
    // The plan: the probe round, then the fill round at most (27 lists and the deck) in the place of one round, and its
    // verification with three lists.
    const plan = await post('/api/lab/explore').send({
      deck: { deckId: deckIds[1] },
      size: 3,
      config,
      seed: 9995,
      dryRun: true,
    })
    expect(plan.status).toBe(200)
    expect(plan.body.config).toMatchObject({ fill: true, probe: true })
    const probing = (plan.body.firstRound as unknown[]).length
    expect(plan.body.games).toMatchObject({ probe: (probing + 1) * 3 * 10, fill: 28 * 3 * 10 })
    expect(plan.body.games.max).toBe((probing + 1) * 3 * 10 + 28 * 3 * 10 + 4 * 3 * 10 + (3 * 3 * 10 + 2 * 3 * 10))

    const created = await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 3, config, seed: 9995 })
    expect(created.status).toBe(200)
    const id = created.body.id as number
    type Round = {
      kind: string
      candidates: number[]
      probe?: boolean
      fill?: string[]
      decided: boolean
      accepted: number | null
      screened?: number | null
    }
    const read = async () =>
      (
        (await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })).params as {
          lab: {
            explore: {
              rounds: Round[]
              weakest?: string[]
              incumbent: number
              base: number
              swaps?: { variant: number; add: string[] }[]
            }
          }
        }
      ).lab.explore
    const probes = (await read()).rounds[0]?.candidates ?? []
    // The probe: without one copy of the first card the deck wins 80 %, of the second 70 %; the rest, as the deck.
    const [p0, p1] = probes as [number, number]
    const probeRate = new Map([
      [p0, 0.8],
      [p1, 0.7],
    ])
    let chunks = (await test.prisma.simulationChunk.findMany({ where: { jobId: id } })).length
    expect(await playAll((a, _b, games) => Math.round(games * (probeRate.get(a) ?? 0.5)), chunks)).toBe(chunks)
    const afterProbe = await read()
    const fillRound = afterProbe.rounds[1] as Round
    // Those two are the weakest, in that order, and the fill round frees their places.
    expect(afterProbe.weakest?.slice(0, 2)).toEqual(fillRound.fill)
    expect(fillRound).toMatchObject({ kind: 'search', decided: false })
    expect(fillRound.fill).toHaveLength(2)
    expect(fillRound.candidates.length).toBeGreaterThan(10)
    expect(fillRound.candidates.length).toBeLessThanOrEqual(27)
    // Every list of the round changes only those places.
    const index = test.app.get(CatalogService).requireIndex()
    const snapshots = await test.prisma.deckSnapshot.findMany({
      where: { id: { in: [afterProbe.base, ...fillRound.candidates] } },
      select: { id: true, cards: true },
    })
    const groupsAt = (sid: number) =>
      ((snapshots.find((row) => row.id === sid)?.cards ?? []) as { cardId: string; count: number }[]).flatMap((entry) =>
        Array.from({ length: entry.count }, () => index.cardById(entry.cardId)?.functionalGroupId ?? entry.cardId),
      )
    const before = groupsAt(afterProbe.base)
    const places = (fillRound.fill ?? []).map((groupId) => before.indexOf(groupId))
    for (const sid of fillRound.candidates) {
      const after = groupsAt(sid)
      for (const [at, groupId] of after.entries()) if (groupId !== before[at]) expect(places).toContain(at)
    }

    // The fill round: three lists win 90 %, 80 % and 70 %; the rest, as the deck. The three go to the verification.
    const [f0, f1, f2] = fillRound.candidates as [number, number, number]
    const fillRate = new Map([
      [f0, 0.9],
      [f1, 0.8],
      [f2, 0.7],
    ])
    chunks = (fillRound.candidates.length + 1) * 3
    expect(await playAll((a, _b, games) => Math.round(games * (fillRate.get(a) ?? 0.5)), chunks)).toBe(chunks)
    const afterFill = await read()
    expect(afterFill.rounds[1]).toMatchObject({ decided: true, accepted: null, screened: f0 })
    expect(afterFill.rounds[2]).toMatchObject({ kind: 'verify', candidates: [f0, f1, f2], decided: false })
    // Review of #84: of the fill round, only the lists that change one place go to the combos (C7).
    const fromFill = (afterFill.swaps ?? []).filter((swap) => fillRound.candidates.includes(swap.variant))
    expect(fromFill.length).toBeGreaterThan(0)
    for (const swap of fromFill) expect(swap.add).toHaveLength(1)

    // On fresh seeds the second one wins every game; the first, as the deck: the second stays.
    const verifyRate = new Map([
      [f0, 0.5],
      [f1, 1],
      [f2, 0.6],
    ])
    expect(await playAll((a, _b, games) => Math.round(games * (verifyRate.get(a) ?? 0.5)), 4 * 3)).toBe(12)
    const afterVerify = await read()
    expect(afterVerify.rounds[2]).toMatchObject({ decided: true, accepted: f1 })
    expect(afterVerify.incumbent).toBe(f1)
    // The next search round is a usual one.
    expect(afterVerify.rounds[3]).toMatchObject({ kind: 'search', decided: false })
    expect(afterVerify.rounds[3]?.fill).toBeUndefined()

    // What the screen and Claude show.
    const lab = (await get(`/api/lab/jobs/${id}`)).body
    expect(lab.explore.rounds[1].fill.map((card: { cardId: string }) => card.cardId)).toEqual(fillRound.fill)
    expect(lab.explore.rounds[2].candidates).toEqual([f0, f1, f2])
    const client = new Client({ name: 'e2e', version: '1.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers: { Authorization: `Bearer ${mcpToken}` } } }),
    )
    clients.push(client)
    const results = (await client.callTool({ name: 'lab_results', arguments: { job: id } })) as {
      structuredContent?: Structured
    }
    const kinds = ((results.structuredContent?.search ?? { rounds: [] }) as { rounds: { kind: string }[] }).rounds.map(
      (round) => round.kind,
    )
    expect(kinds[1]).toMatch(/^búsqueda a fondo \(todas las formas de llenar los lugares de .+ y .+\)$/)
    expect(kinds[2]).toMatch(/^verificación de las 3 mejores/)
    await post(`/api/simulations/${id}/cancel`)
  }, 90_000)

  it('T-017 C8: with one verified, the bar is the usual one; with three, it goes up (Bonferroni)', async () => {
    const config = {
      gamesPerRival: 10,
      variantsPerRound: 2,
      maxRounds: 1,
      patience: 3,
      confirmGames: 0,
      verifyGames: 10,
      pool: 'all',
      byWeight: false,
      confirmBot: null,
      fill: true,
    }
    const created = await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 3, config, seed: 9996 })
    const id = created.body.id as number
    const read = async () =>
      (
        (await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })).params as {
          lab: {
            explore: {
              rounds: { kind: string; candidates: number[]; accepted: number | null; decided: boolean }[]
              incumbent: number
              base: number
            }
          }
        }
      ).lab.explore
    let chunks = (await test.prisma.simulationChunk.findMany({ where: { jobId: id } })).length
    expect(await playAll((_a, _b, games) => Math.floor(games / 2), chunks)).toBe(chunks)
    const fill = (await read()).rounds[1]
    const [f0, f1, f2] = (fill?.candidates ?? []) as [number, number, number]
    const fillRate = new Map([
      [f0, 0.9],
      [f1, 0.9],
      [f2, 0.9],
    ])
    chunks = ((fill?.candidates.length ?? 0) + 1) * 3
    expect(await playAll((a, _b, games) => Math.round(games * (fillRate.get(a) ?? 0.5)), chunks)).toBe(chunks)
    // On fresh seeds the first wins, by rival, what puts it past 1,645 errors of the deck (what one verified needs)
    // but not past 2,128 (three at once); the other two and the deck win half. Found with the bank's own weights.
    const rivals = (
      (await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })).params as {
        lab: { rivals: { snapshot: number; weight: number }[] }
      }
    ).lab.rivals
    const scoreWith = (wins: number[]) =>
      metaScore(
        rivals.map((rival, at) => ({
          weight: rival.weight,
          record: { wins: wins[at] ?? 5, losses: 10 - (wins[at] ?? 5), ties: 0 },
        })),
      )
    const half = scoreWith(rivals.map(() => 5))
    let between: number[] | null = null
    for (let code = 0; code < 6 ** rivals.length && !between; code++) {
      const wins = rivals.map((_rival, at) => 5 + (Math.floor(code / 6 ** at) % 6))
      const score = scoreWith(wins)
      if (!score || !half) continue
      const z = scoreDifference(score, half).value / scoreDifference(score, half).se
      if (z > 1.645 + 0.05 && z < bonferroniZ(1.645, 3) - 0.05) between = wins
    }
    if (!between) throw new Error('no record between the two bars for this bank')
    const winsOf = new Map(rivals.map((rival, at) => [rival.snapshot, between?.[at] ?? 5]))
    expect(await playAll((a, b, games) => (a === f0 ? (winsOf.get(b) ?? games / 2) : Math.floor(games / 2)), 12)).toBe(
      12,
    )
    const after = await read()
    expect(after.rounds[2]).toMatchObject({ kind: 'verify', decided: true, accepted: null })
    expect(after.incumbent).toBe(after.base)
    await post(`/api/simulations/${id}/cancel`)
  }, 90_000)

  it('review of #22: «Frenar» needs a session', async () => {
    expect((await test.http().post('/api/lab/jobs/1/stop')).status).toBe(401)
  })

  it('T-017 C5: after a second accepted change, a variant undoes the first one', async () => {
    const config = {
      gamesPerRival: 10,
      variantsPerRound: 3,
      maxRounds: 4,
      patience: 4,
      confirmGames: 20,
      verifyGames: 0,
      pool: 'all',
      // Fase 42: these predate the games by weight, the replay with e3 and carreras (their own tests below).
      byWeight: false,
      confirmBot: null,
      race: false,
    }
    const created = await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 3, config, seed: 9601 })
    // (9601, not 9600: with the pre-evolutions of weight 0, 9600's first swap is Sinistea and Polteageist at once.)
    const id = created.body.id as number
    type State = {
      rounds: { candidates: number[] }[]
      accepted?: { variant: number }[]
      reverts?: number[]
      combos?: number[]
    }
    const read = async () =>
      ((await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })).params as { lab: { explore: State } }).lab
        .explore
    // Each round's first variant wins (90 % in round 0, all in round 1); it is accepted on the screen (no verification).
    // (Round 1's is its first card swap: since the pre-evolutions with weight 0, Polteageist comes with Sinistea, and
    // round 1 may open with a combo or another Energy Zone for it.)
    const rate = new Map<number, number>()
    const playRound = async (chunks: number) => {
      for (let n = 0; n < chunks; n++) {
        const claim = await bearer('post', '/api/worker/claim').send({ ...hello, engineRev: test.env.engineRev })
        const chunk = claim.body.chunk as Structured
        const row = await test.prisma.simulationChunk.findUniqueOrThrow({ where: { id: chunk.chunkId as number } })
        const winsA = Math.round(row.games * (rate.get(row.snapshotAId as number) ?? 0.5))
        await bearer('put', `/api/worker/chunks/${row.id}/result`).send({
          workerId: hello.workerId,
          engineRev: test.env.engineRev,
          winsA,
          winsB: row.games - winsA,
          ties: 0,
          games: row.games,
          durationMs: 100,
        })
      }
    }
    rate.set((await read()).rounds[0]?.candidates[0] as number, 0.9)
    await playRound(4 * 3)
    const first = await read()
    expect(first.accepted?.map((swap) => swap.variant)).toEqual([first.rounds[0]?.candidates[0]])
    // Round 1 opens with its own variants (nothing to undo yet: the only accepted change was just verified).
    expect(first.reverts ?? []).toEqual([])
    const zones = new Map(
      (
        await test.prisma.deckSnapshot.findMany({
          where: { id: { in: [...(first.rounds[1]?.candidates ?? []), first.rounds[0]?.candidates[0] as number] } },
          select: { id: true, energies: true },
        })
      ).map((row) => [row.id, JSON.stringify(row.energies)]),
    )
    const second = first.rounds[1]?.candidates.find(
      (sid) =>
        !(first.combos ?? []).includes(sid) && zones.get(sid) === zones.get(first.rounds[0]?.candidates[0] as number),
    ) as number
    rate.set(first.rounds[0]?.candidates[0] as number, 0.9)
    rate.set(second, 1)
    await playRound(4 * 3)
    const third = await read()
    expect(third.accepted).toHaveLength(2)
    // Round 2 tries undoing the first accepted change.
    expect(third.reverts).toHaveLength(1)
    expect(third.rounds[2]?.candidates).toContain(third.reverts?.[0])
    // Bots' review, item 7: the undo wins round 2; the change it undid leaves the history, and the undo is not one.
    const undo = third.reverts?.[0] as number
    rate.set(second, 0.5)
    rate.set(undo, 1)
    await playRound(4 * 3)
    const fourth = await read()
    expect(fourth.rounds[2]).toMatchObject({ accepted: undo })
    expect(fourth.accepted?.map((swap) => swap.variant)).toEqual([second])
    await post(`/api/simulations/${id}/cancel`)
  }, 60_000)

  it('Claude: the bank, a pasted idea against the meta, the plan of a search and the results', async () => {
    const client = new Client({ name: 'e2e', version: '1.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers: { Authorization: `Bearer ${mcpToken}` } } }),
    )
    clients.push(client)
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = (await client.callTool({ name, arguments: args })) as {
        structuredContent?: Structured
        isError?: boolean
        content: { text?: string }[]
      }
      if (result.isError) throw new Error(`${name}: ${result.content[0]?.text}`)
      return result.structuredContent ?? {}
    }
    const bank = await call('lab_meta_bank', { size: 3 })
    expect(bank).toMatchObject({ era: 'B4a', lists: 393, against: 'el meta de los torneos' })
    expect(bank.rivals).toHaveLength(3)
    // T-017 D4: one rival, by name as Claude gives it (lower case, no accents needed).
    const [top] = bank.rivals as { archetype: string }[]
    const alone = await call('lab_meta_bank', { objective: 'rival', archetype: top?.archetype.toLowerCase() })
    expect(alone.against).toBe(`solo ${top?.archetype}`)
    expect(new Set((alone.rivals as { archetype: string }[]).map((rival) => rival.archetype))).toEqual(
      new Set([top?.archetype]),
    )

    const text = readFileSync(DECKS_PATH, 'utf8')
    const section = text.slice(text.indexOf('\n### 2. ') + 1, text.indexOf('\n### 3. '))
    const queued = await call('lab_test', { texts: [{ text: section, energies: ['fire'] }], size: 3, games: 50 })
    expect(queued).toMatchObject({ queued: true, pairings: 3, totalGames: 150, workerOnline: true })

    const plan = await call('lab_explore', {
      deck: '2',
      size: 3,
      variants: 2,
      locked: ['Mega-Blaziken ex'],
      dryRun: true,
    })
    expect(plan).toMatchObject({ queued: false, simulable: true, gamesPerRound: 3 * 3 * 60 })
    const firstRound = plan.firstRound as { out: string[] }[]
    expect(firstRound).toHaveLength(2)
    for (const variant of firstRound) for (const line of variant.out) expect(line).not.toMatch(/Mega-Blaziken ex/)

    expect(await playAll((_a, _b, games) => games / 2)).toBe(3)
    const core = await call('lab_build_from_core', { cards: ['Mega-Blaziken ex'], pool: 'all' })
    expect(core).toMatchObject({ era: 'B4a', total: 20, valid: true, pool: 'cualquier carta' })
    expect(core.cards).toContainEqual({ line: expect.stringMatching(/^2 Mega-Blaziken ex /), why: 'núcleo' })

    const list = await call('lab_results')
    expect((list.jobs as { id: number }[]).map((job) => job.id)).toContain(queued.jobId)
    const results = await call('lab_results', { job: queued.jobId })
    expect(results).toMatchObject({ mode: 'prueba contra el meta', era: 'B4a' })
    const [deck] = results.decks as { score: string; novelty: string; perRival: unknown[] }[]
    expect(deck?.score).toMatch(/^50\u00a0% contra el meta \(n = 150, IC\u00a0/)
    expect(deck?.perRival).toHaveLength(3)
    expect(deck?.novelty).toMatch(/^(jugada en torneo|conocida|nueva)/)
    expect(String(results.note)).toMatch(/^Juegan bots/)
  }, 60_000)

  // Last on purpose: once a 0.2.5 worker was seen, every new lab job asks for per-game results.
  it('per-game results (T-017 A2): the paired test decides, and each list says how its games went', async () => {
    // A worker that plays per-game results: 0.2.5 on, with engine-cli 0.2.0 on (the queue checks both).
    const hello25 = { ...hello, workerId: 'worker-lab-25', version: '0.2.5', cliVersion: '0.2.0' }
    // The worker introduces itself first: lab jobs ask for perGame only when one that plays it was seen.
    await bearer('post', '/api/worker/claim').send({ ...hello25, engineRev: test.env.engineRev })
    const config = {
      gamesPerRival: 10,
      variantsPerRound: 2,
      maxRounds: 1,
      patience: 3,
      confirmGames: 20,
      verifyGames: 20,
      pool: 'all',
      // Fase 42: these predate the games by weight, the replay with e3 and carreras (their own tests below).
      byWeight: false,
      confirmBot: null,
      race: false,
    }
    const created = await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 3, config, seed: 9200 })
    expect(created.status).toBe(200)
    const job = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: created.body.id } })
    const params = job.params as {
      perGame?: boolean
      lab: { explore: { base: number; rounds: { candidates: number[] }[] } }
    }
    expect(params.perGame).toBe(true)
    const [winner] = params.lab.explore.rounds[0]?.candidates ?? []
    if (winner === undefined) throw new Error('no variant')
    // Game i of a chunk: the winner wins its first 9 of 10, everything else its first 5 (the same games, so paired).
    let played = 0
    for (;;) {
      const claim = await bearer('post', '/api/worker/claim').send({ ...hello25, engineRev: test.env.engineRev })
      const chunk = claim.body.chunk as Structured | null
      if (!chunk) break
      expect(chunk.perGame).toBe(true)
      const row = await test.prisma.simulationChunk.findUniqueOrThrow({ where: { id: chunk.chunkId as number } })
      const winsA = row.snapshotAId === winner ? Math.round(row.games * 0.9) : row.games / 2
      const each = (f: (i: number) => string) => Array.from({ length: row.games }, (_, i) => f(i)).join('')
      const result = await bearer('put', `/api/worker/chunks/${row.id}/result`).send({
        workerId: hello25.workerId,
        engineRev: test.env.engineRev,
        winsA,
        winsB: row.games - winsA,
        ties: 0,
        games: row.games,
        durationMs: 100,
        extra: {
          perGame: {
            winners: each((i) => (i < winsA ? 'A' : 'B')),
            starters: each((i) => (i % 2 === 0 ? 'A' : 'B')),
            endings: each((i) => (i < winsA || i % 3 !== 0 ? 'P' : 'N')),
            turns: Array.from({ length: row.games }, () => 12),
            stagesA: each(() => '2'),
            stagesB: each(() => '1'),
          },
        },
      })
      expect(result.body).toEqual({ accepted: true })
      played += 1
    }
    // Round 0 (3 lists × 3 rivals), the verification (2 × 3), then the confirmation (2 × 3).
    expect(played).toBe(9 + 6 + 6)
    const lab = (await get(`/api/lab/jobs/${created.body.id}`)).body
    expect(
      lab.explore.rounds.map((round: { kind: string; accepted: number | null }) => [round.kind, round.accepted]),
    ).toEqual([
      ['search', null],
      ['verify', winner],
      ['confirm', null],
    ])
    // Paired: the 4 extra wins of every rival are the same 4 games, so the difference is sharp.
    expect(lab.explore.confirmation).toMatchObject({ verdict: 'better' })
    expect(lab.explore.confirmation.difference.value).toBeCloseTo(40, 8)
    expect(lab.explore.confirmation.difference.se).toBeLessThan(10)
    const best = lab.decks.find((deck: { role: string }) => deck.role === 'best')
    const base = lab.decks.find((deck: { role: string }) => deck.role === 'base')
    // Game by game, the error is smaller than for two independent scores.
    expect(lab.explore.confirmation.difference.se).toBeLessThan(
      Math.hypot(best.confirm.score.se, base.confirm.score.se),
    )
    expect(best.games).toMatchObject({ games: 60, stages: [0, 0, 60] })
    expect(best.games.first.games + best.games.second.games).toBe(60)
    expect(best.games.losses.points + best.games.losses.noPokemon).toBe(6)
    // Review of #7: the rates come with n and interval; the list plays a Stage 2 (Mega-Blaziken ex).
    expect(best.games).toMatchObject({ total: 60, hasStage2: true })
    expect(best.games.firstRate.games + best.games.secondRate.games).toBe(60)
    // Review of #20: against the starting list in its verification, game by game.
    expect(best.vsParent).toMatchObject({ measuredIn: 'verify', paired: true, complete: true })
    expect(best.vsParent.value).toBeCloseTo(40, 8)

    // Review of #7: with no capable worker seen for 30 minutes, the lab jobs still waiting stop asking for perGame.
    const waiting = await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 3, config, seed: 9300 })
    const asked = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: waiting.body.id } })
    expect((asked.params as { perGame?: boolean }).perGame).toBe(true)
    const labService = test.app.get(LabService)
    expect(await labService.sweepPerGame()).toBe(0)
    await test.prisma.workerNode.updateMany({ data: { lastSeenAt: new Date(Date.now() - 60 * 60 * 1000) } })
    expect(await labService.sweepPerGame()).toBeGreaterThanOrEqual(1)
    const swept = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: waiting.body.id } })
    expect((swept.params as { perGame?: boolean }).perGame).toBeUndefined()
    await post(`/api/simulations/${waiting.body.id}/cancel`)
  }, 60_000)
})
