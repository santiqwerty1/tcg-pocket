import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { poolForZone, type SelectableEnergy, usableWith } from '@tcg/domain'
import { CatalogService } from '../src/catalog/catalog.service.js'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { LabService } from '../src/lab/lab.service.js'
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
    expect(deck.search.text).toMatch(/contra el meta \(n = 500, IC /)
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
      // Fase 42: these predate the games by weight and the replay with e3 (their own tests below).
      byWeight: false,
      confirmBot: null,
    }
    const dry = await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 5, config, dryRun: true })
    expect(dry.status).toBe(200)
    expect(dry.body.firstRound).toHaveLength(3)
    expect(dry.body.pool).toBeGreaterThan(50)
    expect(dry.body.games).toEqual({
      perRound: 4 * 5 * 10,
      max: (4 * 5 * 10 + 2 * 5 * 20) * 2 + 2 * 5 * 20,
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
    expect(poolForZone(thawed, dry.body.base.energies, test.app.get(CatalogService).requireIndex())).toHaveLength(
      dry.body.pool,
    )
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
    expect(lab.explore.confirmation.differenceText).toMatch(/^\+40,0 puntos \(IC \+/u)
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
      // Fase 42: these predate the games by weight and the replay with e3 (their own tests below).
      byWeight: false,
      confirmBot: null,
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
      // Fase 42: these predate the games by weight and the replay with e3 (their own tests below).
      byWeight: false,
      confirmBot: null,
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
      // Fase 42: these predate the games by weight and the replay with e3 (their own tests below).
      byWeight: false,
      confirmBot: null,
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
      // Fase 42: these predate the games by weight and the replay with e3 (their own tests below).
      byWeight: false,
      confirmBot: null,
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
      // Fase 42: these predate the games by weight and the replay with e3 (their own tests below).
      byWeight: false,
      confirmBot: null,
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
      // Fase 42: these predate the games by weight and the replay with e3 (their own tests below).
      byWeight: false,
      confirmBot: null,
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
      // Fase 42: these predate the games by weight and the replay with e3 (their own tests below).
      byWeight: false,
      confirmBot: null,
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
    const created = await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 3, config, seed: 9800 })
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
      // Fase 42: these predate the games by weight and the replay with e3 (their own tests below).
      byWeight: false,
      confirmBot: null,
    }
    const created = await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 3, config, seed: 9600 })
    const id = created.body.id as number
    type State = { rounds: { candidates: number[] }[]; accepted?: { variant: number }[]; reverts?: number[] }
    const read = async () =>
      ((await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })).params as { lab: { explore: State } }).lab
        .explore
    // Each round's first variant wins (90 % in round 0, all in round 1); it is accepted on the screen (no verification).
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
    const second = first.rounds[1]?.candidates.find((sid) => sid !== undefined) as number
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
    expect(bank).toMatchObject({ era: 'B4a', lists: 393 })
    expect(bank.rivals).toHaveLength(3)

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
    expect(deck?.score).toMatch(/^50 % contra el meta \(n = 150, IC /)
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
      // Fase 42: these predate the games by weight and the replay with e3 (their own tests below).
      byWeight: false,
      confirmBot: null,
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
