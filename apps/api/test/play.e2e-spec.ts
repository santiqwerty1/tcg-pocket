import type { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
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

  it('a disconnected worker stops waiting and cannot claim the next game', async () => {
    const games = test.app.get(LiveGamesService)
    const events = (games as unknown as { events: EventEmitter }).events
    const controller = new AbortController()
    const address = test.app.getHttpServer().address() as AddressInfo
    games.longPollMs = 25_000
    let id: number | undefined
    const pending = fetch(`http://127.0.0.1:${address.port}/api/worker/live/claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerId: 'worker-gone-01', engineRev: engineRev() }),
      signal: controller.signal,
    }).catch(() => undefined)
    try {
      await vi.waitFor(() => expect(events.listenerCount('queued')).toBe(1))
      controller.abort()
      await pending
      await vi.waitFor(() => expect(events.listenerCount('queued')).toBe(0))

      const created = await post('/api/play').send({
        human: { deckId: deckIds[1] },
        rival: { deckId: deckIds[12] },
        seed: 77,
      })
      expect(created.status).toBe(201)
      id = created.body.id as number
      expect((await get(`/api/play/${id}`)).body.status).toBe('queued')
      const claim = await worker('post', '/api/worker/live/claim').send({
        workerId: 'worker-next-01',
        engineRev: engineRev(),
      })
      expect(claim.body.game.id).toBe(id)
    } finally {
      controller.abort()
      await pending
      games.longPollMs = 100
      events.emit('queued')
      if (id !== undefined) await post(`/api/play/${id}/abandon`).send({})
    }
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

  it('al instante (Fase 33): each change is pushed to the owner page (server-sent events) until the game is over', async () => {
    const created = await post('/api/play').send({
      human: { deckId: deckIds[1] },
      rival: { deckId: deckIds[12] },
      seed: 88,
    })
    const id = created.body.id as number
    const { port } = test.app.getHttpServer().address() as AddressInfo
    const response = await fetch(`http://127.0.0.1:${port}/api/play/${id}/events`, {
      headers: { Cookie: cookie, Accept: 'text/event-stream' },
    })
    expect(response.headers.get('content-type')).toMatch(/^text\/event-stream/)
    // H-015: a stream is never compressed (the compressor would hold the events back).
    expect(response.headers.get('content-encoding')).toBeNull()
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    /** The next game pushed (pings skipped); fails if it takes more than 2 s (no polling behind it). */
    async function next(): Promise<{ status: string; decision: { ply: number } | null; replay: boolean } | 'end'> {
      const deadline = Date.now() + 2000
      for (;;) {
        const end = buffer.indexOf('\n\n')
        if (end >= 0) {
          const block = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          if (block.split('\n').some((line) => line.startsWith('event:'))) continue
          const data = block
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join('\n')
          if (data) return JSON.parse(data)
          continue
        }
        const read = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('no event in 2 s')), deadline - Date.now()),
          ),
        ])
        if (read.done) return 'end'
        buffer += decoder.decode(read.value, { stream: true })
      }
    }
    expect(await next()).toMatchObject({ status: 'queued' })
    // A worker has it (lease set directly: other tests may have left games in the queue).
    await test.prisma.liveGame.update({
      where: { id },
      data: { status: 'running', workerId: 'worker-sse', leaseUntil: new Date(Date.now() + 60_000) },
    })
    await worker('put', `/api/worker/live/${id}/decision`).send({ ...decision(1), workerId: 'worker-sse' })
    expect(await next()).toMatchObject({ status: 'waiting', decision: { ply: 1 } })
    await post(`/api/play/${id}/choice`).send({ ply: 1, i: 1 })
    expect(await next()).toMatchObject({ status: 'running', decision: null })
    const state = { turn: 3, current_player: 0, points: [3, 0], players: [], stadium: null }
    await worker('put', `/api/worker/live/${id}/end`).send({
      workerId: 'worker-sse',
      winner: 'you',
      turns: 3,
      state,
      log: [],
    })
    expect(await next()).toMatchObject({ status: 'done', replay: false })
    const replay = gzipSync(Buffer.from(JSON.stringify({ version: 1, steps: [], players: [], cards: {} })))
    await worker('put', `/api/worker/live/${id}/replay?workerId=worker-sse`)
      .set('Content-Type', 'application/gzip')
      .send(replay)
    expect(await next()).toMatchObject({ status: 'done', replay: true })
    expect(await next()).toBe('end')
    // Not logged in: no stream.
    expect((await fetch(`http://127.0.0.1:${port}/api/play/${id}/events`)).status).toBe(401)
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
    // H-002: «0.2.10» is newer than «0.2.2» (as text it is older).
    expect((await claim('0.2.10')).body.game).toMatchObject({ id, coach: true, choices: [] })

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

  it('the board (Fase 22): catalog ids and both lists; undo goes back a decision; rematch', async () => {
    const created = await post('/api/play').send({
      human: { deckId: deckIds[1] },
      rival: { deckId: deckIds[12] },
      seed: 515,
      coach: true,
    })
    const id = created.body.id as number
    expect(created.body.undos).toBe(0)
    const engineIds = Object.keys(created.body.names)
    expect(Object.keys(created.body.cardIds).sort()).toEqual([...engineIds].sort())
    expect(created.body.cardIds['B1 036']).toMatch(/^B1-36$|^B1-/)
    const total = (list: { count: number }[]) => list.reduce((sum, card) => sum + card.count, 0)
    expect(total(created.body.decks.human)).toBe(20)
    expect(total(created.body.decks.rival)).toBe(20)
    const batch = await get(`/api/cards/batch?ids=${Object.values(created.body.cardIds).join(',')},ZZ-1`)
    expect(batch.body.items).toHaveLength(new Set(Object.values(created.body.cardIds)).size)
    expect(batch.body.items[0]).toHaveProperty('attacks')
    expect((await get('/api/cards/batch')).status).toBe(400)

    // Nothing to undo yet; while the PC moves, wait.
    expect((await post(`/api/play/${id}/undo`)).status).toBe(409)
    const worker1 = { workerId: 'worker-undo-01', engineRev: engineRev(), version: '0.2.3' }
    expect((await worker('post', '/api/worker/live/claim').send(worker1)).body.game).toMatchObject({ id })
    const coached = (ply: number) => ({
      ...decision(ply),
      workerId: worker1.workerId,
      coach: { scores: [0, -50], best: 0 },
    })
    await worker('put', `/api/worker/live/${id}/decision`).send(coached(1))
    await post(`/api/play/${id}/choice`).send({ ply: 1, i: 1 })
    expect((await post(`/api/play/${id}/undo`)).body.error?.code).toBe('busy')
    await worker('put', `/api/worker/live/${id}/decision`).send(coached(2))
    await post(`/api/play/${id}/choice`).send({ ply: 2, i: 0 })
    await worker('put', `/api/worker/live/${id}/decision`).send(coached(3))
    expect((await get(`/api/play/${id}`)).body.coachReviews).toHaveLength(2)

    // Waiting at decision 3 → back to decision 2: choice 2 and its review go, the game is queued again.
    const pending = worker('post', `/api/worker/live/${id}/choice`).send({ workerId: worker1.workerId, ply: 3 })
    const undone = await post(`/api/play/${id}/undo`)
    expect(undone.status).toBe(200)
    expect(undone.body).toMatchObject({ status: 'queued', choices: 1, undos: 1, decision: null })
    expect(undone.body.coachReviews.map((review: { ply: number }) => review.ply)).toEqual([1])
    expect((await pending).body).toEqual({ choice: null, status: 'restart' })
    expect((await worker('put', `/api/worker/live/${id}/decision`).send(coached(3))).body).toEqual({
      choice: null,
      status: 'restart',
    })
    // Claimed again with the choices kept: the worker rebuilds it up to decision 2.
    expect((await worker('post', '/api/worker/live/claim').send(worker1)).body.game).toMatchObject({
      id,
      choices: [1],
    })
    await worker('put', `/api/worker/live/${id}/decision`).send(coached(2))
    expect((await get(`/api/play/${id}`)).body).toMatchObject({ status: 'waiting', decision: { ply: 2 } })

    // Rematch: same decks, bot and coach; the same seed only when asked.
    const again = await post(`/api/play/${id}/rematch`).send({ sameSeed: true })
    expect(again.status).toBe(201)
    expect(again.body).toMatchObject({ status: 'queued', seed: '515', coach: true, choices: 0 })
    expect(again.body.human.snapshot).toBe(created.body.human.snapshot)
    const fresh = await post(`/api/play/${again.body.id}/rematch`).send({})
    expect(fresh.body.seed).not.toBe('515')
    for (const game of [id, again.body.id, fresh.body.id]) await post(`/api/play/${game}/abandon`)
  })

  it('situaciones para resolver (Fase 24): the costly choices of a finished game with the coach, graded again', async () => {
    const created = await post('/api/play').send({
      human: { deckId: deckIds[1] },
      rival: { deckId: deckIds[12] },
      seed: 31,
      coach: true,
    })
    const id = created.body.id as number
    const state = { turn: 3, current_player: 0, points: [0, 0], winner: null, players: [], stadium: null }
    const step = (turn: number, actor: number, chosen: number, scores: number[] | null) => ({
      ply: 0,
      turn,
      actor,
      state,
      options: (scores ?? [0, 0]).map((_, i) => ({
        text: `Option ${i}`,
        action: i === 0 ? 'EndTurn' : { Attack: { title: 'X' } },
      })),
      chosen,
      note: null,
      scores,
    })
    const replay = {
      version: 1,
      game_id: 'x',
      seed: 31,
      players: [],
      cards: {},
      steps: [
        step(1, 0, 0, [0, 50]), // «Casi igual»: not a situation
        step(1, 1, 0, null),
        step(3, 0, 0, [0, 6000]), // «Error grave»
        step(5, 0, 0, [-2500, 0, 100]), // «Peor» (best is 2)
      ],
      final_state: state,
      outcome: { Win: 1 },
    }
    await test.prisma.liveGame.update({
      where: { id },
      data: {
        status: 'done',
        winner: 'bot',
        turns: 6,
        finishedAt: new Date(),
        replayGz: gzipSync(Buffer.from(JSON.stringify(replay))),
      },
    })

    const list = (await get('/api/puzzles')).body
    const mine = list.items.filter((item: { gameId: number }) => item.gameId === id)
    expect(mine.map((item: { id: string; verdict: string; ply: number }) => [item.id, item.verdict, item.ply])).toEqual(
      [
        [`${id}-2`, 'blunder', 2],
        [`${id}-3`, 'mistake', 3],
      ],
    )
    const puzzle = (await get(`/api/puzzles/${id}-2`)).body
    expect(puzzle).toMatchObject({ gameId: id, ply: 2, turn: 3, attempts: 0, solved: false })
    expect(puzzle.actions).toHaveLength(2)
    expect(JSON.stringify(puzzle)).not.toContain('6000')
    expect(Object.keys(puzzle.cardIds).length).toBeGreaterThan(5)

    const wrong = (await post(`/api/puzzles/${id}-2/answer`).send({ i: 0 })).body
    expect(wrong).toMatchObject({ verdict: 'blunder', solved: false, best: 1, attempts: 1, original: { chosen: 0 } })
    expect(wrong.next).toBe(`${id}-3`)
    const right = (await post(`/api/puzzles/${id}-2/answer`).send({ i: 1 })).body
    expect(right).toMatchObject({ verdict: 'best', solved: true, attempts: 2, scores: [0, 6000] })
    const after = (await get('/api/puzzles')).body
    const order = after.items
      .filter((item: { gameId: number }) => item.gameId === id)
      .map((item: { id: string }) => item.id)
    expect(order).toEqual([`${id}-3`, `${id}-2`]) // the solved one goes last
    expect((await get(`/api/puzzles/${id}-0`)).status).toBe(404)
    expect((await get('/api/puzzles/nope')).status).toBe(400)
    expect((await post(`/api/puzzles/${id}-2/answer`).send({ i: 7 })).status).toBe(400)
  })

  it('Claude analiza una partida (Fase 29): the game told turn by turn with the board and the coach', async () => {
    const created = await post('/api/play').send({
      human: { deckId: deckIds[1] },
      rival: { deckId: deckIds[12] },
      seed: 41,
      coach: true,
    })
    const id = created.body.id as number
    const engineId = created.body.decks.human[0].engineId as string
    const spanish = created.body.names[engineId] as string
    // Still going: no replay, only what the coach said so far.
    const going = (await get(`/api/play/${id}/review`)).body
    expect(going).toMatchObject({ id, review: null, soFar: [], coach: { decisions: 0 } })
    expect(going.note).toMatch(/^La partida no terminó/)
    expect(going.lists.you.join(' ')).toContain(spanish)

    const slot = { card: engineId, hp: 50, max_hp: 70, energy: ['Fire'], tools: [], status: [] }
    const side = { hand: [engineId], hand_count: 1, deck_count: 10, discard: [], in_play: [slot] }
    const state = (turn: number) => ({ turn, current_player: 0, points: [1, 0], players: [side, side], stadium: null })
    const replay = {
      version: 1,
      players: [],
      cards: {},
      steps: [
        {
          turn: 2,
          actor: 0,
          state: state(2),
          options: [
            { text: 'EndTurn', action: 'EndTurn' },
            { text: 'Attack', action: { Attack: { title: 'Peck', fixed_damage: 20 } } },
          ],
          chosen: 0,
          scores: [0, 6000],
        },
        { turn: 3, actor: 1, state: state(3), options: [{ text: 'EndTurn', action: 'EndTurn' }], chosen: 0 },
      ],
      final_state: state(3),
      outcome: { Win: 1 },
    }
    await test.prisma.liveGame.update({
      where: { id },
      data: {
        status: 'done',
        winner: 'bot',
        turns: 3,
        finishedAt: new Date(),
        replayGz: gzipSync(Buffer.from(JSON.stringify(replay))),
      },
    })
    const done = (await get(`/api/play/${id}/review`)).body
    expect(done).toMatchObject({ status: 'terminada', result: 'ganó el bot', soFar: null })
    expect(done.review.turns.map((turn: { turn: number }) => turn.turn)).toEqual([2, 3])
    expect(done.review.turns[0].board).toMatchObject({
      points: 'Vos 1 – Bot 0',
      you: { active: `${spanish} 50/70 PS · 1 Fuego`, hand: spanish },
    })
    expect(done.review.turns[0].actions[0]).toMatchObject({
      ply: 1,
      text: 'Termina el turno',
      coach: { verdict: 'Error grave', gap: 6000, best: 'Ataca con «Peck» (20)' },
    })
    expect(done.review.keyMoments).toHaveLength(1)
    expect(done.note).toContain('10.000 = un punto de premio')
    const full = (await get(`/api/play/${id}/review?detail=full&from=3`)).body
    expect(full.review.turns.map((turn: { turn: number }) => turn.turn)).toEqual([3])
    expect(full.review.omittedTurns).toBe(1)
    expect((await get(`/api/play/${id}/review?detail=nope`)).status).toBe(400)
    expect((await get('/api/play/999999/review')).status).toBe(404)
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

  it('H-013: a game waiting a week for the owner is given up even while the worker keeps renewing its lease', async () => {
    const created = await post('/api/play').send({ human: { deckId: deckIds[1] }, rival: { deckId: deckIds[12] } })
    const id = created.body.id as number
    // A worker holds it, waiting for the owner's move (lease set directly: other games may be queued).
    await test.prisma.liveGame.update({
      where: { id },
      data: { status: 'running', workerId: 'worker-h013', leaseUntil: new Date(Date.now() + 60_000) },
    })
    await worker('put', `/api/worker/live/${id}/decision`).send({ ...decision(1), workerId: 'worker-h013' })
    await test.prisma.$executeRaw`UPDATE live_games SET updated_at = now() - interval '8 days' WHERE id = ${id}`
    // The worker long-polls for the choice: that renews the lease…
    const polled = await worker('post', `/api/worker/live/${id}/choice`).send({ workerId: 'worker-h013', ply: 1 })
    expect(polled.body).toEqual({ choice: null, status: 'waiting' })
    const row = await test.prisma.liveGame.findUniqueOrThrow({ where: { id } })
    expect(row.leaseUntil?.getTime()).toBeGreaterThan(Date.now())
    // …but it is not a move: the week without moves still gives it up.
    expect(row.updatedAt.getTime()).toBeLessThan(Date.now() - 7 * 24 * 60 * 60 * 1000)
    await get('/api/play')
    expect((await get(`/api/play/${id}`)).body).toMatchObject({
      status: 'abandoned',
      error: 'Sin movimientos en una semana.',
    })
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

  // Last on purpose: the game stays leased.
  it('H-018: a game against an f bot goes only to a worker whose engine lists «fairBots»', async () => {
    const created = await post('/api/play').send({
      human: { deckId: deckIds[1] },
      rival: { deckId: deckIds[12] },
      seed: 92,
      bot: 'f2',
    })
    expect(created.body).toMatchObject({ bot: 'f2' })
    const id = created.body.id as number
    const claim = (engineFeatures?: string[]) =>
      worker('post', '/api/worker/live/claim').send({
        workerId: 'worker-fair-01',
        engineRev: engineRev(),
        version: '0.2.6',
        ...(engineFeatures ? { engineFeatures } : {}),
      })
    expect((await claim(['perGame'])).body).toEqual({ game: null })
    expect((await claim()).body).toEqual({ game: null })
    expect((await claim(['perGame', 'fairBots'])).body.game).toMatchObject({ id, bot: 'f2' })
  })
})
