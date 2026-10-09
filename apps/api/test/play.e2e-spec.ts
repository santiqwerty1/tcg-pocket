import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { LiveGamesService } from '../src/play/live-games.service.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/** Fase 8: a game against a bot, relayed by a fake worker through the worker API (no engine). */
const DECKS_PATH = join(REPO_ROOT, 'docs/context/mazos_40_listas.md')

describe('playing against a bot (e2e)', () => {
  let test: TestApp
  let cookie: string
  let workerToken: string
  let deckIds: string[]

  beforeAll(async () => {
    test = await createTestApp()
    test.app.get(LiveGamesService).longPollMs = 100
    await seedOwner(test.app, { totp: false })
    cookie = await login(test, { secret: null })
    const summary = await test.app
      .get(CatalogSyncService)
      .sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    expect(summary.status).toBe('applied')
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
    // Listening: the worker long-polls while the owner answers (two requests at once).
    await test.app.listen(0, '127.0.0.1')
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
  function worker(method: 'post' | 'put', path: string) {
    return test.http()[method](path).set('Authorization', `Bearer ${workerToken}`)
  }
  const engineRev = () => test.env.engineRev
  const decision = (ply: number, log: unknown[] = []) => ({
    workerId: 'worker-live-01',
    ply,
    turn: ply + 1,
    state: { turn: ply + 1, current_player: 0, points: [0, 0], players: [], stadium: null },
    actions: [
      { i: 0, text: 'EndTurn', action: 'EndTurn' },
      { i: 1, text: 'Attack(Blaze Kick)', action: { Attack: { title: 'Blaze Kick' } } },
    ],
    log,
  })

  it('a whole game: the worker claims it, relays each decision, the owner answers, the end and the replay', async () => {
    const created = await post('/api/play').send({
      human: { deckId: deckIds[1] },
      rival: { deckId: deckIds[12] },
      seed: 77,
    })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ status: 'queued', bot: 'e2', seed: '77', choices: 0, decision: null })
    expect(created.body.human.label).toMatch(/Mega-Blaziken/)
    expect(Object.keys(created.body.names).length).toBeGreaterThan(5)
    const id = created.body.id as number

    // A worker with another engine does not get it; the right one does.
    expect(
      (await worker('post', '/api/worker/live/claim').send({ workerId: 'worker-live-01', engineRev: 'a'.repeat(40) }))
        .body,
    ).toEqual({ game: null })
    const claim = await worker('post', '/api/worker/live/claim').send({
      workerId: 'worker-live-01',
      engineRev: engineRev(),
    })
    expect(claim.body.game).toMatchObject({ id, bot: 'e2', seed: '77', choices: [] })
    expect(claim.body.game.deckHuman).toMatch(/^Energy: Fire/)
    expect((await get(`/api/play/${id}`)).body.status).toBe('running')

    // Decision 1: the owner sees it with its options and answers.
    const log = [{ ply: 0, turn: 0, actor: 1, forced: true, text: 'Place', action: 'EndTurn', ctx: {} }]
    expect((await worker('put', `/api/worker/live/${id}/decision`).send(decision(1, log))).body).toEqual({
      choice: null,
      status: 'waiting',
    })
    const waiting = (await get(`/api/play/${id}`)).body
    expect(waiting).toMatchObject({ status: 'waiting', decision: { ply: 1, actions: [{ i: 0 }, { i: 1 }] } })
    expect(waiting.log).toHaveLength(1)
    expect((await post(`/api/play/${id}/choice`).send({ ply: 2, i: 1 })).status).toBe(409)
    expect((await post(`/api/play/${id}/choice`).send({ ply: 1, i: 5 })).status).toBe(400)
    const answered = await post(`/api/play/${id}/choice`).send({ ply: 1, i: 1 })
    expect(answered.body).toMatchObject({ status: 'running', choices: 1, decision: null })
    expect((await post(`/api/play/${id}/choice`).send({ ply: 1, i: 0 })).status).toBe(409)
    expect(
      (await worker('post', `/api/worker/live/${id}/choice`).send({ workerId: 'worker-live-01', ply: 1 })).body,
    ).toEqual({ choice: 1, status: 'running' })

    // Another worker cannot touch it while the lease holds.
    expect(
      (await worker('put', `/api/worker/live/${id}/decision`).send({ ...decision(2), workerId: 'worker-live-99' }))
        .status,
    ).toBe(409)

    // Decision 2, answered while the worker long-polls.
    expect((await worker('put', `/api/worker/live/${id}/decision`).send(decision(2, log))).body.status).toBe('waiting')
    const pending = worker('post', `/api/worker/live/${id}/choice`).send({ workerId: 'worker-live-01', ply: 2 })
    await post(`/api/play/${id}/choice`).send({ ply: 2, i: 0 })
    expect((await pending).body).toEqual({ choice: 0, status: 'running' })

    // The end and the replay.
    const finalState = { turn: 9, current_player: 1, points: [3, 1], players: [], stadium: null }
    expect(
      (
        await worker('put', `/api/worker/live/${id}/end`).send({
          workerId: 'worker-live-01',
          winner: 'you',
          turns: 9,
          state: finalState,
          log,
        })
      ).status,
    ).toBe(200)
    const replay = gzipSync(Buffer.from(JSON.stringify({ version: 1, steps: [], players: [], cards: {} })))
    const upload = await worker('put', `/api/worker/live/${id}/replay?workerId=worker-live-01`)
      .set('Content-Type', 'application/gzip')
      .send(replay)
    expect(upload.status).toBe(200)
    const done = (await get(`/api/play/${id}`)).body
    expect(done).toMatchObject({ status: 'done', winner: 'you', turns: 9, choices: 2, replay: true, decision: null })
    expect((await get(`/api/play/${id}/replay/raw`)).body).toMatchObject({ version: 1 })
    expect((await get('/api/play')).body.items[0]).toMatchObject({ id, status: 'done', winner: 'you' })
  })

  it('modo entrenador (Fase 20): only workers 0.2.2+, scores hidden, the hint, a review of each choice', async () => {
    const created = await post('/api/play').send({
      human: { deckId: deckIds[1] },
      rival: { deckId: deckIds[12] },
      seed: 91,
      coach: true,
    })
    expect(created.body).toMatchObject({ coach: true, coachReviews: [], coachSummary: { decisions: 0 } })
    const id = created.body.id as number
    const claim = (version?: string) =>
      worker('post', '/api/worker/live/claim').send({
        workerId: 'worker-coach-01',
        engineRev: engineRev(),
        ...(version ? { version } : {}),
      })
    expect((await claim('0.2.1')).body).toEqual({ game: null })
    expect((await claim()).body).toEqual({ game: null })
    expect((await claim('0.2.2')).body.game).toMatchObject({ id, coach: true, choices: [] })

    const coached = (ply: number, scores: number[], best: number) => ({
      ...decision(ply),
      workerId: 'worker-coach-01',
      coach: { scores, best },
    })
    await worker('put', `/api/worker/live/${id}/decision`).send(coached(1, [-100, 50], 1))
    const waiting = (await get(`/api/play/${id}`)).body
    expect(waiting.decision).toMatchObject({ ply: 1, hintAvailable: true, hint: null })
    expect(JSON.stringify(waiting.decision)).not.toContain('scores')
    expect((await post(`/api/play/${id}/hint`).send({ ply: 2 })).status).toBe(409)
    expect((await post(`/api/play/${id}/hint`).send({ ply: 1 })).body.decision).toMatchObject({ hint: 1 })
    const first = (await post(`/api/play/${id}/choice`).send({ ply: 1, i: 0 })).body
    expect(first.coachReviews).toEqual([
      {
        ply: 1,
        turn: 2,
        options: 2,
        chosen: 0,
        best: 1,
        chosenText: 'EndTurn',
        bestText: 'Attack(Blaze Kick)',
        gap: 150,
        rank: 2,
        verdict: 'inaccuracy',
        hinted: true,
        chosenAction: 'EndTurn',
        bestAction: { Attack: { title: 'Blaze Kick' } },
        ctx: { in_play: [], stadium: null },
      },
    ])

    await worker('put', `/api/worker/live/${id}/decision`).send(coached(2, [0, -6000], 0))
    const second = (await post(`/api/play/${id}/choice`).send({ ply: 2, i: 1 })).body
    expect(second.coachReviews.map((review: { verdict: string }) => review.verdict)).toEqual(['inaccuracy', 'blunder'])
    expect(second.coachSummary).toMatchObject({
      decisions: 2,
      counts: { best: 0, close: 0, inaccuracy: 1, mistake: 0, blunder: 1 },
      agreement: 0,
      hints: 1,
      worst: [{ ply: 2, verdict: 'blunder', gap: 6000 }],
    })
    await worker('put', `/api/worker/live/${id}/decision`).send({ ...decision(3), workerId: 'worker-coach-01' })
    expect((await post(`/api/play/${id}/hint`).send({ ply: 3 })).status).toBe(409)
    expect((await get('/api/play')).body.items[0]).toMatchObject({ id, coach: true })
    await post(`/api/play/${id}/abandon`)
  })

  it('a worker that went away: the game is claimed again with the choices made so far', async () => {
    const created = await post('/api/play').send({
      human: { deckId: deckIds[1] },
      rival: { deckId: deckIds[12] },
      seed: 78,
    })
    const id = created.body.id as number
    expect(
      (await worker('post', '/api/worker/live/claim').send({ workerId: 'worker-live-01', engineRev: engineRev() })).body
        .game.id,
    ).toBe(id)
    await worker('put', `/api/worker/live/${id}/decision`).send(decision(1))
    await post(`/api/play/${id}/choice`).send({ ply: 1, i: 1 })
    // The lease runs out (the PC went to sleep).
    await test.prisma.liveGame.update({ where: { id }, data: { leaseUntil: new Date(Date.now() - 1000) } })
    const again = await worker('post', '/api/worker/live/claim').send({
      workerId: 'worker-live-02',
      engineRev: engineRev(),
    })
    expect(again.body.game).toMatchObject({ id, choices: [1] })
    // Rebuilding, the first decision comes back with its answer already there.
    expect(
      (await worker('put', `/api/worker/live/${id}/decision`).send({ ...decision(1), workerId: 'worker-live-02' }))
        .body,
    ).toEqual({ choice: 1, status: 'running' })
  })

  it('abandon: the worker is told and stops; a deck that cannot be played is refused', async () => {
    const created = await post('/api/play').send({ human: { deckId: deckIds[1] }, rival: { deckId: deckIds[12] } })
    const id = created.body.id as number
    await worker('post', '/api/worker/live/claim').send({ workerId: 'worker-live-03', engineRev: engineRev() })
    await worker('put', `/api/worker/live/${id}/decision`).send({ ...decision(1), workerId: 'worker-live-03' })
    expect((await post(`/api/play/${id}/abandon`)).body).toMatchObject({ status: 'abandoned', decision: null })
    expect(
      (await worker('post', `/api/worker/live/${id}/choice`).send({ workerId: 'worker-live-03', ply: 1 })).body,
    ).toEqual({ choice: null, status: 'abandoned' })

    const short = await post('/api/decks').send({
      name: 'Corto',
      energies: ['fire'],
      cards: [{ cardId: 'B1-33', count: 2 }],
    })
    const refused = await post('/api/play').send({ human: { deckId: short.body.id }, rival: { deckId: deckIds[12] } })
    expect(refused.status).toBe(400)
    expect(refused.body.error?.message ?? refused.body.message).toMatch(/no se puede jugar/)
    expect(
      (
        await test
          .http()
          .post('/api/worker/live/claim')
          .send({ workerId: 'x'.repeat(10), engineRev: engineRev() })
      ).status,
    ).toBe(401)
  })

  it('consistency: one chunk for workers 0.2.0+, the curves of P(ready by own turn N) and the deck column', async () => {
    const created = await post('/api/simulations/consistency').send({ deckId: deckIds[1], games: 100, seed: 5 })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ kind: 'consistency', players: ['e2', 'et'], progress: { totalGames: 100 } })
    expect(created.body.label).toMatch(/Mega-Blaziken ex/)
    const hello = (version: string) => ({
      workerId: 'worker-cons-01',
      name: 'pc',
      engineRev: engineRev(),
      cores: 8,
      version,
    })
    // A worker that does not know consistency chunks does not get it.
    expect((await worker('post', '/api/worker/claim').send(hello('0.1.0'))).body.chunk).toBeNull()
    const claim = (await worker('post', '/api/worker/claim').send(hello('0.2.0'))).body.chunk
    expect(claim).toMatchObject({ kind: 'consistency', games: 100, deckB: null })
    expect(claim.consistency).toMatchObject({ maxTurn: 8, bot: 'e2' })
    expect(claim.consistency.keyCards.sort()).toEqual(['B1 036', 'B1 284'])
    const histogram = (games: number, never: number) => ({
      games,
      firstOnTurn: [0, 10, games - never - 10, 0, 0, 0, 0, 0],
      never,
    })
    const result = await worker('put', `/api/worker/chunks/${claim.chunkId}/result`).send({
      workerId: 'worker-cons-01',
      engineRev: engineRev(),
      winsA: 96,
      winsB: 4,
      ties: 0,
      games: 100,
      durationMs: 10,
      extra: {
        ready: { first: histogram(50, 2), second: histogram(50, 2) },
        attack: { first: histogram(50, 3), second: histogram(50, 3) },
      },
    })
    expect(result.body).toEqual({ accepted: true })
    const detail = (await get(`/api/simulations/${created.body.id}`)).body
    expect(detail.status).toBe('done')
    expect(detail.consistency).toMatchObject({
      mode: 'goldfish',
      era: null,
      rivals: [],
      keyCards: [
        { nameEs: expect.stringMatching(/Mega-Blaziken/) },
        { nameEs: expect.stringMatching(/Mega-Blaziken/) },
      ],
      maxTurn: 8,
      games: { first: 50, second: 50, all: 100 },
    })
    expect(detail.consistency.ready.all[2]).toMatchObject({ turn: 3, ready: 96, games: 100, value: 96 })
    expect(detail.consistency.ready.first[1]).toMatchObject({ turn: 2, ready: 10, games: 50, value: 20 })
    const column = (await get(`/api/simulations/consistency/deck/${deckIds[1]}`)).body
    expect(column.result.job.id).toBe(created.body.id)
    expect(column.meta).toBeNull()
    expect((await get(`/api/simulations/consistency/deck/${deckIds[2]}`)).body).toEqual({ result: null, meta: null })
    expect((await post('/api/simulations/consistency').send({ deckId: deckIds[1], keyCards: ['A1-1'] })).status).toBe(
      400,
    )
  })
})
