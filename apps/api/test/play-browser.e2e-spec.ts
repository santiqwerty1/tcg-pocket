import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { LiveGamesService } from '../src/play/live-games.service.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/**
 * T-015: a game against the bot run by the owner's open page (the engine in WebAssembly). The page's side is played
 * here through the API, as the PWA does it, without an engine: the server only relays and checks the choices.
 */
const DECKS_PATH = join(REPO_ROOT, 'docs/context/mazos_40_listas.md')

describe('playing against a bot in the browser (e2e)', () => {
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
  function put(path: string) {
    return test.http().put(path).set('Cookie', cookie)
  }
  const engineRev = () => test.env.engineRev
  const otherRev = 'f'.repeat(40)
  const deckId = (index: number) => {
    const id = deckIds[index]
    if (id === undefined) throw new Error(`Missing fixture deck ${index}`)
    return id
  }
  const decision = (choices: number[], log: unknown[] = []) => ({
    choices,
    ply: choices.length + 1,
    turn: choices.length + 1,
    state: { turn: choices.length + 1, current_player: 0, points: [0, 0], players: [], stadium: null },
    actions: [
      { i: 0, text: 'EndTurn', action: 'EndTurn' },
      { i: 1, text: 'Attack(Blaze Kick)', action: { Attack: { title: 'Blaze Kick' } } },
    ],
    log,
  })
  const end = (choices: number[]) => ({
    choices,
    winner: 'you' as const,
    turns: 9,
    state: { turn: 9, current_player: 0, points: [3, 1], players: [], stadium: null },
    log: [{ turn: 9, actor: 0, text: 'Attack', action: 'Attack' }],
  })
  const replay = gzipSync(Buffer.from(JSON.stringify({ version: 1, steps: [], players: [] })))

  async function browserGame(extra: Record<string, unknown> = {}): Promise<number> {
    const created = await post('/api/play').send({
      human: { deckId: deckId(1) },
      rival: { deckId: deckId(12) },
      seed: 77,
      runner: 'browser',
      engineRev: engineRev(),
      ...extra,
    })
    expect(created.status).toBe(201)
    return created.body.id as number
  }

  it('starts only with the server engine and never waits for a worker', async () => {
    const base = { human: { deckId: deckId(1) }, rival: { deckId: deckId(12) }, runner: 'browser' }
    const missing = await post('/api/play').send(base)
    expect(missing.status).toBe(409)
    expect(missing.body.error.code).toBe('engine_mismatch')
    const other = await post('/api/play').send({ ...base, engineRev: otherRev })
    expect(other.status).toBe(409)
    expect(other.body.error.message).toContain('recargá la app')

    const id = await browserGame({ coach: true })
    const view = (await get(`/api/play/${id}`)).body
    expect(view).toMatchObject({ runner: 'browser', status: 'running', coach: true, engineRev: engineRev() })
    expect((await get('/api/play')).body.items.find((item: { id: number }) => item.id === id).runner).toBe('browser')

    // A worker with the same engine does not take it (R-003: the same seed is another game on a PC).
    const claim = await test
      .http()
      .post('/api/worker/live/claim')
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ workerId: 'worker-pc-browser', engineRev: engineRev() })
    expect(claim.status).toBe(200)
    expect(claim.body.game).toBeNull()

    // The page's engine gets the decks and the seed, only with the game's engine.
    expect((await get(`/api/play/${id}/browser?engineRev=${otherRev}`)).status).toBe(409)
    const job = await get(`/api/play/${id}/browser?engineRev=${engineRev()}`)
    expect(job.status).toBe(200)
    expect(job.body).toMatchObject({ id, bot: 'e2', seed: '77', choices: [], coach: true, status: 'running' })
    expect(job.body.deckHuman).toContain('Energy:')
    expect(job.body.deckBot).toContain('Energy:')
    await post(`/api/play/${id}/abandon`).send({})
  })

  it('relays decisions from every open page, rebuilds after an undo and keeps the first replay', async () => {
    const id = await browserGame({ coach: true })
    const first = await put(`/api/play/${id}/browser/decision`).send({
      ...decision([]),
      coach: { scores: [1, 4.5], best: 1 },
    })
    expect(first.body).toEqual({ choice: null, status: 'waiting' })
    // A second page with the game open reaches the same decision: nothing changes.
    expect((await put(`/api/play/${id}/browser/decision`).send(decision([]))).body).toEqual({
      choice: null,
      status: 'waiting',
    })
    const waiting = (await get(`/api/play/${id}`)).body
    expect(waiting.status).toBe('waiting')
    expect(waiting.decision).toMatchObject({ ply: 1, hintAvailable: true, hint: null })
    expect((await post(`/api/play/${id}/hint`).send({ ply: 1 })).body.decision.hint).toBe(1)

    // The page waits for the owner (long-poll) while the owner answers from the board.
    const poll = post(`/api/play/${id}/browser/choice`)
      .send({ choices: [], ply: 1 })
      .then((response) => response)
    const chosen = await post(`/api/play/${id}/choice`).send({ ply: 1, i: 0 })
    expect(chosen.body.status).toBe('running')
    expect(chosen.body.coachReviews).toHaveLength(1)
    expect((await poll).body).toEqual({ choice: 0, status: 'running' })

    await put(`/api/play/${id}/browser/decision`).send(decision([0]))
    // A page behind the owner gets the choice already made instead of asking again.
    expect((await put(`/api/play/${id}/browser/decision`).send(decision([]))).body).toEqual({
      choice: 0,
      status: 'waiting',
    })
    await post(`/api/play/${id}/choice`).send({ ply: 2, i: 1 })
    await put(`/api/play/${id}/browser/decision`).send(decision([0, 1]))

    // Undo: back to the second decision. The game is the page's to rebuild, never a worker's.
    const undone = await post(`/api/play/${id}/undo`).send({})
    expect(undone.body).toMatchObject({ status: 'running', choices: 1, undos: 1 })
    expect(undone.body.coachReviews).toHaveLength(1)
    const stale = await post(`/api/play/${id}/browser/choice`).send({ choices: [0, 1], ply: 3 })
    expect(stale.body).toEqual({ choice: null, status: 'restart' })
    expect((await put(`/api/play/${id}/browser/decision`).send(decision([0, 1]))).body.status).toBe('restart')
    await put(`/api/play/${id}/browser/decision`).send(decision([0]))
    await post(`/api/play/${id}/choice`).send({ ply: 2, i: 0 })

    // The end only with the game's choices; the first replay to arrive stays.
    expect((await put(`/api/play/${id}/browser/end`).send(end([0, 1]))).status).toBe(409)
    expect((await put(`/api/play/${id}/browser/end`).send(end([0, 0]))).body).toEqual({ ok: true, status: 'done' })
    expect((await put(`/api/play/${id}/browser/end`).send(end([0, 0]))).body).toEqual({ ok: true, status: 'done' })
    const wrongReplay = await put(`/api/play/${id}/browser/replay?choices=0.1`)
      .set('Content-Type', 'application/gzip')
      .send(replay)
    expect(wrongReplay.status).toBe(409)
    const job = (await get(`/api/play/${id}/browser?engineRev=${engineRev()}`)).body
    expect(job).toMatchObject({ status: 'done', choices: [0, 0], replayMissing: true })
    const sent = await put(`/api/play/${id}/browser/replay?choices=0.0`)
      .set('Content-Type', 'application/gzip')
      .send(replay)
    expect(sent.status).toBe(200)
    const done = (await get(`/api/play/${id}`)).body
    expect(done).toMatchObject({ status: 'done', winner: 'you', turns: 9, replay: true, runner: 'browser' })
    expect((await get(`/api/play/${id}/replay/raw`)).body).toMatchObject({ version: 1 })
    expect((await get(`/api/play/${id}/browser?engineRev=${engineRev()}`)).body.replayMissing).toBe(false)

    // Undo from the end: playing again, without the old replay.
    const reopened = await post(`/api/play/${id}/undo`).send({})
    expect(reopened.body).toMatchObject({ status: 'running', replay: false, winner: null })
    await post(`/api/play/${id}/abandon`).send({})
  })

  it('a rematch is played in the browser too, and a failure or an abandon stops the page', async () => {
    const id = await browserGame()
    expect((await post(`/api/play/${id}/rematch`).send({})).status).toBe(409)
    const rematch = await post(`/api/play/${id}/rematch`).send({ sameSeed: true, engineRev: engineRev() })
    expect(rematch.status).toBe(201)
    expect(rematch.body).toMatchObject({ runner: 'browser', status: 'running', seed: '77' })

    await put(`/api/play/${id}/browser/decision`).send(decision([]))
    // The owner is thinking: undo is for after the bot moves, not while it is the owner's turn with nothing chosen.
    expect((await post(`/api/play/${id}/undo`).send({})).body.error.code).toBe('nothing_to_undo')
    expect(
      (await put(`/api/play/${id}/browser/failure`).send({ choices: [], error: 'carta sin implementar' })).body,
    ).toEqual({
      ok: true,
    })
    expect((await get(`/api/play/${id}`)).body).toMatchObject({ status: 'failed', error: 'carta sin implementar' })
    expect((await put(`/api/play/${id}/browser/decision`).send(decision([]))).body).toEqual({
      choice: null,
      status: 'failed',
    })

    const next = rematch.body.id as number
    await post(`/api/play/${next}/abandon`).send({})
    expect((await post(`/api/play/${next}/browser/choice`).send({ choices: [], ply: 1 })).body).toEqual({
      choice: null,
      status: 'abandoned',
    })
  })

  it('a worker game is not the browser’s, and a worker game still goes to a worker', async () => {
    const created = await post('/api/play').send({ human: { deckId: deckId(1) }, rival: { deckId: deckId(12) } })
    expect(created.body).toMatchObject({ runner: 'worker', status: 'queued' })
    const id = created.body.id as number
    const job = await get(`/api/play/${id}/browser?engineRev=${engineRev()}`)
    expect(job.status).toBe(409)
    expect(job.body.error.code).toBe('not_browser')
    expect((await put(`/api/play/${id}/browser/decision`).send(decision([]))).status).toBe(409)
    const claim = await test
      .http()
      .post('/api/worker/live/claim')
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ workerId: 'worker-pc-browser', engineRev: engineRev() })
    expect(claim.body.game.id).toBe(id)
    await post(`/api/play/${id}/abandon`).send({})
  })
})
