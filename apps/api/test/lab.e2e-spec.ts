import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
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

  /** Plays every chunk handed out until the queue is empty; `wins` decides the result from the snapshots. */
  async function playAll(wins: (a: number, b: number, games: number) => number): Promise<number> {
    let played = 0
    for (;;) {
      const claim = await bearer('post', '/api/worker/claim').send({ ...hello, engineRev: test.env.engineRev })
      const chunk = claim.body.chunk as Structured | null
      if (!chunk) return played
      const row = await test.prisma.simulationChunk.findUniqueOrThrow({ where: { id: chunk.chunkId as number } })
      const winsA = wins(row.snapshotAId as number, row.snapshotBId as number, row.games)
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
      played += 1
    }
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

  it('automatic search: rounds of variants, the winner replaces the incumbent, a confirmation round, the end', async () => {
    const config = { gamesPerRival: 10, variantsPerRound: 3, maxRounds: 2, patience: 2, confirmGames: 20, pool: 'all' }
    const dry = await post('/api/lab/explore').send({ deck: { deckId: deckIds[1] }, size: 5, config, dryRun: true })
    expect(dry.status).toBe(200)
    expect(dry.body.firstRound).toHaveLength(3)
    expect(dry.body.pool).toBeGreaterThan(50)
    expect(dry.body.games).toEqual({ perRound: 4 * 5 * 10, max: 4 * 5 * 10 * 2 + 2 * 5 * 20 })
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
    const state = (job.params as { lab: { explore: { base: number; rounds: { candidates: number[] }[] } } }).lab.explore
    const base = state.base
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

    // Round 0: the second variant wins 9 of 10, everything else half. Round 1: nobody beats it. Then confirm.
    const played = await playAll((a, _b, games) => (a === winner ? Math.round(games * 0.9) : games / 2))
    expect(played).toBe(20 + 20 + 10)

    const lab = (await get(`/api/lab/jobs/${jobId}`)).body
    expect(lab).toMatchObject({ mode: 'explore', job: { status: 'done' } })
    expect(lab.explore).toMatchObject({ phase: 'done', stopReason: 'rounds', base, best: winner, roundsDone: 2 })
    expect(
      lab.explore.rounds.map((round: { kind: string; accepted: number | null }) => [round.kind, round.accepted]),
    ).toEqual([
      ['search', winner],
      ['search', null],
      ['confirm', null],
    ])
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
    const baseRow = lab.decks.find((deck: { role: string }) => deck.role === 'base')
    expect(baseRow.confirm.score.games).toBe(100)
    expect(baseRow.confirm.score.value).toBeCloseTo(50, 8)
    expect(lab.decks.filter((deck: { role: string }) => deck.role === 'variant')).toHaveLength(5)
    const total = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: jobId } })
    expect(total.totalGames).toBe(200 + 200 + 200)
  }, 60_000)

  it('a search that finds nothing better ends without a confirmation; a cancelled one stops queueing', async () => {
    const config = {
      gamesPerRival: 10,
      variantsPerRound: 2,
      maxRounds: 5,
      patience: 1,
      confirmGames: 20,
      pool: 'collection',
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
})
