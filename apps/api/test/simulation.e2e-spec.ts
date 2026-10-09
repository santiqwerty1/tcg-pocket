import type { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { EngineStatusService } from '../src/simulation/snapshots.service.js'
import { type ClaimedChunk, WorkerQueueService } from '../src/simulation/worker-queue.service.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/** docs/PLAN.md §7 Fase 6 (M7): jobs, the worker protocol and results, with a fake worker (no engine). */
const CSV_PATH = join(REPO_ROOT, 'docs/context/tcgcollectiontracterexport-2026-10-06.csv')
const DECKS_PATH = join(REPO_ROOT, 'docs/context/mazos_40_listas.md')

type Structured = Record<string, unknown>

describe('simulation (e2e)', () => {
  let test: TestApp
  let cookie: string
  let workerToken: string
  let mcpToken: string
  let deckIds: string[]
  const worker = (id = 'worker-0001') => ({
    workerId: id,
    name: 'pc-de-prueba',
    engineRev: test.env.engineRev,
    cliVersion: '0.1.0',
    cores: 2,
    version: '0.1.0',
  })

  beforeAll(async () => {
    test = await createTestApp()
    test.app.get(WorkerQueueService).longPollMs = 100
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
    mcpToken = (await post('/api/tokens').send({ name: 'claude', kind: 'mcp', scopes: ['mcp:read'] })).body.token
    await test.app.listen(0, '127.0.0.1')
  })

  afterAll(async () => {
    await test.close()
  })

  function get(path: string) {
    return test.http().get(path).set('Cookie', cookie)
  }
  function post(path: string) {
    return test.http().post(path).set('Cookie', cookie)
  }
  function bearer(method: 'post' | 'put' | 'get', path: string, token = workerToken) {
    return test.http()[method](path).set('Authorization', `Bearer ${token}`)
  }
  const claim = (id?: string) => bearer('post', '/api/worker/claim').send(worker(id))
  const decks = (from: number, to: number) => deckIds.slice(from - 1, to).map((deckId) => ({ deckId }))

  it('a disconnected chunk poll stops waiting and cannot lease the next batch', async () => {
    const queue = test.app.get(WorkerQueueService)
    const events = (queue as unknown as { queued: EventEmitter }).queued
    const controller = new AbortController()
    const { port } = test.app.getHttpServer().address() as AddressInfo
    queue.longPollMs = 25_000
    let id: number | undefined
    const hello = { ...worker('worker-gone-poll'), batch: { maxChunks: 3, maxGames: 300 } }
    const pending = fetch(`http://127.0.0.1:${port}/api/worker/claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(hello),
      signal: controller.signal,
    }).catch(() => undefined)
    try {
      await vi.waitFor(() => expect(events.listenerCount('queued')).toBe(1))
      controller.abort()
      await pending
      await vi.waitFor(() => expect(events.listenerCount('queued')).toBe(0))
      const created = await post('/api/simulations').send({
        kind: 'compare',
        sideA: decks(2, 2),
        sideB: decks(5, 7),
        gamesPerPair: 100,
        players: ['r', 'r'],
      })
      expect(created.status).toBe(201)
      id = created.body.id as number
      expect(await test.prisma.simulationChunk.findMany({ where: { jobId: id } })).toEqual(
        expect.arrayContaining([expect.objectContaining({ status: 'queued', workerId: null })]),
      )
      const next = await queue.claim({ ...hello, workerId: 'worker-next-poll' })
      expect(next.chunks).toHaveLength(3)
      expect(next.chunks?.every((chunk) => chunk.jobId === id)).toBe(true)
    } finally {
      controller.abort()
      await pending
      queue.longPollMs = 100
      queue.notifyQueued()
      if (id !== undefined) {
        await post(`/api/simulations/${id}/cancel`)
        await test.http().delete(`/api/simulations/${id}`).set('Cookie', cookie)
      }
    }
  })

  it.each(['immediate', 'after waiting'])(
    'releases every chunk if the worker disconnects during the %s batch claim',
    async (when) => {
      const queue = test.app.get(WorkerQueueService)
      const events = (queue as unknown as { queued: EventEmitter }).queued
      const controller = new AbortController()
      const hello = { ...worker('worker-gone-batch'), batch: { maxChunks: 3, maxGames: 300 } }
      const internals = queue as unknown as { tryClaim(input: typeof hello): Promise<ClaimedChunk[]> }
      const take = internals.tryClaim.bind(queue)
      const queued = vi.fn()
      let leased: number[] = []
      const spy = vi.spyOn(internals, 'tryClaim').mockImplementation(async (input) => {
        const chunks = await take(input)
        if (chunks.length) {
          leased = chunks.map((chunk) => chunk.chunkId)
          events.once('queued', queued)
          controller.abort()
        }
        return chunks
      })
      let id: number | undefined
      let pending: ReturnType<WorkerQueueService['claim']> | undefined
      const create = async () => {
        const created = await post('/api/simulations').send({
          kind: 'compare',
          sideA: decks(2, 2),
          sideB: decks(5, 7),
          gamesPerPair: 100,
          players: ['r', 'r'],
        })
        expect(created.status).toBe(201)
        id = created.body.id as number
      }
      try {
        queue.longPollMs = 25_000
        if (when === 'immediate') await create()
        pending = queue.claim(hello, controller.signal)
        if (when === 'after waiting') {
          await vi.waitFor(() => expect(events.listenerCount('queued')).toBe(1))
          await create()
        }
        expect(await pending).toMatchObject({ chunk: null, chunks: [] })
        expect(leased).toHaveLength(3)
        expect(queued).toHaveBeenCalledOnce()
        const rows = await test.prisma.simulationChunk.findMany({ where: { jobId: id }, orderBy: { idx: 'asc' } })
        expect(rows.map((row) => row.id)).toEqual(leased)
        for (const row of rows) expect(row).toMatchObject({ status: 'queued', workerId: null, leaseUntil: null })
        spy.mockRestore()
        const next = await queue.claim({ ...hello, workerId: 'worker-next-batch' })
        expect(next.chunks?.map((chunk) => chunk.chunkId)).toEqual(leased)
      } finally {
        controller.abort()
        await pending
        spy.mockRestore()
        events.off('queued', queued)
        queue.longPollMs = 100
        if (id !== undefined) {
          await post(`/api/simulations/${id}/cancel`)
          await test.http().delete(`/api/simulations/${id}`).set('Cookie', cookie)
        }
      }
    },
  )

  it('engine status: the Fase 0 list until a worker reports, then the worker’s', async () => {
    expect((await get('/api/simulations/engine')).body).toMatchObject({
      engineRev: test.env.engineRev,
      source: 'fallback',
      incomplete: 46,
      bots: expect.arrayContaining([{ code: 'e2', label: 'expectiminimax, profundidad 2' }]),
    })
    const uploaded = await bearer('put', '/api/worker/engine-status').send({
      engineRev: test.env.engineRev,
      cards: [
        { id: 'A1 001', name: 'Bulbasaur', status: 'Complete', complete: true },
        { id: 'B4b 198', name: 'Lucky Ice Pop', status: 'MissingTrainer', complete: false },
      ],
    })
    expect(uploaded.body).toEqual({ cards: 2, incomplete: 1 })
    expect((await get('/api/simulations/engine')).body).toMatchObject({
      source: 'worker',
      cards: 2,
      incomplete: 1,
      statusRev: test.env.engineRev,
    })

    // Right after an engine update: the status of the engine a worker used last, until one reports the new one.
    const older = 'a'.repeat(40)
    await test.prisma.engineCard.updateMany({ data: { engineRev: older } })
    await test.prisma.workerNode.create({
      data: { id: 'worker-old-engine', name: 'pc vieja', engineRev: older, cores: 2 },
    })
    test.app.get(EngineStatusService).invalidate()
    expect((await get('/api/simulations/engine')).body).toMatchObject({
      source: 'previous',
      statusRev: older,
      incomplete: 1,
    })
    await test.prisma.workerNode.delete({ where: { id: 'worker-old-engine' } })
    // Back to the fallback list for the rest of the tests (a 2-card table would make every deck «no simulable»).
    await test.prisma.engineCard.deleteMany()
    test.app.get(WorkerQueueService)
    await bearer('put', '/api/worker/engine-status').send({ engineRev: 'f'.repeat(40), cards: [] })
  })

  it('preview: 5 decks against themselves are 10 pairings; a deck of 19 cards is «no simulable», naming why', async () => {
    const preview = await post('/api/simulations/preview').send({
      kind: 'matrix',
      sideA: decks(1, 5),
      sideB: decks(1, 5),
      gamesPerPair: 50,
      players: ['e2', 'e2'],
    })
    expect(preview.status).toBe(200)
    expect(preview.body).toMatchObject({ pairings: 10, totalGames: 500, engineRev: test.env.engineRev })
    expect(preview.body.sideA.every((s: { simulable: boolean }) => s.simulable)).toBe(true)
    // «Contra (opcional)» left empty: the same 10 pairings (reported on 8/10: it asked for a rival).
    const alone = await post('/api/simulations/preview').send({
      kind: 'matrix',
      sideA: decks(1, 5),
      gamesPerPair: 50,
      players: ['e2', 'e2'],
    })
    expect(alone.status).toBe(200)
    expect(alone.body).toMatchObject({ pairings: 10, totalGames: 500 })
    const compareAlone = await post('/api/simulations/preview').send({
      kind: 'compare',
      sideA: decks(1, 5),
      gamesPerPair: 50,
      players: ['e2', 'e2'],
    })
    expect(compareAlone.status).toBe(400)
    // 40 decks and 60 tournament lists on one side fit (reported on 8/10: 60 was the limit); 151 do not, said plainly.
    const hundred = await post('/api/simulations/preview').send({
      kind: 'matrix',
      sideA: Array.from({ length: 100 }, (_, i) => decks((i % 40) + 1, (i % 40) + 1)[0]),
      gamesPerPair: 10,
      players: ['r', 'r'],
    })
    expect(hundred.status).toBe(200)
    const tooMany = await post('/api/simulations/preview').send({
      kind: 'matrix',
      sideA: Array.from({ length: 151 }, () => decks(1, 1)[0]),
      gamesPerPair: 10,
      players: ['r', 'r'],
    })
    expect(tooMany.status).toBe(400)
    expect(tooMany.body.error.message).toBe('Hasta 150 mazos por lado.')
    expect(preview.body.sideA[0].deckgymText).toMatch(/^Energy: /)

    const short = await post('/api/decks').send({
      name: 'Corto',
      energies: ['fire'],
      cards: [{ cardId: 'A1-33', count: 2 }],
    })
    const refused = await post('/api/simulations').send({
      kind: 'matrix',
      sideA: [{ deckId: short.body.id }, ...decks(1, 1)],
      sideB: decks(2, 3),
      gamesPerPair: 10,
      players: ['r', 'r'],
    })
    expect(refused.status).toBe(422)
    expect(refused.body.error.code).toBe('not_simulable')
    expect(refused.body.error.message).toContain('tiene 2 cartas')
    expect(
      (
        await post('/api/simulations').send({
          kind: 'matrix',
          sideA: decks(1, 1),
          sideB: [],
          gamesPerPair: 10,
          players: ['r', 'r'],
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await post('/api/simulations').send({
          kind: 'matrix',
          sideA: decks(1, 1),
          sideB: decks(2, 2),
          gamesPerPair: 10,
          players: ['h', 'r'],
        })
      ).status,
    ).toBe(400)
  })

  it('worker protocol: claim, heartbeat, idempotent result, lease expiry, failures, replays; the job ends', async () => {
    const created = await post('/api/simulations').send({
      kind: 'matrix',
      label: 'Prueba',
      sideA: decks(1, 3),
      sideB: decks(1, 3),
      gamesPerPair: 40,
      players: ['e2', 'e2'],
      seed: 1000,
      replaySample: 1,
    })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      status: 'queued',
      baseSeed: '1000',
      progress: { totalGames: 120, gamesDone: 0 },
    })
    const jobId = created.body.id as number

    expect((await test.http().post('/api/worker/claim').send(worker())).status).toBe(401)
    expect((await bearer('post', '/api/worker/claim', mcpToken).send(worker())).status).toBe(403)
    const other = await bearer('post', '/api/worker/claim').send({ ...worker(), engineRev: 'a'.repeat(40) })
    expect(other.body).toMatchObject({ chunk: null, requiredEngineRev: test.env.engineRev, retryAfterSeconds: 300 })

    const first = (await claim()).body.chunk as Structured
    expect(first).toMatchObject({ jobId, idx: 0, games: 40, seed: '1000', players: ['e2', 'e2'], replaySample: 1 })
    expect(String(first.deckA)).toMatch(/^Energy: /)
    const beat = await bearer('put', `/api/worker/chunks/${first.chunkId}/heartbeat`).send({
      workerId: 'worker-0001',
      gamesDone: 12,
    })
    expect(beat.body).toMatchObject({ cancelled: false, lost: false })
    expect((await get(`/api/simulations/${jobId}`)).body).toMatchObject({
      status: 'running',
      progress: { gamesDone: 12 },
    })
    // H-014: another worker's heartbeat or failure does not touch it; the owner's lease is kept.
    const intruder = await bearer('put', `/api/worker/chunks/${first.chunkId}/heartbeat`).send({
      workerId: 'worker-0099',
      gamesDone: 1,
    })
    expect(intruder.body).toEqual({ leaseUntil: null, cancelled: false, lost: true })
    expect(
      (
        await bearer('put', `/api/worker/chunks/${first.chunkId}/failure`).send({
          workerId: 'worker-0099',
          error: 'tarde',
        })
      ).body,
    ).toEqual({ status: 'leased' })
    expect(await test.prisma.simulationChunk.findUnique({ where: { id: Number(first.chunkId) } })).toMatchObject({
      status: 'leased',
      workerId: 'worker-0001',
      gamesDone: 12,
      attempt: 0,
    })

    const result = {
      workerId: 'worker-0001',
      engineRev: test.env.engineRev,
      winsA: 25,
      winsB: 13,
      ties: 2,
      games: 40,
      turns: 400,
      durationMs: 3000,
    }
    expect((await bearer('put', `/api/worker/chunks/${first.chunkId}/result`).send(result)).body).toEqual({
      accepted: true,
    })
    expect((await bearer('put', `/api/worker/chunks/${first.chunkId}/result`).send(result)).body).toEqual({
      accepted: false,
    })
    expect(
      (await bearer('put', `/api/worker/chunks/${first.chunkId}/result`).send({ ...result, winsA: 1 })).status,
    ).toBe(200)

    const replay = { version: 1, steps: [], outcome: { Win: 0 } }
    const upload = await bearer(
      'put',
      `/api/worker/chunks/${first.chunkId}/replays/00000000-0000-03e8-0000-000000000000`,
    )
      .query({ index: 0, seed: '123456789012345678', winner: 'a' })
      .set('Content-Type', 'application/gzip')
      .send(gzipSync(JSON.stringify(replay)))
    expect(upload.status).toBe(200)
    expect(
      (
        await bearer('put', `/api/worker/chunks/${first.chunkId}/replays/00000000-0000-03e8-0000-000000000001`)
          .query({ index: 1, seed: '1', winner: 'a' })
          .set('Content-Type', 'application/gzip')
          .send(Buffer.from('nope'))
      ).status,
    ).toBe(400)
    expect((await get(`/api/simulations/replays/${upload.body.id}`)).body).toMatchObject({
      replay,
      names: {},
      game: {
        gameIndex: 0,
        seed: '123456789012345678',
        winner: 'a',
        playersEs: [expect.any(String), expect.any(String)],
      },
    })
    // The same replay as the engine wrote it, for deckgym's viewer (D-014).
    expect((await get(`/api/simulations/replays/${upload.body.id}/raw`)).body).toEqual(replay)

    // A lease that expires (PC turned off) goes back to the queue: another claim gets the same chunk.
    const second = (await claim()).body.chunk as Structured
    await test.prisma.simulationChunk.update({
      where: { id: second.chunkId as number },
      data: { leaseUntil: new Date(Date.now() - 1000) },
    })
    const again = (await claim('worker-0002')).body.chunk as Structured
    expect(again.chunkId).toBe(second.chunkId)
    expect(
      (
        await bearer('put', `/api/worker/chunks/${again.chunkId}/result`).send({
          ...result,
          workerId: 'worker-0002',
          winsA: 10,
          winsB: 28,
          ties: 2,
        })
      ).body,
    ).toEqual({ accepted: true })

    // Three engine failures fail the chunk; the job keeps its other results.
    let failed: Structured = {}
    for (let attempt = 0; attempt < 3; attempt++) {
      const chunk = (await claim()).body.chunk as Structured
      failed = (
        await bearer('put', `/api/worker/chunks/${chunk.chunkId}/failure`).send({
          workerId: 'worker-0001',
          error: 'panic',
        })
      ).body
    }
    expect(failed).toEqual({ status: 'failed' })
    const left = await claim()
    expect(left.body.chunk).toBeNull()

    const detail = (await get(`/api/simulations/${jobId}`)).body
    expect(detail).toMatchObject({ status: 'failed', progress: { chunks: { total: 3, done: 2, failed: 1 } } })
    expect(detail.error).toContain('1 cruces fallaron')
    const [a, b, c] = detail.sideA as number[]
    const rowA = (
      detail.rows as {
        snapshot: number
        total: Structured
        cells: { rival: number; record: Structured | null; rate: Structured | null }[]
      }[]
    ).find((row) => row.snapshot === a)
    expect(rowA?.total).toEqual({ wins: 35, losses: 41, ties: 4 })
    expect(rowA?.cells.find((cell) => cell.rival === b)?.record).toEqual({ wins: 25, losses: 13, ties: 2 })
    expect(rowA?.cells.find((cell) => cell.rival === b)?.rate).toMatchObject({
      source: 'simulation',
      games: 40,
      orientative: false,
    })
    void c
    expect(detail.replays).toEqual([expect.objectContaining({ gameIndex: 0, winner: 'a', seed: '123456789012345678' })])

    // The deck comparison shows the simulated record of the first deck's current list.
    const comparison = (await get(`/api/decks/${deckIds[0]}/comparison`)).body.columns as {
      source: string
      available: boolean
      record: Structured
      note: string
    }[]
    const simulation = comparison.find((column) => column.source === 'simulation')
    expect(simulation).toMatchObject({ available: true, record: { wins: 35, losses: 41, ties: 4 } })
    expect(simulation?.note).toContain('expectiminimax, profundidad 2')
  })

  it('cancel stops the job: the worker is told on its next heartbeat and nothing else is handed out', async () => {
    const created = await post('/api/simulations').send({
      kind: 'compare',
      sideA: decks(2, 2),
      sideB: decks(5, 7),
      gamesPerPair: 1500,
      players: ['r', 'r'],
    })
    expect(created.body.progress).toMatchObject({ totalGames: 4500, chunks: { total: 6 } })
    const chunk = (await claim()).body.chunk as Structured
    expect(chunk).toMatchObject({ games: 1000, firstGame: 0 })
    const cancelled = await post(`/api/simulations/${created.body.id}/cancel`)
    expect(cancelled.body.status).toBe('cancelled')
    expect(
      (
        await bearer('put', `/api/worker/chunks/${chunk.chunkId}/heartbeat`).send({
          workerId: 'worker-0001',
          gamesDone: 5,
        })
      ).body,
    ).toEqual({
      leaseUntil: null,
      cancelled: true,
      lost: false,
    })
    expect((await claim()).body.chunk).toBeNull()
    expect((await test.http().delete(`/api/simulations/${created.body.id}`).set('Cookie', cookie)).status).toBe(204)
    expect((await get(`/api/simulations/${created.body.id}`)).status).toBe(404)
  })

  it('optimize: one chunk with the engine job (deck minus the cards taken out, candidates, rivals)', async () => {
    const deck = (await get(`/api/decks/${deckIds[1]}`)).body as { cards: { card: { id: string }; count: number }[] }
    const out = deck.cards.filter((entry) => entry.count === 1).slice(0, 1)
    const created = await post('/api/simulations').send({
      kind: 'optimize',
      sideA: [{ deckId: deckIds[1] }],
      sideB: decks(5, 6),
      gamesPerPair: 20,
      players: ['e2', 'e2'],
      optimize: {
        remove: out.map((entry) => ({ cardId: entry.card.id, count: 1 })),
        candidates: ['A1-219', 'P-A-5', 'A2-150'],
      },
    })
    expect(created.status).toBe(201)
    const chunk = (await claim()).body.chunk as { optimize: Structured; deckA: string; kind: string }
    expect(chunk.kind).toBe('optimize')
    expect(chunk.optimize).toMatchObject({ missing: 1, candidates: ['A1 219', 'P-A 005', 'A2 150'], gamesPerEnemy: 20 })
    expect((chunk.optimize.enemies as string[]).length).toBe(2)
    expect(
      String(chunk.optimize.deck)
        .split('\n')
        .filter((line) => /^\d/.test(line))
        .reduce((sum, line) => sum + Number(line.split(' ')[0]), 0),
    ).toBe(19)
  })

  it('queue: the job with the fewest chunks left goes first, then the oldest', async () => {
    const long = await post('/api/simulations').send({
      kind: 'compare',
      sideA: decks(2, 2),
      sideB: decks(5, 7),
      gamesPerPair: 100,
      players: ['r', 'r'],
    })
    const quick = await post('/api/simulations').send({
      kind: 'compare',
      sideA: decks(3, 3),
      sideB: decks(5, 5),
      gamesPerPair: 100,
      players: ['r', 'r'],
    })
    expect(long.body.progress.chunks.total).toBe(3)
    expect(quick.body.progress.chunks.total).toBe(1)
    expect((await claim('worker-0002')).body.chunk).toMatchObject({ jobId: quick.body.id })
    expect((await claim('worker-0003')).body.chunk).toMatchObject({ jobId: long.body.id, idx: 0 })
    for (const id of [long.body.id, quick.body.id]) {
      await post(`/api/simulations/${id}/cancel`)
      expect((await test.http().delete(`/api/simulations/${id}`).set('Cookie', cookie)).status).toBe(204)
    }
  })

  it('H-010: perGame goes to workers from 0.2.5 on with an engine from 0.2.0 on; a result that does not add up fails the chunk', async () => {
    const created = await post('/api/simulations').send({
      kind: 'compare',
      sideA: decks(3, 3),
      sideB: decks(5, 5),
      gamesPerPair: 4,
      players: ['r', 'r'],
      seed: 77,
      perGame: true,
    })
    expect(created.status).toBe(201)
    // A common job behind it in the queue (more chunks): workers that cannot play perGame get this one.
    const plain = await post('/api/simulations').send({
      kind: 'compare',
      sideA: decks(3, 3),
      sideB: decks(5, 6),
      gamesPerPair: 4,
      players: ['r', 'r'],
    })
    const job = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: created.body.id } })
    expect(job.params).toMatchObject({ perGame: true })
    const hello = (id: string, version: string, cliVersion: string) =>
      bearer('post', '/api/worker/claim').send({ ...worker(id), version, cliVersion })
    const old = (await hello('worker-0204', '0.2.4', '0.2.0')).body.chunk as Structured
    expect(old).toMatchObject({ jobId: plain.body.id, perGame: false })
    const oldEngine = (await hello('worker-0205-old', '0.2.5', '0.1.0')).body.chunk as Structured
    expect(oldEngine).toMatchObject({ jobId: plain.body.id, perGame: false })
    const chunk = (await hello('worker-0205', '0.2.5', '0.2.0')).body.chunk as Structured
    expect(chunk).toMatchObject({ jobId: created.body.id, games: 4, perGame: true })
    const result = {
      workerId: 'worker-0205',
      engineRev: test.env.engineRev,
      winsA: 2,
      winsB: 1,
      ties: 1,
      games: 4,
      turns: 60,
      durationMs: 40,
    }
    const perGame = {
      winners: 'ABTA',
      starters: 'AABB',
      endings: 'PNLP',
      turns: [12, 9, 31, 8],
      stagesA: '1201',
      stagesB: '0110',
    }
    const put = (body: Structured) => bearer('put', `/api/worker/chunks/${chunk.chunkId}/result`).send(body)
    // Without perGame: refused, and counted as a failure of the engine (otherwise it would come back forever).
    const missing = await put(result)
    expect(missing.status).toBe(422)
    expect(missing.body.error).toMatchObject({ code: 'invalid_result' })
    expect(missing.body.error.message).toContain('perGame')
    expect(await test.prisma.simulationChunk.findUniqueOrThrow({ where: { id: Number(chunk.chunkId) } })).toMatchObject(
      {
        status: 'queued',
        attempt: 1,
        workerId: null,
      },
    )
    expect((await put({ ...result, extra: { perGame: { ...perGame, winners: 'AATA' } } })).status).toBe(422)
    expect((await put({ ...result, extra: { perGame: { ...perGame, endings: 'PNPP' } } })).status).toBe(422)
    expect((await put({ ...result, turns: 61, extra: { perGame } })).status).toBe(422)
    for (const turnLimit of [0, 30.5, 1e9, '30']) {
      expect((await put({ ...result, extra: { perGame: { ...perGame, turnLimit } } })).status).toBe(422)
    }
    // With a limit of 20, a game won in 21 turns does not add up (a game past the limit is a tie).
    expect(
      (await put({ ...result, extra: { perGame: { ...perGame, turnLimit: 20, turns: [21, 9, 31, 8] } } })).status,
    ).toBe(422)
    // The worker that claims it again sends it right.
    const again = (await hello('worker-0205', '0.2.5', '0.2.0')).body.chunk as Structured
    expect(again).toMatchObject({ chunkId: chunk.chunkId })
    expect((await put({ ...result, extra: { perGame } })).body).toEqual({ accepted: true })
    const stored = await test.prisma.simulationChunk.findUniqueOrThrow({ where: { id: Number(chunk.chunkId) } })
    expect(stored.extra).toEqual({ perGame })
    for (const id of [created.body.id, plain.body.id]) {
      await post(`/api/simulations/${id}/cancel`)
      await test.http().delete(`/api/simulations/${id}`).set('Cookie', cookie)
    }
  })

  it('replays: one per pairing in a matrix and two in a comparison unless the request says (the database filled up)', async () => {
    const make = async (body: Structured) =>
      (await post('/api/simulations').send({ gamesPerPair: 10, players: ['r', 'r'], ...body })).body.id as number
    const matrix = await make({ kind: 'matrix', sideA: decks(1, 3) })
    const compare = await make({ kind: 'compare', sideA: decks(3, 3), sideB: decks(5, 5) })
    const chosen = await make({ kind: 'matrix', sideA: decks(1, 3), replaySample: 3 })
    const sample = async (id: number) =>
      (await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })).replaySample
    expect([await sample(matrix), await sample(compare), await sample(chosen)]).toEqual([1, 2, 3])
    for (const id of [matrix, compare, chosen]) {
      await post(`/api/simulations/${id}/cancel`)
      await test.http().delete(`/api/simulations/${id}`).set('Cookie', cookie)
    }
  })

  it('H-010: three results that do not add up, each after a claim, fail the chunk and end the job; a stale one does not count', async () => {
    const created = await post('/api/simulations').send({
      kind: 'compare',
      sideA: decks(3, 3),
      sideB: decks(5, 5),
      gamesPerPair: 4,
      players: ['r', 'r'],
    })
    const bad = (workerId: string) => ({
      workerId,
      engineRev: test.env.engineRev,
      winsA: 1,
      winsB: 1,
      ties: 1,
      games: 4,
      durationMs: 1,
    })
    const attemptOf = async (id: unknown) =>
      (await test.prisma.simulationChunk.findUniqueOrThrow({ where: { id: Number(id) } })).attempt
    let chunkId: unknown = null
    for (const attempt of [1, 2]) {
      chunkId = ((await claim('worker-bad')).body.chunk as Structured).chunkId
      expect((await bearer('put', `/api/worker/chunks/${chunkId}/result`).send(bad('worker-bad'))).status).toBe(422)
      expect(await attemptOf(chunkId)).toBe(attempt)
    }
    // A worker that does not hold the chunk (it went back to the queue) sends a bad result: it does not count.
    expect((await bearer('put', `/api/worker/chunks/${chunkId}/result`).send(bad('worker-late'))).status).toBe(422)
    expect(await attemptOf(chunkId)).toBe(2)
    expect(((await claim('worker-bad')).body.chunk as Structured).chunkId).toBe(chunkId)
    expect((await bearer('put', `/api/worker/chunks/${chunkId}/result`).send(bad('worker-bad'))).status).toBe(422)
    expect(await test.prisma.simulationChunk.findUniqueOrThrow({ where: { id: Number(chunkId) } })).toMatchObject({
      status: 'failed',
      attempt: 3,
    })
    expect((await get(`/api/simulations/${created.body.id}`)).body.status).toBe('failed')
    await test.http().delete(`/api/simulations/${created.body.id}`).set('Cookie', cookie)
  })

  it('capabilities: engine features decide perGame; an incapable worker gets a hint and the alert says nobody can play it', async () => {
    const created = await post('/api/simulations').send({
      kind: 'compare',
      sideA: decks(3, 3),
      sideB: decks(5, 5),
      gamesPerPair: 4,
      players: ['r', 'r'],
      perGame: true,
    })
    // Only the workers of this test count as seen in the last 30 minutes.
    await test.prisma.workerNode.updateMany({ data: { lastSeenAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } })
    const hello = (id: string, cliVersion: string, engineFeatures: string[]) =>
      bearer('post', '/api/worker/claim').send({ ...worker(id), version: '0.2.6', cliVersion, engineFeatures })
    const idleTitles = async () =>
      ((await get('/api/alerts')).body.items as { code: string; title: string }[])
        .filter((item) => item.code === 'worker_idle')
        .map((item) => item.title)
    // An engine that lists its features without perGame: nothing, and the hint says why.
    const blocked = (await hello('worker-feat-1', '0.9.0', ['batch'])).body
    expect(blocked.chunk).toBeNull()
    expect(blocked.hint).toContain('partida por partida')
    expect(await test.prisma.workerNode.findUniqueOrThrow({ where: { id: 'worker-feat-1' } })).toMatchObject({
      engineFeatures: ['batch'],
    })
    // The only worker of the last 30 minutes cannot play what waits: the alert says so.
    expect(await idleTitles()).toEqual([
      expect.stringMatching(/^Hay simulaciones que ningún worker puede jugar \(desde el \d+\/\d+ \d\d:\d\d\)$/),
    ])
    // An engine that lists perGame plays it, whatever its version number says.
    const chunk = (await hello('worker-feat-2', '0.1.0', ['perGame'])).body.chunk as Structured
    expect(chunk).toMatchObject({ jobId: created.body.id, perGame: true })
    expect(await idleTitles()).toEqual([])
    // A capable worker with nothing left gets no hint; nor does an incapable one once nothing with perGame waits.
    const capable = (await hello('worker-feat-2', '0.1.0', ['perGame'])).body
    expect(capable).toMatchObject({ chunk: null })
    expect(capable.hint).toBeUndefined()
    await post(`/api/simulations/${created.body.id}/cancel`)
    await test.http().delete(`/api/simulations/${created.body.id}`).set('Cookie', cookie)
    const nothing = (await hello('worker-feat-1', '0.9.0', ['batch'])).body
    expect(nothing).toMatchObject({ chunk: null })
    expect(nothing.hint).toBeUndefined()
  })

  it('B2: a worker that asks for a batch gets several chunks of one job in order, within its limits', async () => {
    const compare = await post('/api/simulations').send({
      kind: 'compare',
      sideA: decks(3, 3),
      sideB: decks(5, 10),
      gamesPerPair: 60,
      players: ['r', 'r'],
      seed: 500,
    })
    expect(compare.body.progress.chunks.total).toBe(6)
    const hello = (id: string, batch?: { maxChunks: number; maxGames: number }) =>
      bearer('post', '/api/worker/claim').send({ ...worker(id), version: '0.2.6', ...(batch ? { batch } : {}) })
    // Without `batch`: one chunk and the old shape of the answer.
    const single = (await hello('worker-b2-1')).body
    expect(single.chunk).toMatchObject({ jobId: compare.body.id, idx: 0 })
    expect(single.chunks).toBeUndefined()
    // 200 games at most: the next three chunks (60 + 60 + 60), in order, each with its own seed and lease.
    const batch = (await hello('worker-b2-2', { maxChunks: 10, maxGames: 200 })).body
    expect(batch.chunk).toMatchObject({ idx: 1 })
    expect(batch.chunks.map((chunk: Structured) => chunk.idx)).toEqual([1, 2, 3])
    expect(new Set(batch.chunks.map((chunk: Structured) => chunk.seed)).size).toBe(3)
    expect(batch.chunks.every((chunk: Structured) => String(chunk.deckB).startsWith('Energy: '))).toBe(true)
    const leased = await test.prisma.simulationChunk.findMany({
      where: { jobId: compare.body.id, status: 'leased' },
      orderBy: { idx: 'asc' },
    })
    expect(leased.map((chunk) => [chunk.idx, chunk.workerId])).toEqual([
      [0, 'worker-b2-1'],
      [1, 'worker-b2-2'],
      [2, 'worker-b2-2'],
      [3, 'worker-b2-2'],
    ])
    // At most maxChunks, and never a chunk of another job.
    const rest = (await hello('worker-b2-3', { maxChunks: 1, maxGames: 5000 })).body
    expect(rest.chunks.map((chunk: Structured) => chunk.idx)).toEqual([4])
    const last = (await hello('worker-b2-3', { maxChunks: 10, maxGames: 5000 })).body
    expect(last.chunks.map((chunk: Structured) => chunk.idx)).toEqual([5])
    expect((await hello('worker-b2-4', { maxChunks: 10, maxGames: 5000 })).body).toMatchObject({
      chunk: null,
      chunks: [],
    })
    // Each chunk of the batch reports on its own; the job ends with the last one.
    for (const chunk of [single.chunk, ...batch.chunks, ...rest.chunks, ...last.chunks] as Structured[]) {
      const owner = String(leased.find((row) => row.id === chunk.chunkId)?.workerId ?? 'worker-b2-3')
      const sent = await bearer('put', `/api/worker/chunks/${chunk.chunkId}/result`).send({
        workerId: owner,
        engineRev: test.env.engineRev,
        winsA: 30,
        winsB: 30,
        ties: 0,
        games: 60,
        durationMs: 100,
      })
      expect(sent.body).toEqual({ accepted: true })
    }
    expect((await get(`/api/simulations/${compare.body.id}`)).body.status).toBe('done')
    await test.http().delete(`/api/simulations/${compare.body.id}`).set('Cookie', cookie)
  })

  it('B2: two batch claims at once never share a chunk and each takes one job; the time left counts workers', async () => {
    const make = async (sideB: { deckId: string }[]) =>
      (
        await post('/api/simulations').send({
          kind: 'compare',
          sideA: decks(3, 3),
          sideB,
          gamesPerPair: 60,
          players: ['r', 'r'],
        })
      ).body.id as number
    const small = await make(decks(5, 7))
    const big = await make(decks(8, 13))
    const hello = (id: string) =>
      bearer('post', '/api/worker/claim').send({
        ...worker(id),
        version: '0.2.7',
        batch: { maxChunks: 64, maxGames: 5000 },
      })
    const ids = (body: { chunks: Structured[] }) => body.chunks.map((chunk) => Number(chunk.chunkId))
    const jobs = (body: { chunks: Structured[] }) => new Set(body.chunks.map((chunk) => chunk.jobId))
    const [one, two] = await Promise.all([hello('worker-b2-x'), hello('worker-b2-y')])
    expect(ids(one.body).filter((id) => ids(two.body).includes(id))).toEqual([])
    expect([jobs(one.body).size, jobs(two.body).size]).toEqual([1, 1])
    // Whatever the two took, the rest goes to the next claims, and nothing is handed out twice.
    const seen = new Set([...ids(one.body), ...ids(two.body)])
    for (let i = 0; i < 4 && seen.size < 9; i++) {
      for (const id of ids((await hello('worker-b2-z')).body)) {
        expect(seen.has(id)).toBe(false)
        seen.add(id)
      }
    }
    expect(seen.size).toBe(9)
    for (const id of [small, big]) {
      await post(`/api/simulations/${id}/cancel`)
      await test.http().delete(`/api/simulations/${id}`).set('Cookie', cookie)
    }
    // One worker holds the 6 chunks of a job: after one of them (60 games in 60 s), 300 games are left at 1 s each.
    const alone = await make(decks(8, 13))
    const held = (await hello('worker-b2-x')).body.chunks as Structured[]
    expect(held).toHaveLength(6)
    await bearer('put', `/api/worker/chunks/${held[0]?.chunkId}/result`).send({
      workerId: 'worker-b2-x',
      engineRev: test.env.engineRev,
      winsA: 30,
      winsB: 30,
      ties: 0,
      games: 60,
      durationMs: 60_000,
    })
    expect((await get(`/api/simulations/${alone}`)).body.progress.etaSeconds).toBe(300)
    await post(`/api/simulations/${alone}/cancel`)
    await test.http().delete(`/api/simulations/${alone}`).set('Cookie', cookie)
  })

  it('B3: while a search waits for its next round matrix chunks wait; comparisons do not, and the matrix goes on after 2 minutes', async () => {
    const matrix = await post('/api/simulations').send({
      kind: 'matrix',
      sideA: decks(1, 3),
      gamesPerPair: 10,
      players: ['r', 'r'],
    })
    expect(matrix.status).toBe(201)
    // A search between two rounds: its last chunk finished just now and nothing of it is queued.
    const search = await test.prisma.simulationJob.create({
      data: {
        kind: 'explore',
        status: 'running',
        label: 'Explorar',
        params: {},
        engineRev: test.env.engineRev,
        players: ['r', 'r'],
        gamesPerPair: 10,
        baseSeed: 1n,
        totalGames: 10,
        chunks: { create: [{ idx: 0, games: 10, seed: 1n, status: 'done', finishedAt: new Date() }] },
      },
    })
    expect((await claim('worker-b3')).body.chunk).toBeNull()
    const compare = await post('/api/simulations').send({
      kind: 'compare',
      sideA: decks(3, 3),
      sideB: decks(5, 5),
      gamesPerPair: 10,
      players: ['r', 'r'],
    })
    expect((await claim('worker-b3')).body.chunk).toMatchObject({ jobId: compare.body.id })
    // No new round for two minutes (the Laboratorio failed?): the matrix is not held any longer.
    await test.prisma.simulationChunk.updateMany({
      where: { jobId: search.id },
      data: { finishedAt: new Date(Date.now() - 3 * 60_000) },
    })
    expect((await claim('worker-b3')).body.chunk).toMatchObject({ jobId: matrix.body.id })
    await test.prisma.simulationJob.delete({ where: { id: search.id } })
    for (const id of [matrix.body.id, compare.body.id]) {
      await post(`/api/simulations/${id}/cancel`)
      await test.http().delete(`/api/simulations/${id}`).set('Cookie', cookie)
    }
  })

  it('H-020: in a comparison every deck plays each rival with the same seeds, also in the parts of a split pairing', async () => {
    const created = await post('/api/simulations').send({
      kind: 'compare',
      sideA: decks(2, 3),
      sideB: decks(5, 7),
      gamesPerPair: 1500,
      players: ['r', 'r'],
      seed: 9000,
    })
    expect(created.status).toBe(201)
    const chunks = await test.prisma.simulationChunk.findMany({
      where: { jobId: created.body.id },
      orderBy: { idx: 'asc' },
    })
    // 2 decks × 3 rivals, each pairing split in 1000 + 500.
    expect(chunks).toHaveLength(12)
    const job = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: created.body.id } })
    const rivals = (job.params as { sideB: number[] }).sideB
    for (const chunk of chunks) {
      const rival = rivals.indexOf(chunk.snapshotBId as number)
      expect(Number(chunk.seed)).toBe(9000 + (chunk.firstGame / 1000) * 1000 + rival)
    }
    const seedsOf = (deck: number | null) =>
      chunks
        .filter((chunk) => chunk.snapshotAId === deck)
        .map((chunk) => [chunk.snapshotBId, chunk.firstGame, chunk.seed])
    expect(seedsOf(chunks[0]?.snapshotAId ?? null)).toEqual(seedsOf(chunks[11]?.snapshotAId ?? null))
    await post(`/api/simulations/${created.body.id}/cancel`)
    await test.http().delete(`/api/simulations/${created.body.id}`).set('Cookie', cookie)
  })

  it('H-018: a job with the f bots goes only to workers whose engine lists «fairBots»', async () => {
    const created = await post('/api/simulations').send({
      kind: 'compare',
      sideA: decks(3, 3),
      sideB: decks(5, 5),
      gamesPerPair: 4,
      players: ['f2', 'e2'],
      seed: 78,
    })
    expect(created.status).toBe(201)
    const claim = (id: string, engineFeatures: string[]) =>
      bearer('post', '/api/worker/claim').send({ ...worker(id), version: '0.2.6', cliVersion: '0.3.1', engineFeatures })
    expect((await claim('worker-f-old', ['perGame', 'batch'])).body.chunk).toBeNull()
    const fresh = (await claim('worker-f-new', ['perGame', 'batch', 'fairBots'])).body.chunk as Structured
    expect(fresh).toMatchObject({ jobId: created.body.id, players: ['f2', 'e2'] })
    await post(`/api/simulations/${created.body.id}/cancel`)
    await test.http().delete(`/api/simulations/${created.body.id}`).set('Cookie', cookie)
  })

  it('list: archive finished jobs (one by one or all), bring them back, delete the cancelled ones', async () => {
    const make = async () =>
      (
        await post('/api/simulations').send({
          kind: 'compare',
          sideA: decks(3, 3),
          sideB: decks(5, 5),
          gamesPerPair: 10,
          players: ['r', 'r'],
        })
      ).body.id as number
    const [cancelled, done, queued] = [await make(), await make(), await make()]
    await post(`/api/simulations/${cancelled}/cancel`)
    await test.prisma.simulationJob.update({ where: { id: done }, data: { status: 'done', finishedAt: new Date() } })

    const refused = await post(`/api/simulations/${queued}/archive`)
    expect(refused.status).toBe(400)
    expect(refused.body.error.code).toBe('job_running')
    const archived = await post(`/api/simulations/${done}/archive`)
    expect(archived.status).toBe(200)
    expect(archived.body.archived).toBe(true)
    const list = (await get('/api/simulations')).body as { items: { id: number }[]; counts: Record<string, number> }
    expect(list.items.map((job) => job.id)).toEqual(expect.arrayContaining([cancelled, queued]))
    expect(list.items.map((job) => job.id)).not.toContain(done)
    expect(list.counts).toMatchObject({ archived: 1, cancelled: 1, done: 0 })
    expect((await get('/api/simulations?archived=true')).body.items.map((job: { id: number }) => job.id)).toEqual([
      done,
    ])
    // Archived results still count: the job itself is still there.
    expect((await get(`/api/simulations/${done}`)).body).toMatchObject({ status: 'done', archived: true })

    expect((await post(`/api/simulations/${done}/unarchive`)).body.archived).toBe(false)
    expect((await get('/api/simulations')).body.counts).toMatchObject({ archived: 0, done: 1 })
    expect((await post('/api/simulations/cleanup').send({ action: 'archive_done' })).body).toEqual({ count: 1 })
    expect(
      (await post('/api/simulations/cleanup').send({ action: 'delete_cancelled' })).body.count,
    ).toBeGreaterThanOrEqual(1)
    expect((await get(`/api/simulations/${cancelled}`)).status).toBe(404)
    expect((await post('/api/simulations/cleanup').send({ action: 'nope' })).status).toBe(400)

    await post(`/api/simulations/${queued}/cancel`)
    expect((await test.http().delete(`/api/simulations/${queued}`).set('Cookie', cookie)).status).toBe(204)
    expect((await test.http().delete(`/api/simulations/${done}`).set('Cookie', cookie)).status).toBe(204)
  })

  it('H-003: a long poll that times out leaves no listener behind', async () => {
    const queue = test.app.get(WorkerQueueService) as unknown as { queued: { listenerCount(event: string): number } }
    const before = queue.queued.listenerCount('queued')
    for (let i = 0; i < 3; i++) {
      const response = await claim('worker-h003')
      expect(response.status).toBe(200)
      expect(response.body.chunk).toBeNull()
    }
    expect(queue.queued.listenerCount('queued')).toBe(before)
  })
})
