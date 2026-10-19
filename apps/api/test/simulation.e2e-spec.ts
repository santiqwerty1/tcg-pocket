import type { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { jobSummaryJson } from '../src/mcp/mcp-json.js'
import { LiveGamesService } from '../src/play/live-games.service.js'
import { ChunkCacheService } from '../src/simulation/chunk-cache.service.js'
import { EngineChangeService, GAMES_REV_GONE_MS } from '../src/simulation/engine-change.service.js'
import { SimulationsService } from '../src/simulation/simulations.service.js'
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

    // Right after an engine update, until a worker reports the new one: the status of the engine the app used before
    // (the last applied catalog sync of another engine), never the one of an old worker still online (H-059: a
    // worker on 33ff2a5 played the B4b reprints as the old edition, and the snapshots took other keys).
    const older = 'a'.repeat(40)
    const ancient = 'c'.repeat(40)
    await test.prisma.engineCard.updateMany({ data: { engineRev: older } })
    await test.prisma.engineCard.createMany({
      data: [
        { engineRev: ancient, engineId: 'A1 001', name: 'Bulbasaur', status: 'Complete', complete: true },
        { engineRev: ancient, engineId: 'B4b 198', name: 'Lucky Ice Pop', status: 'MissingTrainer', complete: false },
        {
          engineRev: ancient,
          engineId: 'B4b 199',
          name: 'Pokémon Center Lady',
          status: 'MissingTrainer',
          complete: false,
        },
      ],
    })
    await test.prisma.workerNode.create({
      data: { id: 'worker-old-engine', name: 'pc vieja', engineRev: ancient, cores: 2, lastSeenAt: new Date() },
    })
    const syncs = await test.prisma.catalogSync.findMany({
      where: { engineRev: test.env.engineRev },
      select: { id: true },
    })
    await test.prisma.catalogSync.updateMany({ where: { engineRev: test.env.engineRev }, data: { engineRev: older } })
    try {
      test.app.get(EngineStatusService).invalidate()
      expect((await get('/api/simulations/engine')).body).toMatchObject({
        source: 'previous',
        statusRev: older,
        incomplete: 1,
      })

      // No sync of another engine with a status: the Fase 0 list, not the old worker's.
      await test.prisma.engineCard.deleteMany({ where: { engineRev: older } })
      test.app.get(EngineStatusService).invalidate()
      expect((await get('/api/simulations/engine')).body).toMatchObject({
        source: 'fallback',
        incomplete: 46,
      })
    } finally {
      await test.prisma.catalogSync.updateMany({
        where: { id: { in: syncs.map((sync) => sync.id) } },
        data: { engineRev: test.env.engineRev },
      })
    }
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

    // A result.json the worker lost (the engine ended well, the S25 of 12/10/2026) sends the chunk back without
    // spending an attempt: a worker's problem never fails the job (worker 0.3.4 on).
    const returned = (await claim()).body.chunk as Structured
    expect(
      (
        await bearer('put', `/api/worker/chunks/${returned.chunkId}/failure`).send({
          workerId: 'worker-0001',
          error: 'engine-cli simulate terminó con código 0 sin resultado válido',
          cause: 'worker',
        })
      ).body,
    ).toEqual({ status: 'queued' })
    expect(await test.prisma.simulationChunk.findUnique({ where: { id: Number(returned.chunkId) } })).toMatchObject({
      status: 'queued',
      attempt: 0,
      workerId: null,
      error: expect.stringContaining('Devuelto por el worker'),
    })

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

  it('returns without an attempt (a lost result.json) end: 5 from one worker or 3 from two count as one; the pause shows', async () => {
    const lost = 'engine-cli simulate terminó con código 0 sin resultado válido'
    const job = async () => {
      const created = await post('/api/simulations').send({
        kind: 'compare',
        sideA: decks(2, 2),
        sideB: decks(5, 5),
        gamesPerPair: 20,
        players: ['r', 'r'],
      })
      expect(created.body.progress).toMatchObject({ chunks: { total: 1 } })
      return created.body.id as number
    }
    const giveBack = async (workerId: string, extra: Record<string, unknown> = {}) => {
      const chunk = (await claim(workerId)).body.chunk as Structured
      const answer = await bearer('put', `/api/worker/chunks/${chunk.chunkId}/failure`).send({
        workerId,
        error: lost,
        cause: 'worker',
        ...extra,
      })
      return { chunkId: Number(chunk.chunkId), status: answer.body.status as string }
    }
    const row = (id: number) => test.prisma.simulationChunk.findUnique({ where: { id } })
    const engineWorker = async (id: string) =>
      ((await get('/api/simulations/engine')).body.workers as { id: string; paused: Structured | null }[]).find(
        (worker) => worker.id === id,
      )

    // One worker: four returns cost nothing; the fifth counts as an attempt, so a chunk no one can play still ends.
    const first = await job()
    const until = new Date(Date.now() + 30 * 60_000).toISOString()
    let returned = await giveBack('worker-0001', { pausedUntil: until })
    // The pause it sent shows in Simulación until it claims again.
    expect((await engineWorker('worker-0001'))?.paused).toEqual({ until, reason: 'lost_results' })
    // The pause episode began with it (the alert's title, one push per episode) and outlives its claims (51.26).
    const node = () => test.prisma.workerNode.findUniqueOrThrow({ where: { id: 'worker-0001' } })
    const since = (await node()).pausedSince
    expect(since).not.toBeNull()
    for (let i = 0; i < 3; i++) returned = await giveBack('worker-0001')
    expect((await engineWorker('worker-0001'))?.paused).toBeNull()
    expect((await node()).pausedSince).toEqual(since)
    expect(await row(returned.chunkId)).toMatchObject({ status: 'queued', attempt: 0, returns: 4 })
    returned = await giveBack('worker-0001')
    expect(returned.status).toBe('queued')
    expect(await row(returned.chunkId)).toMatchObject({
      attempt: 1,
      returns: 5,
      returnedBy: ['worker-0001'],
      error: expect.stringContaining('Devuelto 5 veces sin resultado (1 worker): cuenta como intento'),
    })
    await post(`/api/simulations/${first}/cancel`)

    // Two workers: the third return counts.
    const second = await job()
    await giveBack('worker-0001')
    await giveBack('worker-0002')
    returned = await giveBack('worker-0001')
    expect(await row(returned.chunkId)).toMatchObject({
      attempt: 1,
      returns: 3,
      returnedBy: ['worker-0001', 'worker-0002'],
      error: expect.stringContaining('(2 workers)'),
    })
    await post(`/api/simulations/${second}/cancel`)

    // A chunk this worker sent back goes last for it: it takes the other one, and another worker takes it (review of
    // #72: alone, the S25 got the same chunk back seven times). A pause is capped at 6 h, whatever its clock says.
    const two = await post('/api/simulations').send({
      kind: 'compare',
      sideA: decks(2, 2),
      sideB: decks(5, 6),
      gamesPerPair: 20,
      players: ['r', 'r'],
    })
    expect(two.body.progress).toMatchObject({ chunks: { total: 2 } })
    const far = new Date(Date.now() + 48 * 60 * 60_000).toISOString()
    const back = await giveBack('worker-0001', { pausedUntil: far })
    expect(((await node()).pausedUntil?.getTime() ?? 0) - Date.now()).toBeLessThanOrEqual(6 * 60 * 60_000)
    const mine = (await claim('worker-0001')).body.chunk as Structured
    expect(mine.chunkId).not.toBe(back.chunkId)
    // Its platform, from worker 0.3.5 (the pause alert asks for Termux's battery only on Android).
    const other = await bearer('post', '/api/worker/claim').send({ ...worker('worker-0002'), platform: 'android' })
    expect((other.body.chunk as Structured).chunkId).toBe(back.chunkId)
    expect((await test.prisma.workerNode.findUniqueOrThrow({ where: { id: 'worker-0002' } })).platform).toBe('android')
    // A result delivered ends worker-0001's pause episode.
    expect((await node()).pausedSince).toEqual(since)
    const delivered = await bearer('put', `/api/worker/chunks/${mine.chunkId}/result`).send({
      workerId: 'worker-0001',
      engineRev: test.env.engineRev,
      winsA: 10,
      winsB: 10,
      ties: 0,
      games: Number(mine.games),
      turns: 200,
      durationMs: 1000,
    })
    expect(delivered.body).toEqual({ accepted: true })
    expect((await node()).pausedSince).toBeNull()
    await post(`/api/simulations/${two.body.id}/cancel`)
    for (const id of [first, second, two.body.id as number]) {
      expect((await test.http().delete(`/api/simulations/${id}`).set('Cookie', cookie)).status).toBe(204)
    }
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
    // H-050: Poké Ball, which the deck keeps twice, does not go (the engine dropped those combinations anyway).
    expect(chunk.optimize).toMatchObject({ missing: 1, candidates: ['A1 219', 'A2 150'], gamesPerEnemy: 20 })
    expect((chunk.optimize.enemies as string[]).length).toBe(2)
    expect(
      String(chunk.optimize.deck)
        .split('\n')
        .filter((line) => /^\d/.test(line))
        .reduce((sum, line) => sum + Number(line.split(' ')[0]), 0),
    ).toBe(19)
  })

  /** An optimize of deck 2 (one card out, three candidates) against decks 5 and 6, claimed by `worker`. */
  async function claimedOptimize(label: string, worker = 'worker-opt') {
    const deck = (await get(`/api/decks/${deckIds[1]}`)).body as { cards: { card: { id: string }; count: number }[] }
    const out = deck.cards.filter((entry) => entry.count === 1).slice(0, 1)
    const created = await post('/api/simulations').send({
      kind: 'optimize',
      label,
      sideA: [{ deckId: deckIds[1] }],
      sideB: decks(5, 6),
      gamesPerPair: 20,
      players: ['e2', 'e2'],
      optimize: {
        remove: out.map((entry) => ({ cardId: entry.card.id, count: 1 })),
        candidates: ['A1-219', 'P-A-5', 'A2-150'],
      },
    })
    const id = created.body.id as number
    const chunk = (await claim(worker)).body.chunk as Structured
    expect(chunk).toMatchObject({ jobId: id, kind: 'optimize' })
    const tally = (wins: number) => ({ winsA: wins, winsB: 20 - wins, ties: 0, games: 20, turns: 200 })
    const combination = (card: string, wins: number) => ({
      cards: [card],
      winsA: wins * 2,
      winsB: 40 - wins * 2,
      ties: 0,
      games: 40,
      turns: 400,
      perEnemy: [tally(wins), tally(wins)],
    })
    // The engine's combinations in its own order; the confirmation takes the best 3 by raw rate. A third Poké Ball is
    // what an engine got before H-050 (the server no longer sends it): its row is kept and marked.
    const result = {
      workerId: 'worker-0001',
      engineRev: test.env.engineRev,
      winsA: 72,
      winsB: 48,
      ties: 0,
      games: 120,
      turns: 1200,
      durationMs: 1000,
      extra: { combinations: [combination('A2 150', 9), combination('A1 219', 15), combination('P-A 005', 12)] },
    }
    const send = () => bearer('put', `/api/worker/chunks/${chunk.chunkId}/result`).send(result)
    return { id, send }
  }

  /** Comparisons queued to confirm the optimize `id`. */
  const confirmationsOf = (id: number) =>
    test.prisma.simulationJob.findMany({ where: { params: { path: ['confirmationOf', 'jobId'], equals: id } } })

  it('H-011.5: the preview and the plan count the confirmation an optimize queues when it ends', async () => {
    const deck = (await get(`/api/decks/${deckIds[1]}`)).body as { cards: { card: { id: string }; count: number }[] }
    const out = deck.cards.filter((entry) => entry.count === 1).slice(0, 1)
    const preview = await post('/api/simulations/preview').send({
      kind: 'optimize',
      sideA: [{ deckId: deckIds[1] }],
      sideB: decks(5, 6),
      gamesPerPair: 20,
      players: ['e2', 'e2'],
      optimize: { remove: [{ cardId: out[0]?.card.id, count: 1 }], candidates: ['A1-219', 'A1-225', 'A2-150'] },
    })
    expect(preview.status).toBe(200)
    // 3 combinations × 2 rivals × 20, then the best 3 × 2 rivals × 200.
    expect(preview.body).toMatchObject({
      pairings: 2,
      totalGames: 120 + 1200,
      confirmationGames: 1200,
      combinations: 3,
    })
  })

  it('H-050: two places and one candidate play it twice; a name the deck keeps twice does not go', async () => {
    // Deck 2 keeps 2 Poké Ball (P-A-5) and plays Heatmor (B1-44) and Castform Forma Sol (B3-24) once each.
    const job = (
      candidates: string[],
      remove = [
        { cardId: 'B1-44', count: 1 },
        { cardId: 'B3-24', count: 1 },
      ],
    ) => ({
      kind: 'optimize',
      sideA: [{ deckId: deckIds[1] }],
      sideB: decks(5, 6),
      gamesPerPair: 20,
      players: ['e2', 'e2'],
      optimize: { remove, candidates },
    })
    const created: number[] = []
    try {
      // Erika twice is a combination; Poké Ball is full.
      const preview = await post('/api/simulations/preview').send(job(['A1-219', 'P-A-5']))
      expect(preview.status).toBe(200)
      expect(preview.body).toMatchObject({
        combinations: 1,
        optimizeProblem: null,
        totalGames: 1 * 2 * 20 + 1 * 2 * 200,
      })
      // Erika and Sabrina: Erika twice, Sabrina twice, one of each.
      expect((await post('/api/simulations/preview').send(job(['A1-219', 'A1-225']))).body).toMatchObject({
        combinations: 3,
      })
      // Two editions of one card play the same: one goes (Charmander A1-33 and its full art A1-230), and the preview
      // says so.
      const editions = await post('/api/simulations/preview').send(job(['A1-33', 'A1-230']))
      expect(editions.body).toMatchObject({ combinations: 1, optimizeProblem: null })
      expect(editions.body.optimizeMerged).toEqual([
        expect.stringMatching(/\(A1-230\) juega igual que A1-33: va una sola\.$/),
      ])
      expect(preview.body.optimizeMerged).toEqual([])
      const one = await post('/api/simulations').send(job(['A1-219', 'P-A-5']))
      expect(one.status).toBe(201)
      created.push(one.body.id)
      const chunk = (await claim()).body.chunk as { optimize: Structured }
      expect(chunk.optimize).toMatchObject({ missing: 2, candidates: ['A1 219', 'A1 219'] })
      await post(`/api/simulations/${one.body.id}/cancel`)
      // Taking out both Poké Ball frees them: Poké Ball twice, Erika twice, one of each. Asked once for 2 or twice
      // for 1, the preview and the job count the same.
      for (const remove of [
        [{ cardId: 'P-A-5', count: 2 }],
        [
          { cardId: 'P-A-5', count: 1 },
          { cardId: 'P-A-5', count: 1 },
        ],
      ]) {
        const freed = await post('/api/simulations/preview').send(job(['P-A-5', 'A1-219'], remove))
        expect(freed.body).toMatchObject({ combinations: 3 })
        const queued = await post('/api/simulations').send(job(['P-A-5', 'A1-219'], remove))
        expect(queued.status).toBe(201)
        created.push(queued.body.id)
        const freedChunk = (await claim()).body.chunk as { optimize: Structured }
        expect(freedChunk.optimize).toMatchObject({
          missing: 2,
          candidates: ['P-A 005', 'P-A 005', 'A1 219', 'A1 219'],
        })
        await post(`/api/simulations/${queued.body.id}/cancel`)
      }
      // Only Poké Ball: nothing fits, said by the preview and refused before queuing.
      const fullPreview = await post('/api/simulations/preview').send(job(['P-A-5']))
      expect(fullPreview.body).toMatchObject({ combinations: 0 })
      expect(fullPreview.body.optimizeProblem).toMatch(/^Ninguna candidata entra/)
      const full = await post('/api/simulations').send(job(['P-A-5']))
      expect(full.status).toBe(400)
      expect(full.body.error.message).toMatch(/^Ninguna candidata entra/)
      // Erika alone cannot fill three places.
      const three = [
        { cardId: 'B1-44', count: 1 },
        { cardId: 'B3-24', count: 1 },
        { cardId: 'P-A-5', count: 1 },
      ]
      expect((await post('/api/simulations/preview').send(job(['A1-219'], three))).body.optimizeProblem).toMatch(
        /^Con estas candidatas no se llenan los 3 lugares/,
      )
      // A card the catalog does not have: the preview says so, the job refuses it.
      expect((await post('/api/simulations/preview').send(job(['A1-999']))).body.optimizeProblem).toBe(
        'Carta A1-999 desconocida.',
      )
      const unknown = await post('/api/simulations').send(job(['A1-999']))
      expect(unknown.status).toBe(400)
      expect(unknown.body.error.message).toBe('Carta A1-999 desconocida.')
    } finally {
      for (const id of created) {
        await post(`/api/simulations/${id}/cancel`)
        await test.http().delete(`/api/simulations/${id}`).set('Cookie', cookie)
      }
    }
  })

  it('H-011.5: a finished optimize queues its 3 best combinations again, with fresh seeds and more games', async () => {
    const { id, send } = await claimedOptimize('Optimizar el 2')
    // The same result twice at once (a worker retrying a slow answer): one confirmation.
    const sent = await Promise.all([send(), send()])
    expect(sent.map((response) => response.status)).toEqual([200, 200])
    expect(sent.some((response) => response.body.accepted === true)).toBe(true)
    expect((await send()).body).toEqual({ accepted: false })
    expect(await confirmationsOf(id)).toHaveLength(1)
    const detail = (await get(`/api/simulations/${id}`)).body as {
      status: string
      baseSeed: string
      sideB: number[]
      chunks: { seed: string }[]
      optimizeConfirmation: {
        jobId: number
        status: string
        rivals: number
        rows: {
          rank: number
          cards: { engineId: string }[]
          record: Structured | null
          rivalsPlayed: number
          playable: boolean
        }[]
      }
    }
    expect(detail.status).toBe('done')
    expect(detail.optimizeConfirmation).toMatchObject({ status: 'queued', rivals: 2, engineChange: null })
    // Deck 2 already plays 2 Poké Ball: with a third the engine would not play it, so it is left out (marked).
    expect(
      detail.optimizeConfirmation.rows.map((row) => [
        row.rank,
        row.cards[0]?.engineId,
        row.record,
        row.rivalsPlayed,
        row.playable,
      ]),
    ).toEqual([
      [1, 'A1 219', null, 0, true],
      [2, 'P-A 005', null, 0, false],
      [3, 'A2 150', null, 0, true],
    ])
    const confirmationId = detail.optimizeConfirmation.jobId
    const confirmation = (await get(`/api/simulations/${confirmationId}`)).body as {
      kind: string
      label: string
      gamesPerPair: number
      players: string[]
      baseSeed: string
      sideA: number[]
      sideB: number[]
      snapshots: { id: number; label: string; deckgymText: string; simulable: boolean }[]
      chunks: { id: number; a: number; b: number; seed: string }[]
    }
    expect(confirmation).toMatchObject({ kind: 'compare', gamesPerPair: 200, players: ['e2', 'e2'] })
    expect(confirmation.label).toBe(`Confirmación de «Optimizar el 2» (#${id})`)
    expect(confirmation.sideB).toEqual(detail.sideB)
    expect(confirmation.sideA).toHaveLength(2)
    // Fresh seeds: none of the optimize's.
    expect(confirmation.baseSeed).not.toBe(detail.baseSeed)
    const optimizeSeeds = new Set(detail.chunks.map((chunk) => chunk.seed))
    expect(confirmation.chunks.some((chunk) => optimizeSeeds.has(chunk.seed))).toBe(false)
    const variants = confirmation.snapshots.filter((snapshot) => confirmation.sideA.includes(snapshot.id))
    for (const variant of variants) {
      expect(variant.simulable).toBe(true)
      const cards = variant.deckgymText
        .split('\n')
        .filter((line) => /^\d/.test(line))
        .reduce((sum, line) => sum + Number(line.split(' ')[0]), 0)
      expect(cards).toBe(20)
    }
    expect(variants.find((variant) => variant.id === confirmation.sideA[0])?.label).toMatch(/· 1\.º: \+ /)
    // Phase 42: a confirmation that moves to another engine says so on the optimize (the search played on the old one).
    await test.prisma.simulationJob.update({ where: { id: confirmationId }, data: { engineRev: 'c'.repeat(40) } })
    expect((await test.app.get(EngineChangeService).moveJobs()).moved).toEqual([confirmationId])
    expect((await get(`/api/simulations/${id}`)).body.optimizeConfirmation.engineChange).toMatchObject({
      from: 'c'.repeat(40),
      replayed: false,
    })

    // The confirmation replays the rivals: it stays out of their «simulación» column.
    const simulations = test.app.get(SimulationsService)
    const rivalDeck = Number(deckIds[4])
    const columnBefore = await simulations.deckColumn(rivalDeck)
    // Played with its own seeds: rank 1 holds up at 60 %; rank 3 fails in the engine against the second rival.
    const failing = new Set(
      confirmation.chunks
        .filter((chunk) => chunk.a === confirmation.sideA[1] && chunk.b === confirmation.sideB[1])
        .map((chunk) => chunk.id),
    )
    let checkedHalf = false
    for (;;) {
      const next = (await claim('worker-opt')).body.chunk as Structured | null
      if (!next) break
      expect(next.jobId).toBe(confirmationId)
      if (failing.has(next.chunkId as number)) {
        await bearer('put', `/api/worker/chunks/${next.chunkId}/failure`).send({
          workerId: 'worker-opt',
          error: 'el motor se cayó',
        })
        continue
      }
      await bearer('put', `/api/worker/chunks/${next.chunkId}/result`).send({
        workerId: 'worker-opt',
        engineRev: test.env.engineRev,
        winsA: 120,
        winsB: 80,
        ties: 0,
        games: 200,
        durationMs: 1000,
      })
      // Against one rival of two: no percentage yet.
      const half = (await get(`/api/simulations/${id}`)).body.optimizeConfirmation.rows.find(
        (row: { rivalsPlayed: number }) => row.rivalsPlayed === 1,
      )
      if (half && !checkedHalf) {
        expect(half).toMatchObject({ record: null, rate: null })
        checkedHalf = true
      }
    }
    expect(checkedHalf).toBe(true)
    const after = (await get(`/api/simulations/${id}`)).body.optimizeConfirmation as {
      status: string
      rows: {
        record: { wins: number; losses: number } | null
        rate: { value: number } | null
        rivalsPlayed: number
        rivalsFailed: number
      }[]
    }
    expect(after.status).toBe('failed')
    expect(after.rows[0]).toMatchObject({ record: { wins: 240, losses: 160, ties: 0 }, rivalsPlayed: 2 })
    expect(after.rows[0]?.rate?.value).toBeCloseTo(60, 10)
    expect(after.rows[2]).toMatchObject({ record: null, rate: null, rivalsPlayed: 1, rivalsFailed: 1 })
    expect(await simulations.deckColumn(rivalDeck)).toEqual(columnBefore)
    // Claude sees both numbers, and which one to decide with (the app already listens, from beforeAll).
    const { port } = test.app.getHttpServer().address() as AddressInfo
    const client = new Client({ name: 'e2e', version: '1.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/api/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${mcpToken}` } },
      }),
    )
    const results = (await client.callTool({ name: 'simulations_results', arguments: { job: id } })) as {
      structuredContent?: Structured
    }
    await client.close()
    expect(results.structuredContent?.job).toMatchObject({ priority: 0 })
    expect(results.structuredContent?.confirmation).toMatchObject({
      job: confirmationId,
      status: 'falló',
      note: expect.stringContaining('El número para decidir es el de la confirmación'),
      combinations: [
        {
          position: 1,
          added: ['Erika'],
          search: { rate: { value: 75, games: 40 } },
          confirmation: { record: { wins: 240, losses: 160, ties: 0 }, rate: { value: 60, games: 400 } },
        },
        { position: 2, confirmation: 'el motor no juega ese mazo: quedó afuera' },
        { position: 3, confirmation: expect.stringContaining('1 de 2 rivales jugados (falló 1 en el motor)') },
      ],
    })
    // Once per optimize.
    expect(await simulations.confirmOptimize(id)).toBeNull()
    expect(await confirmationsOf(id)).toHaveLength(1)
    for (const job of [id, confirmationId]) {
      expect((await test.http().delete(`/api/simulations/${job}`).set('Cookie', cookie)).status).toBe(204)
    }
  })

  it('H-011.5: a confirmation that could not be queued is retried when the optimize is read, and only once', async () => {
    const simulations = test.app.get(SimulationsService)
    const { id, send } = await claimedOptimize('Optimizar el 2 (reintento)')
    const create = vi.spyOn(simulations, 'create').mockRejectedValueOnce(new Error('la base no contestó'))
    try {
      expect((await send()).body).toEqual({ accepted: true })
      const params = async () =>
        ((await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })).params as { confirmation?: Structured })
          .confirmation
      expect(await params()).toEqual({ pending: true, error: expect.stringContaining('la base no contestó') })
      expect(await confirmationsOf(id)).toHaveLength(0)
      // While another reader holds the claim, the view says it is waiting.
      const now = Date.now()
      await test.prisma.$executeRaw`
        UPDATE "simulation_jobs"
        SET "params" = jsonb_set("params", '{confirmation}', jsonb_build_object('pending', true, 'claimedAt', ${now}::bigint))
        WHERE "id" = ${id}`
      expect((await get(`/api/simulations/${id}`)).body.optimizeConfirmation).toMatchObject({
        jobId: null,
        status: 'pending',
        rows: [],
      })
      // A claim older than a minute was a crash: reading the optimize queues it.
      await test.prisma.$executeRaw`
        UPDATE "simulation_jobs"
        SET "params" = jsonb_set("params", '{confirmation}', jsonb_build_object('pending', true, 'claimedAt', 1))
        WHERE "id" = ${id}`
      const read = (await get(`/api/simulations/${id}`)).body.optimizeConfirmation as { jobId: number; status: string }
      expect(read).toMatchObject({ status: 'queued' })
      expect((await confirmationsOf(id)).map((job) => job.id)).toEqual([read.jobId])
      // A crash after queueing it and before saving it: two readers at once find the same comparison.
      await test.prisma.$executeRaw`
        UPDATE "simulation_jobs"
        SET "params" = jsonb_set("params", '{confirmation}', jsonb_build_object('pending', true))
        WHERE "id" = ${id}`
      const both = await Promise.all([simulations.confirmOptimize(id), simulations.confirmOptimize(id)])
      expect(both.filter((job) => job !== null).map((job) => job?.id)).toEqual([read.jobId])
      expect(await confirmationsOf(id)).toHaveLength(1)
      expect(await params()).toMatchObject({ jobId: read.jobId })
      // A queued job is cancelled before it can be deleted.
      expect((await post(`/api/simulations/${read.jobId}/cancel`)).body.status).toBe('cancelled')
      for (const job of [id, read.jobId]) {
        expect((await test.http().delete(`/api/simulations/${job}`).set('Cookie', cookie)).status).toBe(204)
      }
    } finally {
      create.mockRestore()
    }
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

  it('priority: higher goes first, ties use chunks left then age, and returning to normal restores the order', async () => {
    const make = async (to: number) => {
      const response = await post('/api/simulations').send({
        kind: 'compare',
        sideA: decks(2, 2),
        sideB: decks(5, to),
        gamesPerPair: 10,
        players: ['r', 'r'],
      })
      expect(response.status).toBe(201)
      expect(response.body.priority).toBe(0)
      return response.body.id as number
    }
    const ids = [await make(7), await make(6), await make(6), await make(5)]
    const [long, older, newer, normal] = ids as [number, number, number, number]
    try {
      for (const id of [long, older, newer]) {
        expect((await post(`/api/simulations/${id}/priority`).send({ priority: 1 })).body).toMatchObject({
          id,
          priority: 1,
          status: 'queued',
        })
      }
      expect((await claim('worker-priority')).body.chunk).toMatchObject({ jobId: older, idx: 0 })
      expect((await claim('worker-priority-2')).body.chunk).toMatchObject({ jobId: older, idx: 1 })
      expect((await claim('worker-priority-3')).body.chunk).toMatchObject({ jobId: newer, idx: 0 })
      expect((await post(`/api/simulations/${long}/priority`).send({ priority: 2 })).body.priority).toBe(2)
      expect((await claim('worker-priority-4')).body.chunk).toMatchObject({ jobId: long, idx: 0 })
      for (const id of [long, older, newer]) {
        expect((await post(`/api/simulations/${id}/priority`).send({ priority: 0 })).status).toBe(200)
      }
      expect((await claim('worker-priority-5')).body.chunk).toMatchObject({ jobId: normal, idx: 0 })
      expect((await get(`/api/simulations/${long}`)).body.priority).toBe(0)
      expect((await get('/api/simulations')).body.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: long, priority: 0 })]),
      )
    } finally {
      for (const id of ids) {
        await post(`/api/simulations/${id}/cancel`)
        await test.http().delete(`/api/simulations/${id}`).set('Cookie', cookie)
      }
    }
  })

  it.each(['lab', 'consistency', 'explore'] as const)(
    'priority: an advanced matrix waits for %s at normal priority (D-024)',
    async (kind) => {
      const ids: number[] = []
      try {
        const matrix = await post('/api/simulations').send({
          kind: 'matrix',
          sideA: decks(1, 2),
          gamesPerPair: 10,
          players: ['r', 'r'],
        })
        expect(matrix.status).toBe(201)
        ids.push(matrix.body.id)
        expect((await post(`/api/simulations/${matrix.body.id}/priority`).send({ priority: 10 })).status).toBe(200)
        const short =
          kind === 'consistency'
            ? await post('/api/simulations/consistency').send({ deckId: deckIds[1], games: 10 })
            : await post('/api/simulations').send({
                kind: 'compare',
                sideA: decks(3, 3),
                sideB: decks(5, 6),
                gamesPerPair: 10,
                players: ['r', 'r'],
              })
        expect(short.status).toBe(201)
        ids.push(short.body.id)
        // Queue fixtures isolate classification from laboratory round orchestration.
        if (kind !== 'consistency') {
          const job = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: short.body.id } })
          await test.prisma.simulationJob.update({
            where: { id: job.id },
            data: kind === 'explore' ? { kind: 'explore' } : { params: { ...(job.params as object), lab: {} } },
          })
        }
        const response = await bearer('post', '/api/worker/claim').send({
          ...worker(`worker-class-${kind}`),
          version: '0.2.0',
        })
        expect(response.status).toBe(200)
        expect(response.body.chunk).toMatchObject({ jobId: short.body.id })
        // Once the short job is cancelled, the matrix can be claimed.
        expect((await post(`/api/simulations/${short.body.id}/cancel`)).status).toBe(200)
        expect((await claim(`worker-class-${kind}-matrix`)).body.chunk).toMatchObject({ jobId: matrix.body.id })
      } finally {
        for (const id of ids) {
          await post(`/api/simulations/${id}/cancel`)
          await test.http().delete(`/api/simulations/${id}`).set('Cookie', cookie)
        }
      }
    },
  )

  it('priority: two matrices use priority before the number of remaining chunks (D-024)', async () => {
    const ids: number[] = []
    try {
      for (const to of [2, 3]) {
        const created = await post('/api/simulations').send({
          kind: 'matrix',
          sideA: decks(1, to),
          gamesPerPair: 10,
          players: ['r', 'r'],
        })
        expect(created.status).toBe(201)
        ids.push(created.body.id)
      }
      expect((await post(`/api/simulations/${ids[0]}/priority`).send({ priority: 1 })).status).toBe(200)
      expect((await post(`/api/simulations/${ids[1]}/priority`).send({ priority: 2 })).status).toBe(200)
      expect((await claim('worker-matrix-priority')).body.chunk).toMatchObject({ jobId: ids[1] })
      expect((await post(`/api/simulations/${ids[1]}/cancel`)).status).toBe(200)
      expect((await claim('worker-matrix-priority-next')).body.chunk).toMatchObject({ jobId: ids[0] })
    } finally {
      for (const id of ids) {
        await post(`/api/simulations/${id}/cancel`)
        await test.http().delete(`/api/simulations/${id}`).set('Cookie', cookie)
      }
    }
  })

  it('priority: validates the integer, requires a session, and rejects every finished status', async () => {
    const response = await post('/api/simulations').send({
      kind: 'compare',
      sideA: decks(2, 2),
      sideB: decks(5, 5),
      gamesPerPair: 10,
      players: ['r', 'r'],
    })
    const id = response.body.id as number
    try {
      expect((await test.http().post(`/api/simulations/${id}/priority`).send({ priority: 1 })).status).toBe(401)
      for (const priority of [-1, 1.5, '1', 2_147_483_648, null]) {
        expect((await post(`/api/simulations/${id}/priority`).send({ priority })).status).toBe(400)
      }
      for (const status of ['done', 'failed', 'cancelled'] as const) {
        await test.prisma.simulationJob.update({ where: { id }, data: { status } })
        const denied = await post(`/api/simulations/${id}/priority`).send({ priority: 1 })
        expect(denied.status).toBe(400)
        expect(denied.body.error.code).toBe('job_finished')
        expect((await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })).priority).toBe(0)
      }
      expect((await post('/api/simulations/2147483647/priority').send({ priority: 1 })).status).toBe(404)
    } finally {
      await test.prisma.simulationJob.delete({ where: { id } })
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
    // With a limit of 20, a game won in 22 turns is refused: past the limit only a tie («L») or a game decided by a
    // knockout from the end of the last turn (21 turns) is (the turns still add up to the chunk's 60).
    expect(
      (await put({ ...result, extra: { perGame: { ...perGame, turnLimit: 20, turns: [22, 9, 21, 8] } } })).status,
    ).toBe(422)
    // Review of #108: a tie at the limit is one turn past it, never two (32 turns with deckgym's 30).
    expect(
      (await put({ ...result, turns: 61, extra: { perGame: { ...perGame, turns: [12, 9, 32, 8] } } })).status,
    ).toBe(422)
    // The worker that claims it again sends it right. Review of #108: with a game won in 31 turns, as a knockout from
    // the end of turn 30 settles it (job 42, chunk 32166).
    const again = (await hello('worker-0205', '0.2.5', '0.2.0')).body.chunk as Structured
    expect(again).toMatchObject({ chunkId: chunk.chunkId })
    const decidedLate = { ...perGame, turns: [31, 9, 31, 8] }
    expect((await put({ ...result, turns: 79, extra: { perGame: decidedLate } })).body).toEqual({ accepted: true })
    const stored = await test.prisma.simulationChunk.findUniqueOrThrow({ where: { id: Number(chunk.chunkId) } })
    expect(stored.extra).toMatchObject({ perGame: decidedLate, analysisGames: { version: 1 } })
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
    expect((await post(`/api/simulations/${matrix.body.id}/priority`).send({ priority: 10 })).status).toBe(200)
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

  it('H-051: a job with «et» goes only to workers whose engine lists «etBot»', async () => {
    const created = await post('/api/simulations').send({
      kind: 'compare',
      sideA: decks(3, 3),
      sideB: decks(5, 5),
      gamesPerPair: 4,
      players: ['et', 'r'],
      seed: 79,
    })
    expect(created.status).toBe(201)
    const claim = (id: string, engineFeatures: string[]) =>
      bearer('post', '/api/worker/claim').send({ ...worker(id), version: '0.3.1', cliVersion: '0.3.5', engineFeatures })
    // An engine before 0.3.5 answers «Invalid player code: et» and would fail the chunk three times: nothing, and
    // the hint says why.
    const old = (await claim('worker-et-old', ['perGame', 'batch', 'fairBots'])).body
    expect(old).toMatchObject({ chunk: null, hint: expect.stringContaining('«et»') })
    const fresh = (await claim('worker-et-new', ['perGame', 'batch', 'fairBots', 'etBot'])).body.chunk as Structured
    expect(fresh).toMatchObject({ jobId: created.body.id, players: ['et', 'r'] })
    await post(`/api/simulations/${created.body.id}/cancel`)
    await test.http().delete(`/api/simulations/${created.body.id}`).set('Cookie', cookie)
    // The same for an f bot (H-018): an engine without «fairBots» gets nothing, and the hint says why.
    const fair = await post('/api/simulations').send({
      kind: 'compare',
      sideA: decks(3, 3),
      sideB: decks(5, 5),
      gamesPerPair: 4,
      players: ['f2', 'r'],
      seed: 80,
    })
    const unfair = (await claim('worker-f-old', ['perGame', 'batch', 'etBot'])).body
    expect(unfair).toMatchObject({ chunk: null, hint: expect.stringContaining('bots f') })
    await post(`/api/simulations/${fair.body.id}/cancel`)
    await test.http().delete(`/api/simulations/${fair.body.id}`).set('Cookie', cookie)
  })

  it('«Reintentar lo que falló»: only the failed chunks, with the same seeds; the job ends «done» if they play well', async () => {
    const created = (
      await post('/api/simulations').send({
        kind: 'compare',
        sideA: decks(3, 3),
        sideB: decks(7, 8),
        gamesPerPair: 10,
        players: ['r', 'r'],
        cache: false,
      })
    ).body as { id: number }
    const chunks = await test.prisma.simulationChunk.findMany({ where: { jobId: created.id }, orderBy: { idx: 'asc' } })
    const [good, bad] = chunks as [(typeof chunks)[number], (typeof chunks)[number]]
    // Not failed yet: nothing to retry.
    expect((await post(`/api/simulations/${created.id}/retry-failed`)).body.error.code).toBe('job_not_failed')
    // One pairing played, the other failed three times: the job ends «failed».
    await test.prisma.simulationChunk.update({
      where: { id: good.id },
      data: { status: 'done', gamesDone: 10, winsA: 6, winsB: 4, ties: 0, finishedAt: new Date() },
    })
    await test.prisma.simulationChunk.update({
      where: { id: bad.id },
      data: {
        status: 'failed',
        attempt: 3,
        returns: 2,
        returnedBy: ['worker-android'],
        error: 'la partida con semilla 1 falló: Active Pokemon should be there',
      },
    })
    await test.app.get(WorkerQueueService).settle(created.id)
    expect((await get(`/api/simulations/${created.id}`)).body).toMatchObject({ status: 'failed' })

    const retried = await post(`/api/simulations/${created.id}/retry-failed`)
    expect(retried.status).toBe(200)
    expect(retried.body).toMatchObject({ status: 'running', error: null })
    expect(await test.prisma.simulationChunk.findUniqueOrThrow({ where: { id: bad.id } })).toMatchObject({
      status: 'queued',
      attempt: 0,
      returns: 0,
      returnedBy: [],
      error: null,
      seed: bad.seed,
    })
    expect((await test.prisma.simulationChunk.findUniqueOrThrow({ where: { id: good.id } })).status).toBe('done')
    // A second click while it plays: nothing more.
    expect((await post(`/api/simulations/${created.id}/retry-failed`)).body.error.code).toBe('job_not_failed')
    // This time it plays well: the job ends «done».
    const chunk = (await claim()).body.chunk as Structured
    expect(chunk).toMatchObject({ jobId: created.id, chunkId: bad.id, seed: bad.seed.toString() })
    const sent = await bearer('put', `/api/worker/chunks/${bad.id}/result`).send({
      workerId: 'worker-0001',
      engineRev: test.env.engineRev,
      winsA: 5,
      winsB: 5,
      ties: 0,
      games: 10,
      durationMs: 100,
    })
    expect(sent.body).toEqual({ accepted: true })
    expect((await get(`/api/simulations/${created.id}`)).body).toMatchObject({ status: 'done', error: null })

    // Not for a job of another deckgym (it is played again whole) nor for a Laboratorio search.
    await test.prisma.simulationJob.update({
      where: { id: created.id },
      data: { status: 'failed', engineRev: 'b'.repeat(40) },
    })
    expect((await post(`/api/simulations/${created.id}/retry-failed`)).body.error.code).toBe('other_engine')
    await test.prisma.simulationJob.update({
      where: { id: created.id },
      data: { engineRev: test.env.engineRev, kind: 'explore' },
    })
    expect((await post(`/api/simulations/${created.id}/retry-failed`)).body.error.code).toBe('explore')
    // Nor for a job fixed to a games revision the workers left: the engine change would play it again whole. The
    // detail says why, and the screen hides the button.
    await test.prisma.simulationJob.update({ where: { id: created.id }, data: { kind: 'compare', gamesRev: 1 } })
    await test.prisma.workerNode.upsert({
      where: { id: 'worker-retry-rev2' },
      create: { id: 'worker-retry-rev2', name: 'pc', engineRev: test.env.engineRev, gamesRev: 2 },
      update: { lastSeenAt: new Date(), gamesRev: 2 },
    })
    expect((await post(`/api/simulations/${created.id}/retry-failed`)).body.error.code).toBe('other_games_rev')
    expect((await get(`/api/simulations/${created.id}`)).body.retryBlocked).toMatch(/revisión 1 .*repetila entera/)
    await test.prisma.workerNode.delete({ where: { id: 'worker-retry-rev2' } })
    // «Falló» with nothing failed left (a good result came late) and archived: it comes back to the list and is just
    // «terminada» again.
    await test.prisma.simulationJob.update({
      where: { id: created.id },
      data: { gamesRev: null, archivedAt: new Date() },
    })
    expect((await get(`/api/simulations/${created.id}`)).body.retryBlocked).toBeNull()
    const healed = await post(`/api/simulations/${created.id}/retry-failed`)
    expect(healed.status).toBe(200)
    expect(healed.body).toMatchObject({ status: 'done', archived: false })
    await test.prisma.simulationJob.delete({ where: { id: created.id } })
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

  it('phase 42: a chunk that would play exactly what a finished one played takes its result, with its replays', async () => {
    const hello = { ...worker('worker-cache'), cliVersion: '0.3.4' }
    const engine = '0.3.4+0123456789abcdef'
    const job = (overrides: Structured = {}) =>
      post('/api/simulations').send({
        kind: 'compare',
        sideA: decks(2, 2),
        sideB: decks(5, 6),
        gamesPerPair: 10,
        players: ['r', 'r'],
        seed: 4242,
        replaySample: 1,
        ...overrides,
      })
    const play = async (jobId: number, cliVersion: string | undefined, wins: (n: number) => number) => {
      const played = new Map<number, number>()
      for (;;) {
        const chunk = (await bearer('post', '/api/worker/claim').send(hello)).body.chunk as Structured | null
        if (!chunk) break
        expect(chunk.jobId).toBe(jobId)
        played.set(chunk.chunkId as number, wins(played.size))
        await bearer(
          'put',
          `/api/worker/chunks/${chunk.chunkId}/replays/00000000-0000-0000-0000-00000000000${played.size}`,
        )
          .query({ index: 0, seed: '42', winner: 'a' })
          .set('Content-Type', 'application/gzip')
          .send(gzipSync(JSON.stringify({ version: 1, steps: [], outcome: { Win: 0 } })))
        await bearer('put', `/api/worker/chunks/${chunk.chunkId}/result`).send({
          workerId: 'worker-cache',
          engineRev: test.env.engineRev,
          ...(cliVersion ? { cliVersion } : {}),
          winsA: played.get(chunk.chunkId as number),
          winsB: 10 - (played.get(chunk.chunkId as number) as number),
          ties: 0,
          games: 10,
          durationMs: 500,
        })
      }
      return played
    }
    // An engine that does not name its build in the exact form (an old engine, a dev build): its results are taken,
    // never turned down (the chunk would be played forever), but they are never a source.
    const unstamped = (await job({ seed: 4241 })).body as { id: number }
    await play(unstamped.id, '0.3.4-dev', (n) => 3 + n)
    expect((await get(`/api/simulations/${unstamped.id}`)).body.status).toBe('done')
    expect((await job({ seed: 4241 })).body.status).toBe('queued')
    for (const id of (await test.prisma.simulationJob.findMany({ where: { id: { gt: unstamped.id } } })).map(
      (row) => row.id,
    )) {
      await post(`/api/simulations/${id}/cancel`)
    }

    const first = (await job()).body as { id: number }
    const played = await play(first.id, engine, (n) => 3 + n)
    expect(played.size).toBe(2)
    const rivalDeck = Number(deckIds[4])
    const simulations = test.app.get(SimulationsService)
    const columnBefore = await simulations.deckColumn(rivalDeck)
    const gamesBefore = (await get('/api/simulations/analysis')).body.summary.games as number
    const replaysBefore = await test.prisma.simulationReplay.count()

    // The same job again: done at once, every chunk from the cache, with the same results and replays.
    const again = (await job()).body as { id: number; status: string; progress: Structured }
    expect(again).toMatchObject({ status: 'done', progress: { gamesDone: 20, chunks: { done: 2 } } })
    expect((await bearer('post', '/api/worker/claim').send(hello)).body.chunk).toBeNull()
    const copied = (await get(`/api/simulations/${again.id}`)).body as {
      chunks: { id: number; cachedFrom: number | null }[]
      rows: { total: Structured }[]
      replays: { chunkId: number; gameIndex: number }[]
    }
    expect(copied.chunks.map((chunk) => chunk.cachedFrom).sort()).toEqual([...played.keys()].sort())
    expect(copied.rows[0]?.total).toEqual({ wins: 7, losses: 13, ties: 0 })
    // The replays are the source's, shown under the copy: none is stored twice.
    expect(copied.replays.map((replay) => replay.gameIndex)).toEqual([0, 0])
    expect(copied.replays.map((replay) => replay.chunkId).sort()).toEqual(copied.chunks.map((chunk) => chunk.id).sort())
    expect(await test.prisma.simulationReplay.count()).toBe(replaysBefore)
    const third = (await job()).body as { id: number; status: string }
    expect(third.status).toBe('done')
    const thirdChunks = (await get(`/api/simulations/${third.id}`)).body.chunks as { cachedFrom: number }[]
    expect(thirdChunks.map((chunk) => chunk.cachedFrom).sort()).toEqual([...played.keys()].sort())
    // The copies are the same games: neither the rival's «simulación» column nor the analysis counts them again.
    expect(await simulations.deckColumn(rivalDeck)).toEqual(columnBefore)
    const analysis = (await get('/api/simulations/analysis')).body.summary as { games: number; cachedGames: number }
    expect(analysis).toMatchObject({ games: gamesBefore, cachedGames: 40 })

    // Never from what an engine change kept apart, nor from a games revision older than the newest of the workers
    // (review of #68: a job played again whole would take its old results back).
    const playedJob = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: first.id } })
    for (const change of [
      // The copies are never sources (cachedFrom): only the job a worker played can be.
      { params: { ...(playedJob.params as object), replacedBy: again.id } },
      { gamesRev: (playedJob.gamesRev ?? 1) - 1 },
    ]) {
      await test.prisma.simulationJob.updateMany({
        where: { id: first.id },
        data: change,
      })
      const blocked = (await job()).body as { id: number; status: string }
      expect(blocked.status).toBe('queued')
      await post(`/api/simulations/${blocked.id}/cancel`)
      expect((await test.http().delete(`/api/simulations/${blocked.id}`).set('Cookie', cookie)).status).toBe(204)
      await test.prisma.simulationJob.updateMany({
        where: { id: first.id },
        data: { params: playedJob.params as object, gamesRev: playedJob.gamesRev },
      })
    }

    // Anything else and it goes to the worker: another seed, other bots, more replays, per-game results, or asking
    // for a real repeat.
    const others = [
      await job({ seed: 4243 }),
      await job({ players: ['r', 'w'] }),
      await job({ replaySample: 2 }),
      await job({ perGame: true }),
      await job({ cache: false }),
    ]
    for (const other of others) {
      expect(other.body.status).toBe('queued')
      expect(other.body.progress).toMatchObject({ chunks: { done: 0 } })
    }
    // Two engines among the recent results: which one would play is not known, nothing is copied.
    const otherChunk = (await bearer('post', '/api/worker/claim').send(hello)).body.chunk as Structured
    await bearer('put', `/api/worker/chunks/${otherChunk.chunkId}/result`).send({
      workerId: 'worker-cache',
      engineRev: test.env.engineRev,
      cliVersion: '0.3.4+fedcba9876543210',
      winsA: 5,
      winsB: 5,
      ties: 0,
      games: 10,
      durationMs: 500,
    })
    expect((await job()).body.status).toBe('queued')

    // When the original goes, the oldest copy takes its place (and its replays); the other copies point to it.
    const columnBeforeDelete = await simulations.deckColumn(rivalDeck)
    expect((await test.http().delete(`/api/simulations/${first.id}`).set('Cookie', cookie)).status).toBe(204)
    const heir = (await get(`/api/simulations/${again.id}`)).body as typeof copied
    expect(heir.chunks.every((chunk) => chunk.cachedFrom === null)).toBe(true)
    expect(heir.replays).toHaveLength(2)
    const after = (await get(`/api/simulations/${third.id}`)).body as typeof copied
    expect(after.chunks.map((chunk) => chunk.cachedFrom).sort()).toEqual(heir.chunks.map((chunk) => chunk.id).sort())
    expect(after.replays).toHaveLength(2)
    expect(await simulations.deckColumn(rivalDeck)).toEqual(columnBeforeDelete)

    // The cache is optional: a copy that fails leaves the chunks to the workers and the job is still created.
    const original = test.prisma.$transaction.bind(test.prisma)
    let calls = 0
    const failing = vi.spyOn(test.prisma, '$transaction').mockImplementation(((
      ...args: Parameters<typeof original>
    ) => {
      calls++
      return calls === 2 ? Promise.reject(new Error('timeout')) : original(...args)
    }) as typeof original)
    try {
      const created = await job()
      expect(created.status).toBe(201)
      expect(created.body.status).toBe('queued')
    } finally {
      failing.mockRestore()
    }

    for (const id of (await test.prisma.simulationJob.findMany({ where: { id: { gt: unstamped.id } } })).map(
      (row) => row.id,
    )) {
      await post(`/api/simulations/${id}/cancel`)
    }
    for (const id of (await test.prisma.simulationJob.findMany({ where: { id: { gte: unstamped.id } } })).map(
      (row) => row.id,
    )) {
      expect((await test.http().delete(`/api/simulations/${id}`).set('Cookie', cookie)).status).toBe(204)
    }
  })

  it('phase 42: after a deckgym update the old jobs move to the new engine, the played ones whole; a search waits', async () => {
    await test.prisma.workerNode.upsert({
      where: { id: 'worker-engine' },
      create: { id: 'worker-engine', name: 'pc', engineRev: test.env.engineRev, cliVersion: '0.1.0', cores: 2 },
      update: {},
    })
    const old = 'a'.repeat(40)
    const simulations = test.app.get(SimulationsService)
    const rivalDeck = Number(deckIds[4])
    const columnBefore = await simulations.deckColumn(rivalDeck)
    // A comparison with one pairing played (and its replay) and the other in a worker's hands.
    const played = (
      await post('/api/simulations').send({
        kind: 'compare',
        sideA: decks(2, 2),
        sideB: decks(5, 6),
        gamesPerPair: 10,
        players: ['r', 'r'],
        replaySample: 1,
      })
    ).body as { id: number }
    const first = (await claim('worker-engine')).body.chunk as Structured
    await bearer('put', `/api/worker/chunks/${first.chunkId}/replays/00000000-0000-0000-0000-0000000000aa`)
      .query({ index: 0, seed: '7', winner: 'a' })
      .set('Content-Type', 'application/gzip')
      .send(gzipSync(JSON.stringify({ version: 1, steps: [], outcome: { Win: 0 } })))
    await bearer('put', `/api/worker/chunks/${first.chunkId}/result`).send({
      workerId: 'worker-engine',
      engineRev: test.env.engineRev,
      winsA: 6,
      winsB: 4,
      ties: 0,
      games: 10,
      durationMs: 100,
    })
    const second = (await claim('worker-engine')).body.chunk as Structured
    expect(second.jobId).toBe(played.id)
    // Its worker already uploaded a replay, before its result: the engine change drops it with the lease.
    await bearer('put', `/api/worker/chunks/${second.chunkId}/replays/00000000-0000-0000-0000-0000000000ab`)
      .query({ index: 0, seed: '8', winner: 'b' })
      .set('Content-Type', 'application/gzip')
      .send(gzipSync(JSON.stringify({ version: 1, steps: [], outcome: { Win: 1 } })))
    // A matrix with nothing played, a Laboratorio search and a game against the bot waiting for the owner.
    const fresh = (
      await post('/api/simulations').send({ kind: 'matrix', sideA: decks(2, 4), gamesPerPair: 10, players: ['r', 'r'] })
    ).body as { id: number }
    const search = await test.prisma.simulationJob.create({
      data: {
        kind: 'explore',
        status: 'running',
        label: 'Explorar el 2',
        params: {},
        engineRev: old,
        players: ['e2', 'e2'],
        gamesPerPair: 60,
        baseSeed: 1n,
        totalGames: 0,
      },
    })
    const [snapshotA, snapshotB] = (await get(`/api/simulations/${played.id}`)).body.sideB as number[]
    const game = await test.prisma.liveGame.create({
      data: {
        humanSnapshotId: snapshotA as number,
        botSnapshotId: snapshotB as number,
        bot: 'e2',
        seed: 5n,
        engineRev: old,
        status: 'waiting',
        choices: [1, 0],
        decision: { ply: 2, turn: 1, state: {}, actions: [] },
      },
    })
    // The comparison and the matrix were queued with the engine that is now the old one.
    await test.prisma.simulationJob.updateMany({
      where: { id: { in: [played.id, fresh.id] } },
      data: { engineRev: old },
    })

    // A copy of the chunk in a worker's hands, of the old engine too (review of #73).
    await test.prisma.simulationChunk.update({
      where: { id: second.chunkId as number },
      data: { copyWorker: 'worker-copy-old', copyUntil: new Date(Date.now() + 60_000), copySince: new Date() },
    })
    const engine = test.app.get(EngineChangeService)
    const moved = await engine.moveJobs()
    expect(moved).toEqual({ moved: [fresh.id], replayed: [played.id] })
    expect(
      await test.prisma.simulationChunk.findUniqueOrThrow({ where: { id: second.chunkId as number } }),
    ).toMatchObject({
      copyWorker: null,
      copyUntil: null,
    })
    // What the old engine played is not counted next to what the new one plays: the decks' column leaves it out.
    expect(await simulations.deckColumn(rivalDeck)).toEqual(columnBefore)
    type Detail = {
      status: string
      label: string
      engineRev: string
      engineChange: { oldResults: number } & Structured
      chunks: { status: string; gamesDone: number; seed: string }[]
      replays: unknown[]
      rows: { total: Structured }[]
    }
    const again = (await get(`/api/simulations/${played.id}`)).body as Detail
    expect(again).toMatchObject({
      status: 'queued',
      engineRev: test.env.engineRev,
      engineChange: { from: old, replayed: true, gamesFrom: null, oldResults: expect.any(Number) },
      replays: [],
    })
    expect(again.chunks.map((chunk) => [chunk.status, chunk.gamesDone])).toEqual([
      ['queued', 0],
      ['queued', 0],
    ])
    // What the old engine played is kept apart, in a cancelled job named after it, with its replay and its seeds.
    const kept = (await get(`/api/simulations/${again.engineChange.oldResults}`)).body as Detail
    expect(kept).toMatchObject({ status: 'cancelled', engineRev: old, engineChange: null })
    expect(kept.label).toMatch(/ \(motor aaaaaaa\)$/)
    expect(kept.chunks.map((chunk) => [chunk.status, chunk.gamesDone])).toEqual([['done', 10]])
    expect(kept.replays).toHaveLength(1)
    expect(again.chunks.map((chunk) => chunk.seed)).toContain(kept.chunks[0]?.seed)
    expect((await get(`/api/simulations/${fresh.id}`)).body).toMatchObject({
      engineRev: test.env.engineRev,
      engineChange: { from: old, replayed: false, oldResults: null },
    })
    // The worker of the old engine is told its chunk is gone, and its late result is turned down.
    const beat = await bearer('put', `/api/worker/chunks/${second.chunkId}/heartbeat`).send({
      workerId: 'worker-engine',
      gamesDone: 5,
    })
    expect(beat.body).toMatchObject({ lost: true })
    const late = await bearer('put', `/api/worker/chunks/${second.chunkId}/result`).send({
      workerId: 'worker-engine',
      engineRev: old,
      winsA: 5,
      winsB: 5,
      ties: 0,
      games: 10,
      durationMs: 100,
    })
    expect(late.body).toEqual({ accepted: false })
    // The search keeps its engine and the alert says it waits.
    expect((await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: search.id } })).engineRev).toBe(old)
    const alerts = (await get('/api/alerts')).body.items as { code: string; title: string; link: string }[]
    expect(alerts.find((alert) => alert.code === 'search_old_engine')).toMatchObject({
      title: `La búsqueda «Explorar el 2» (#${search.id}) espera el motor viejo`,
      link: `/laboratorio/${search.id}`,
    })
    // Claude reads it too.
    const listed = await test.app.get(SimulationsService).progressOf(String(played.id))
    expect(jobSummaryJson(listed)).toMatchObject({
      engineChange: `Rejugada entera con este motor (antes deckgym aaaaaaa): lo jugado con el viejo quedó aparte, en la simulación cancelada #${again.engineChange.oldResults}. Sus números son solo del motor de ahora.`,
    })

    // The game against the bot cannot go on the same way: it ends, not lost and not abandoned, with what was played.
    const lives = test.app.get(LiveGamesService)
    expect(await lives.endForEngineChange({ deckgym: true })).toEqual([game.id])
    expect(await test.prisma.liveGame.findUniqueOrThrow({ where: { id: game.id } })).toMatchObject({
      status: 'engine_changed',
      engineRev: old,
      decision: null,
      choices: [1, 0],
      winner: null,
      finishedAt: expect.any(Date),
      error: expect.stringMatching(/^Cambió el motor y esta partida no se puede seguir igual/),
    })
    expect((await get(`/api/play/${game.id}`)).body).toMatchObject({ status: 'engine_changed' })

    // A job cancelled meanwhile is left as it is: the replay locks the job and checks it again.
    await post(`/api/simulations/${fresh.id}/cancel`)
    const replayWhole = (
      engine as unknown as { replayWhole(id: number, to: object): Promise<unknown> }
    ).replayWhole.bind(engine)
    expect(await replayWhole(fresh.id, { from: test.env.engineRev, to: old })).toBeNull()
    expect(await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: fresh.id } })).toMatchObject({
      status: 'cancelled',
      engineRev: test.env.engineRev,
    })

    await test.prisma.liveGame.delete({ where: { id: game.id } })
    await test.prisma.simulationJob.delete({ where: { id: search.id } })
    expect(
      (await test.http().delete(`/api/simulations/${again.engineChange.oldResults}`).set('Cookie', cookie)).status,
    ).toBe(204)
    for (const id of [played.id, fresh.id]) {
      await post(`/api/simulations/${id}/cancel`)
      expect((await test.http().delete(`/api/simulations/${id}`).set('Cookie', cookie)).status).toBe(204)
    }
  })

  it('phase 42: a job is played whole with one games revision, and again whole when no worker has it any more', async () => {
    const hello = (id: string, gamesRev: number) => ({ ...worker(id), cliVersion: '0.3.6', gamesRev })
    const claimAs = (id: string, gamesRev: number) => bearer('post', '/api/worker/claim').send(hello(id, gamesRev))
    const result = (chunkId: unknown, workerId: string, gamesRev: number) =>
      bearer('put', `/api/worker/chunks/${chunkId}/result`).send({
        workerId,
        engineRev: test.env.engineRev,
        cliVersion: '0.3.6',
        gamesRev,
        winsA: 6,
        winsB: 4,
        ties: 0,
        games: 10,
        durationMs: 100,
      })
    const created = (
      await post('/api/simulations').send({
        kind: 'compare',
        sideA: decks(3, 3),
        sideB: decks(7, 8),
        gamesPerPair: 10,
        players: ['r', 'r'],
        cache: false,
      })
    ).body as { id: number }
    const gamesRevOfJob = async (id: number) =>
      (await test.prisma.simulationJob.findUniqueOrThrow({ where: { id } })).gamesRev

    // Nothing played: any worker takes it. The first result fixes how the whole job is played.
    expect(await gamesRevOfJob(created.id)).toBeNull()
    const first = (await claimAs('worker-rev-1', 1)).body.chunk as Structured
    expect(first.jobId).toBe(created.id)
    expect((await result(first.chunkId, 'worker-rev-1', 1)).body).toEqual({ accepted: true })
    expect(await gamesRevOfJob(created.id)).toBe(1)
    // A worker that plays otherwise does not get the rest…
    expect((await claimAs('worker-rev-2', 2)).body.chunk).toBeNull()
    // …and a result played otherwise (a worker that updated itself meanwhile) is turned down, the chunk back in the queue.
    const second = (await claimAs('worker-rev-1', 1)).body.chunk as Structured
    expect(second.jobId).toBe(created.id)
    expect((await result(second.chunkId, 'worker-rev-1', 2)).body).toEqual({ accepted: false })
    expect(
      await test.prisma.simulationChunk.findUniqueOrThrow({ where: { id: second.chunkId as number } }),
    ).toMatchObject({ status: 'queued', workerId: null })

    // A game against the bot fixed to revision 1 and waiting for a worker, another one a worker still holds, and a
    // Laboratorio search fixed to revision 1.
    const [snapshotA, snapshotB] = (await get(`/api/simulations/${created.id}`)).body.sideB as number[]
    const live = (status: 'queued' | 'running', leased: boolean) =>
      test.prisma.liveGame.create({
        data: {
          humanSnapshotId: snapshotA as number,
          botSnapshotId: snapshotB as number,
          bot: 'r',
          seed: 9n,
          engineRev: test.env.engineRev,
          gamesRev: 1,
          status,
          choices: [0],
          ...(leased ? { workerId: 'worker-rev-1', leaseUntil: new Date(Date.now() + 60_000) } : {}),
        },
      })
    const waiting = await live('queued', false)
    const held = await live('running', true)
    const search = await test.prisma.simulationJob.create({
      data: {
        kind: 'explore',
        status: 'running',
        label: 'Explorar el 3',
        params: {},
        engineRev: test.env.engineRev,
        gamesRev: 1,
        players: ['r', 'r'],
        gamesPerPair: 10,
        baseSeed: 1n,
        totalGames: 0,
      },
    })
    const searchAlert = async () =>
      ((await get('/api/alerts')).body.items as { code: string; title: string }[]).find(
        (alert) => alert.code === 'search_old_engine' && alert.title.includes(`#${search.id}`),
      )

    // While the worker of revision 1 is around, nothing changes.
    const engine = test.app.get(EngineChangeService)
    expect(await engine.releaseGoneGamesRevs()).toEqual({ moved: [], replayed: [] })
    expect(await searchAlert()).toBeUndefined()
    // Half an hour without it, and a worker of revision 2 there: the job is played again whole, with the same seeds;
    // what revision 1 played is kept apart.
    const seeds = (await test.prisma.simulationChunk.findMany({ where: { jobId: created.id } })).map((c) => c.seed)
    await test.prisma.workerNode.updateMany({
      where: { gamesRev: 1 },
      data: { lastSeenAt: new Date(Date.now() - GAMES_REV_GONE_MS - 60_000) },
    })
    // Only workers of an older revision around (engines before 0.3.3): a job never moves back (review of #68).
    await test.prisma.workerNode.update({
      where: { id: 'worker-rev-2' },
      data: { lastSeenAt: new Date(Date.now() - GAMES_REV_GONE_MS - 60_000) },
    })
    expect(await engine.releaseGoneGamesRevs()).toEqual({ moved: [], replayed: [] })
    // Nor does the alert say the search waits for nothing: it would go on alone.
    expect(await searchAlert()).toBeUndefined()
    await test.prisma.workerNode.update({ where: { id: 'worker-rev-2' }, data: { lastSeenAt: new Date() } })
    // Returns of a lost result (worker 0.3.4) were of the other engine: they start over with the replay (review of #72).
    await test.prisma.simulationChunk.updateMany({
      where: { jobId: created.id },
      data: { returns: 2, returnedBy: ['worker-rev-1'] },
    })
    expect(await engine.releaseGoneGamesRevs()).toEqual({ moved: [], replayed: [created.id] })
    expect(
      (await test.prisma.simulationChunk.findMany({ where: { jobId: created.id } })).map((chunk) => [
        chunk.returns,
        chunk.returnedBy,
      ]),
    ).toEqual([
      [0, []],
      [0, []],
    ])
    const job = (await get(`/api/simulations/${created.id}`)).body as {
      status: string
      engineChange: { oldResults: number } & Structured
      chunks: { status: string; seed: string }[]
    }
    expect(job).toMatchObject({
      status: 'queued',
      engineChange: { from: test.env.engineRev, gamesFrom: 1, gamesTo: 2, replayed: true },
    })
    expect(job.chunks.map((chunk) => chunk.status)).toEqual(['queued', 'queued'])
    expect(job.chunks.map((chunk) => chunk.seed).sort()).toEqual(seeds.map(String).sort())
    // Fixed to the new revision at once: a late result of the old one is turned down (review of #68).
    expect(await gamesRevOfJob(created.id)).toBe(2)
    expect((await result(second.chunkId, 'worker-rev-1', 1)).body).toEqual({ accepted: false })
    // And the cache does not copy back what the old revision played (the kept job, or any job of revision 1).
    expect(await test.app.get(ChunkCacheService).fill(created.id)).toBe(0)
    const kept = (await get(`/api/simulations/${job.engineChange.oldResults}`)).body as {
      label: string
      status: string
    }
    expect(kept.status).toBe('cancelled')
    expect(kept.label).toMatch(/ \(revisión 1\)$/)
    expect(await gamesRevOfJob(job.engineChange.oldResults)).toBe(1)
    expect(jobSummaryJson(await test.app.get(SimulationsService).progressOf(String(created.id)))).toMatchObject({
      engineChange: expect.stringMatching(/^Rejugada entera con la revisión 2 del motor \(antes la revisión 1\)/),
    })
    // Now the worker of revision 2 plays it, and fixes it again.
    const replay = (await claimAs('worker-rev-2', 2)).body.chunk as Structured
    expect(replay.jobId).toBe(created.id)
    expect((await result(replay.chunkId, 'worker-rev-2', 2)).body).toEqual({ accepted: true })
    expect(await gamesRevOfJob(created.id)).toBe(2)

    // The search is not replayed (its rounds depend on what it played): an alert says it waits.
    expect(await searchAlert()).toMatchObject({
      title: `La búsqueda «Explorar el 3» (#${search.id}) espera la revisión 1 del motor`,
    })
    // The game nobody holds ends when a worker of revision 2 asks for one; the one still held goes on.
    const lives = test.app.get(LiveGamesService)
    const pollMs = lives.longPollMs
    lives.longPollMs = 100
    try {
      const asked = await lives.claim({
        workerId: 'worker-rev-2',
        engineRev: test.env.engineRev,
        version: '0.3.3',
        cliVersion: '0.3.6',
        gamesRev: 2,
      })
      expect(asked.game).toBeNull()
    } finally {
      lives.longPollMs = pollMs
    }
    expect(await test.prisma.liveGame.findUniqueOrThrow({ where: { id: waiting.id } })).toMatchObject({
      status: 'engine_changed',
      finishedAt: expect.any(Date),
    })
    expect((await test.prisma.liveGame.findUniqueOrThrow({ where: { id: held.id } })).status).toBe('running')

    await test.prisma.liveGame.deleteMany({ where: { id: { in: [waiting.id, held.id] } } })
    await test.prisma.simulationJob.delete({ where: { id: search.id } })
    await post(`/api/simulations/${created.id}/cancel`)
    for (const id of [created.id, job.engineChange.oldResults]) {
      expect((await test.http().delete(`/api/simulations/${id}`).set('Cookie', cookie)).status).toBe(204)
    }
  })

  it('phase 42: a job running at the deploy, with results of engine-cli 0.3.4 and 0.3.5, goes on without being replayed', async () => {
    // A calibration as it is at the deploy: two pairings played by 0.3.4 and 0.3.5, two waiting, no games revision
    // yet (the migration adds the column empty).
    const created = (
      await post('/api/simulations').send({
        kind: 'compare',
        sideA: decks(3, 3),
        sideB: decks(7, 10),
        gamesPerPair: 10,
        players: ['r', 'r'],
        cache: false,
      })
    ).body as { id: number }
    const chunks = await test.prisma.simulationChunk.findMany({ where: { jobId: created.id }, orderBy: { idx: 'asc' } })
    expect(chunks).toHaveLength(4)
    for (const [at, cliVersion] of ['0.3.4+aaaaaaaaaaaaaaaa', '0.3.5+bbbbbbbbbbbbbbbb'].entries()) {
      await test.prisma.simulationChunk.update({
        where: { id: chunks[at]?.id as number },
        data: { status: 'done', gamesDone: 10, winsA: 5, winsB: 5, ties: 0, cliVersion, finishedAt: new Date() },
      })
    }
    await test.prisma.simulationJob.update({
      where: { id: created.id },
      data: { status: 'running', startedAt: new Date() },
    })
    expect(await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      gamesRev: null,
    })
    const engine = test.app.get(EngineChangeService)
    // The API starts again with the same deckgym: nothing moves.
    expect(await engine.moveJobs()).toEqual({ moved: [], replayed: [] })
    // A worker that has not updated itself yet (engine 0.3.5, which does not say its games revision) and one that
    // has (0.3.6, games revision 1) play the rest of it: the two play the same way.
    const result = (chunkId: unknown, workerId: string, extra: Structured) =>
      bearer('put', `/api/worker/chunks/${chunkId}/result`).send({
        workerId,
        engineRev: test.env.engineRev,
        winsA: 6,
        winsB: 4,
        ties: 0,
        games: 10,
        durationMs: 100,
        ...extra,
      })
    const features = ['perGame', 'batch', 'fairBots', 'etBot']
    const old = { ...worker('worker-deploy-old'), version: '0.3.2', cliVersion: '0.3.5', engineFeatures: features }
    const fresh = { ...worker('worker-deploy-new'), version: '0.3.3', cliVersion: '0.3.6', engineFeatures: features }
    const third = (await bearer('post', '/api/worker/claim').send(old)).body.chunk as Structured
    expect(third).toMatchObject({ jobId: created.id, chunkId: chunks[2]?.id })
    expect((await result(third.chunkId, old.workerId, { cliVersion: '0.3.5+bbbbbbbbbbbbbbbb' })).body).toEqual({
      accepted: true,
    })
    expect((await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: created.id } })).gamesRev).toBe(1)
    const fourth = (await bearer('post', '/api/worker/claim').send({ ...fresh, gamesRev: 1 })).body.chunk as Structured
    expect(fourth).toMatchObject({ jobId: created.id, chunkId: chunks[3]?.id })
    expect(
      (await result(fourth.chunkId, fresh.workerId, { cliVersion: '0.3.6+cccccccccccccccc', gamesRev: 1 })).body,
    ).toEqual({ accepted: true })
    // The sweep finds nothing to let go of, and the job ends with its four pairings, none played again.
    expect(await engine.releaseGoneGamesRevs()).toEqual({ moved: [], replayed: [] })
    const job = (await get(`/api/simulations/${created.id}`)).body as {
      status: string
      engineChange: unknown
      chunks: { id: number; status: string }[]
    }
    expect(job).toMatchObject({ status: 'done', engineChange: null })
    expect(job.chunks.map((chunk) => [chunk.id, chunk.status])).toEqual(chunks.map((chunk) => [chunk.id, 'done']))
    expect((await test.http().delete(`/api/simulations/${created.id}`).set('Cookie', cookie)).status).toBe(204)
  })

  it('phase 42: one revision per job under concurrent results, what an old worker played read from its hello, and the backfill', async () => {
    const rev = test.env.engineRev
    // Two results of two revisions at once, for a job not fixed yet: one goes in and fixes it, the other is turned down.
    const created = (
      await post('/api/simulations').send({
        kind: 'compare',
        sideA: decks(3, 3),
        sideB: decks(7, 8),
        gamesPerPair: 10,
        players: ['r', 'r'],
        cache: false,
      })
    ).body as { id: number }
    const chunks = await test.prisma.simulationChunk.findMany({ where: { jobId: created.id }, orderBy: { idx: 'asc' } })
    for (const [at, workerId] of ['worker-race-1', 'worker-race-2'].entries()) {
      await test.prisma.workerNode.upsert({
        where: { id: workerId },
        create: { id: workerId, name: 'pc', engineRev: rev, cores: 2 },
        update: {},
      })
      await test.prisma.simulationChunk.update({
        where: { id: chunks[at]?.id as number },
        data: { status: 'leased', workerId, leaseUntil: new Date(Date.now() + 60_000) },
      })
    }
    const send = (at: number, gamesRev: number) =>
      bearer('put', `/api/worker/chunks/${chunks[at]?.id}/result`).send({
        workerId: `worker-race-${at + 1}`,
        engineRev: rev,
        cliVersion: '0.3.6',
        gamesRev,
        winsA: 5,
        winsB: 5,
        ties: 0,
        games: 10,
        durationMs: 100,
      })
    const answers = (await Promise.all([send(0, 1), send(1, 2)])).map((response) => response.body.accepted)
    expect(answers.filter(Boolean)).toHaveLength(1)
    const fixed = (await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: created.id } })).gamesRev
    expect(fixed).toBe(answers[0] ? 1 : 2)
    // A result that does not say how its engine plays, from a worker nobody knows: a fixed job does not take it.
    const unknown = await bearer('put', `/api/worker/chunks/${chunks[answers[0] ? 1 : 0]?.id}/result`).send({
      workerId: 'worker-nobody-at-all',
      engineRev: rev,
      winsA: 5,
      winsB: 5,
      ties: 0,
      games: 10,
      durationMs: 100,
    })
    expect(unknown.body).toEqual({ accepted: false })
    await post(`/api/simulations/${created.id}/cancel`)
    expect((await test.http().delete(`/api/simulations/${created.id}`).set('Cookie', cookie)).status).toBe(204)

    // A result that does not say its engine (a consistency of worker 0.3.2), from a worker whose revision is empty right
    // after the migration: its engine's version says it plays as revision 1, not 0.
    await test.prisma.workerNode.upsert({
      where: { id: 'worker-old-0.3.2' },
      create: { id: 'worker-old-0.3.2', name: 'pc', engineRev: rev, cliVersion: '0.3.5', cores: 2, gamesRev: null },
      update: { cliVersion: '0.3.5', gamesRev: null, lastSeenAt: new Date() },
    })
    const quiet = (
      await post('/api/simulations').send({
        kind: 'compare',
        sideA: decks(3, 3),
        sideB: decks(7, 7),
        gamesPerPair: 10,
        players: ['r', 'r'],
        cache: false,
      })
    ).body as { id: number }
    const [lone] = await test.prisma.simulationChunk.findMany({ where: { jobId: quiet.id } })
    await test.prisma.simulationChunk.update({
      where: { id: lone?.id as number },
      data: { status: 'leased', workerId: 'worker-old-0.3.2', leaseUntil: new Date(Date.now() + 60_000) },
    })
    const silent = await bearer('put', `/api/worker/chunks/${lone?.id}/result`).send({
      workerId: 'worker-old-0.3.2',
      engineRev: rev,
      winsA: 5,
      winsB: 5,
      ties: 0,
      games: 10,
      durationMs: 100,
    })
    expect(silent.body).toEqual({ accepted: true })
    expect((await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: quiet.id } })).gamesRev).toBe(1)
    expect((await test.http().delete(`/api/simulations/${quiet.id}`).set('Cookie', cookie)).status).toBe(204)

    // A game against the bot asked for by worker 0.3.2 (no cliVersion): fixed to revision 1 from its hello, so its
    // update to 0.3.6 (revision 1 too) does not end it; a worker nobody knows takes only games not fixed and fixes none.
    const [snapshotA, snapshotB] = (
      await test.prisma.deckSnapshot.findMany({ take: 2, orderBy: { id: 'asc' }, select: { id: true } })
    ).map((row) => row.id)
    const lives = test.app.get(LiveGamesService)
    const pollMs = lives.longPollMs
    lives.longPollMs = 100
    try {
      const paused = await test.prisma.liveGame.create({
        data: {
          humanSnapshotId: snapshotA as number,
          botSnapshotId: snapshotB as number,
          bot: 'r',
          seed: 11n,
          engineRev: rev,
          status: 'queued',
          choices: [],
        },
      })
      const taken = await lives.claim({ workerId: 'worker-old-0.3.2', engineRev: rev, version: '0.3.2' })
      expect(taken.game?.id).toBe(paused.id)
      expect((await test.prisma.liveGame.findUniqueOrThrow({ where: { id: paused.id } })).gamesRev).toBe(1)
      // The worker updated itself and lets the game go; the new engine asks again.
      await test.prisma.liveGame.update({
        where: { id: paused.id },
        data: { status: 'queued', workerId: null, leaseUntil: null },
      })
      await test.prisma.workerNode.update({
        where: { id: 'worker-old-0.3.2' },
        data: { cliVersion: '0.3.6', gamesRev: 1 },
      })
      const again = await lives.claim({
        workerId: 'worker-old-0.3.2',
        engineRev: rev,
        version: '0.3.3',
        cliVersion: '0.3.6',
        gamesRev: 1,
      })
      expect(again.game?.id).toBe(paused.id)
      expect((await test.prisma.liveGame.findUniqueOrThrow({ where: { id: paused.id } })).status).toBe('running')
      const unknownGame = await test.prisma.liveGame.create({
        data: {
          humanSnapshotId: snapshotA as number,
          botSnapshotId: snapshotB as number,
          bot: 'r',
          seed: 12n,
          engineRev: rev,
          status: 'queued',
          choices: [],
        },
      })
      const stranger = await lives.claim({ workerId: 'worker-nobody-knows', engineRev: rev, version: '0.3.2' })
      expect(stranger.game?.id).toBe(unknownGame.id)
      expect((await test.prisma.liveGame.findUniqueOrThrow({ where: { id: unknownGame.id } })).gamesRev).toBeNull()
      await test.prisma.liveGame.deleteMany({ where: { id: { in: [paused.id, unknownGame.id] } } })
    } finally {
      lives.longPollMs = pollMs
    }

    // The migration's backfill (in a transaction that is undone): workers by their engine's version, and the jobs whose
    // finished chunks were all played by 0.3.3 or later, fixed to revision 1; anything else left empty.
    const migration = readFileSync(
      join(REPO_ROOT, 'apps/api/prisma/migrations/20261012000000_engine_games_rev/migration.sql'),
      'utf8',
    )
    const backfill = migration
      .slice(migration.indexOf('-- What already played'))
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.includes('UPDATE'))
    expect(backfill).toHaveLength(2)
    const job = (cliVersions: (string | null)[]) =>
      test.prisma.simulationJob.create({
        data: {
          kind: 'compare',
          status: 'running',
          label: 'relleno',
          params: {},
          engineRev: rev,
          players: ['r', 'r'],
          gamesPerPair: 10,
          baseSeed: 1n,
          totalGames: 10 * (cliVersions.length + 1),
          chunks: {
            create: [
              ...cliVersions.map((cliVersion, idx) => ({
                idx,
                games: 10,
                firstGame: idx * 10,
                seed: BigInt(idx + 1),
                status: 'done' as const,
                cliVersion,
              })),
              { idx: cliVersions.length, games: 10, firstGame: cliVersions.length * 10, seed: 99n },
            ],
          },
        },
      })
    const recent = await job(['0.3.4+aaaaaaaaaaaaaaaa', '0.3.5+bbbbbbbbbbbbbbbb'])
    const older = await job(['0.3.5+bbbbbbbbbbbbbbbb', '0.3.2'])
    const silentJob = await job([null])
    const untouched = await job([])
    for (const [id, cliVersion] of [
      ['mig-new', '0.3.5'],
      ['mig-old', '0.3.2'],
      ['mig-none', null],
    ] as const) {
      await test.prisma.workerNode.create({ data: { id, name: 'pc', engineRev: rev, cliVersion, gamesRev: null } })
    }
    const undone = new Error('undone')
    const seen = await test.prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`UPDATE "worker_nodes" SET "games_rev" = NULL WHERE "id" LIKE 'mig-%'`)
        for (const statement of backfill) await tx.$executeRawUnsafe(statement)
        const jobs = await tx.simulationJob.findMany({
          where: { id: { in: [recent.id, older.id, silentJob.id, untouched.id] } },
          select: { id: true, gamesRev: true },
        })
        const nodes = await tx.workerNode.findMany({
          where: { id: { startsWith: 'mig-' } },
          select: { id: true, gamesRev: true },
        })
        throw Object.assign(undone, { jobs, nodes })
      })
      .catch((error: unknown) => {
        if (error !== undone) throw error
        return error as Error & {
          jobs: { id: number; gamesRev: number | null }[]
          nodes: { id: string; gamesRev: number | null }[]
        }
      })
    const revOf = (id: number) => seen.jobs.find((row) => row.id === id)?.gamesRev
    expect([revOf(recent.id), revOf(older.id), revOf(silentJob.id), revOf(untouched.id)]).toEqual([1, null, null, null])
    expect(Object.fromEntries(seen.nodes.map((row) => [row.id, row.gamesRev]))).toEqual({
      'mig-new': 1,
      'mig-old': 0,
      'mig-none': null,
    })
    await test.prisma.simulationJob.deleteMany({ where: { label: 'relleno' } })
    await test.prisma.workerNode.deleteMany({ where: { id: { startsWith: 'mig-' } } })
  })

  it('phase 42, «repetir los últimos»: a faster worker copies the slow one at the end of a job; the first result counts', async () => {
    const make = async (games: number, perGame = false) =>
      (
        await post('/api/simulations').send({
          kind: 'compare',
          sideA: decks(3, 3),
          sideB: decks(7, 8),
          gamesPerPair: games,
          players: ['r', 'r'],
          cache: false,
          ...(perGame ? { perGame: true } : {}),
        })
      ).body as { id: number }
    const as = (id: string, extra: Structured = {}) =>
      bearer('post', '/api/worker/claim').send({ ...worker(id), ...extra })
    const result = (chunkId: unknown, workerId: string, durationMs = 50_000, extra: Structured = {}) =>
      bearer('put', `/api/worker/chunks/${chunkId}/result`).send({
        workerId,
        engineRev: test.env.engineRev,
        winsA: 600,
        winsB: 400,
        ties: 0,
        games: 1000,
        durationMs,
        ...extra,
      })
    const beat = (chunkId: unknown, workerId: string) =>
      bearer('put', `/api/worker/chunks/${chunkId}/heartbeat`).send({ workerId, gamesDone: 10 })
    const chunkRow = (chunkId: unknown) =>
      test.prisma.simulationChunk.findUniqueOrThrow({ where: { id: chunkId as number } })
    // The phone has played 100 of its 1.000 games in 10 minutes (6 s a game), past two rounds of its 2 cores.
    const slowDown = (chunkId: unknown) =>
      test.prisma.simulationChunk.update({
        where: { id: chunkId as number },
        data: { gamesDone: 100, leasedAt: new Date(Date.now() - 10 * 60 * 1000) },
      })
    // A job whose first pairing the PC played (50 ms a game) and whose second one the phone holds, slowly.
    const pcAndPhone = async () => {
      const job = await make(1000)
      const pc = (await as('worker-copy-pc')).body.chunk as Structured
      const phone = (await as('worker-copy-phone')).body.chunk as Structured
      expect([pc.jobId, phone.jobId]).toEqual([job.id, job.id])
      expect((await result(pc.chunkId, 'worker-copy-pc')).body).toEqual({ accepted: true })
      return { job, phone }
    }
    const jobs: number[] = []

    const { job, phone } = await pcAndPhone()
    jobs.push(job.id)
    // Just taken, the phone has said nothing yet and has no pace of its own: no copy on a guess.
    expect((await as('worker-copy-pc')).body.chunk).toBeNull()
    await slowDown(phone.chunkId)
    // A worker of another games revision never copies (the job is fixed to the revision of its first result).
    expect((await as('worker-copy-rev2', { cliVersion: '0.3.6', gamesRev: 2 })).body.chunk).toBeNull()
    // The PC, nothing left in the queue, copies what the phone plays: the same chunk, the same seed.
    const copy = (await as('worker-copy-pc')).body.chunk as Structured
    expect(copy).toMatchObject({ chunkId: phone.chunkId, seed: phone.seed, jobId: job.id })
    const copiedAt = (await chunkRow(copy.chunkId)).copySince as Date
    // One copy at a time.
    expect((await as('worker-copy-other')).body.chunk).toBeNull()
    // The copy's heartbeat renews its own lease, and the phone's its own.
    expect((await beat(copy.chunkId, 'worker-copy-pc')).body).toMatchObject({ lost: false, cancelled: false })
    expect((await beat(phone.chunkId, 'worker-copy-phone')).body).toMatchObject({ lost: false })
    // The same games: a replay uploaded by both is kept once.
    const replay = (gameId: string) =>
      bearer('put', `/api/worker/chunks/${copy.chunkId}/replays/${gameId}`)
        .query({ index: 0, seed: '1', winner: 'a' })
        .set('Content-Type', 'application/gzip')
        .send(gzipSync(JSON.stringify({ version: 1, steps: [], outcome: { Win: 0 } })))
    await replay('00000000-0000-0000-0000-0000000000c1')
    await replay('00000000-0000-0000-0000-0000000000c2')
    expect(await test.prisma.simulationReplay.count({ where: { chunkId: copy.chunkId as number } })).toBe(1)
    // The copy comes first: it counts, with its own start (worker-timing), and the phone is told its chunk is no
    // longer to be played.
    expect((await result(copy.chunkId, 'worker-copy-pc')).body).toEqual({ accepted: true })
    expect(await chunkRow(phone.chunkId)).toMatchObject({
      status: 'done',
      workerId: 'worker-copy-pc',
      leasedAt: copiedAt,
      copyWorker: null,
    })
    expect((await beat(phone.chunkId, 'worker-copy-phone')).body).toMatchObject({ leaseUntil: null })
    expect((await result(phone.chunkId, 'worker-copy-phone', 600_000)).body).toEqual({ accepted: false })
    expect((await get(`/api/simulations/${job.id}`)).body).toMatchObject({ status: 'done' })

    // The other way round: the holder comes first, and the copy is told to stop and turned down.
    const second = await pcAndPhone()
    jobs.push(second.job.id)
    await slowDown(second.phone.chunkId)
    const late = (await as('worker-copy-pc')).body.chunk as Structured
    expect(late.chunkId).toBe(second.phone.chunkId)
    expect((await result(second.phone.chunkId, 'worker-copy-phone', 600_000)).body).toEqual({ accepted: true })
    expect((await beat(late.chunkId, 'worker-copy-pc')).body).toMatchObject({ leaseUntil: null })
    expect((await result(late.chunkId, 'worker-copy-pc')).body).toEqual({ accepted: false })

    // The slow one never copies the fast one: the phone plays a game in 0.6 s by the chunk it just finished; a quick
    // worker holds a chunk with 100 games done in a minute (9 minutes left, and the phone would take 10).
    const third = await make(1000)
    jobs.push(third.id)
    const phoneOwn = (await as('worker-copy-phone')).body.chunk as Structured
    const pcHolds = (await as('worker-copy-quick')).body.chunk as Structured
    expect((await result(phoneOwn.chunkId, 'worker-copy-phone', 600_000)).body).toEqual({ accepted: true })
    await test.prisma.simulationChunk.update({
      where: { id: pcHolds.chunkId as number },
      data: { gamesDone: 100, leasedAt: new Date(Date.now() - 60_000) },
    })
    expect((await as('worker-copy-phone')).body.chunk).toBeNull()
    // The claim never hands out a chunk whose copy is alive, even with the holder's lease run out: the copy goes on
    // as the holder at its heartbeat. Its worker plays the job's games revision (a copy comes from a claim, whose
    // hello says it; review of #76).
    await test.prisma.workerNode.upsert({
      where: { id: 'worker-copy-fast' },
      create: { id: 'worker-copy-fast', name: 'pc rápida', engineRev: test.env.engineRev, cores: 2, gamesRev: 0 },
      update: {},
    })
    await test.prisma.simulationChunk.update({
      where: { id: pcHolds.chunkId as number },
      data: {
        copyWorker: 'worker-copy-fast',
        copyUntil: new Date(Date.now() + 60_000),
        copySince: new Date(),
        leaseUntil: new Date(0),
      },
    })
    expect((await as('worker-copy-third')).body.chunk).toBeNull()
    expect((await beat(pcHolds.chunkId, 'worker-copy-fast')).body).toMatchObject({ lost: false })
    expect(await chunkRow(pcHolds.chunkId)).toMatchObject({
      workerId: 'worker-copy-fast',
      copyWorker: null,
      status: 'leased',
    })
    // Its result says its engine (a fixed job takes no result of an unknown one).
    expect((await result(pcHolds.chunkId, 'worker-copy-fast', 50_000, { cliVersion: '0.1.0' })).body).toEqual({
      accepted: true,
    })

    // With a copy alive, the holder that lets go hands it over: a shutdown, a third failure, a lost result.
    const handOver = async (go: (chunkId: unknown) => Promise<unknown>) => {
      const { job: next, phone: held } = await pcAndPhone()
      jobs.push(next.id)
      await slowDown(held.chunkId)
      const taken = (await as('worker-copy-pc')).body.chunk as Structured
      expect(taken.chunkId).toBe(held.chunkId)
      await go(held.chunkId)
      return held.chunkId
    }
    const released = await handOver(() => test.app.get(WorkerQueueService).release('worker-copy-phone'))
    expect(await chunkRow(released)).toMatchObject({ status: 'leased', workerId: 'worker-copy-pc', copyWorker: null })
    const failedThird = await handOver(async (chunkId) => {
      await test.prisma.simulationChunk.update({ where: { id: chunkId as number }, data: { attempt: 2 } })
      return bearer('put', `/api/worker/chunks/${chunkId}/failure`).send({
        workerId: 'worker-copy-phone',
        error: 'motor',
      })
    })
    expect(await chunkRow(failedThird)).toMatchObject({ status: 'leased', workerId: 'worker-copy-pc', attempt: 3 })
    const returned = await handOver((chunkId) =>
      bearer('put', `/api/worker/chunks/${chunkId}/failure`).send({
        workerId: 'worker-copy-phone',
        error: 'sin result.json',
        cause: 'worker',
      }),
    )
    expect(await chunkRow(returned)).toMatchObject({ status: 'leased', workerId: 'worker-copy-pc', returns: 1 })
    // A worker that gave a chunk back (#72) never copies it.
    expect((await as('worker-copy-phone')).body.chunk).toBeNull()

    // A copy that fails counts no attempt and lets go; a lost result still pauses its worker (#72).
    const lostCopy = await pcAndPhone()
    jobs.push(lostCopy.job.id)
    await slowDown(lostCopy.phone.chunkId)
    const fastCopy = (await as('worker-copy-fast')).body.chunk as Structured
    expect(fastCopy).toMatchObject({ chunkId: lostCopy.phone.chunkId })
    const until = new Date(Date.now() + 10 * 60 * 1000)
    expect(
      (
        await bearer('put', `/api/worker/chunks/${fastCopy.chunkId}/failure`).send({
          workerId: 'worker-copy-fast',
          error: 'sin result.json',
          cause: 'worker',
          pausedUntil: until.toISOString(),
        })
      ).body,
    ).toMatchObject({ status: 'leased' })
    expect(await chunkRow(fastCopy.chunkId)).toMatchObject({
      status: 'leased',
      workerId: 'worker-copy-phone',
      attempt: 0,
      returns: 0,
      copyWorker: null,
    })
    expect((await test.prisma.workerNode.findUniqueOrThrow({ where: { id: 'worker-copy-fast' } })).pausedUntil).toEqual(
      expect.any(Date),
    )
    await test.prisma.workerNode.update({
      where: { id: 'worker-copy-fast' },
      data: { pausedUntil: null, pausedSince: null },
    })
    expect((await result(lostCopy.phone.chunkId, 'worker-copy-phone', 600_000)).body).toEqual({ accepted: true })

    // The holder's result turned down (another engine): the chunk goes to the copy alive, not back to the queue.
    const turnedDown = await pcAndPhone()
    jobs.push(turnedDown.job.id)
    await slowDown(turnedDown.phone.chunkId)
    const rescue = (await as('worker-copy-pc')).body.chunk as Structured
    expect(rescue.chunkId).toBe(turnedDown.phone.chunkId)
    expect(
      (await result(turnedDown.phone.chunkId, 'worker-copy-phone', 600_000, { engineRev: 'b'.repeat(40) })).body,
    ).toEqual({ accepted: false })
    expect(await chunkRow(rescue.chunkId)).toMatchObject({
      status: 'leased',
      workerId: 'worker-copy-pc',
      copyWorker: null,
    })
    expect((await beat(rescue.chunkId, 'worker-copy-pc')).body).toMatchObject({ lost: false })
    expect((await result(rescue.chunkId, 'worker-copy-pc')).body).toEqual({ accepted: true })

    // A job with no games revision fixed yet: only a worker that plays as the holder copies it.
    const unfixed = await make(1000)
    jobs.push(unfixed.id)
    const free = (await as('worker-copy-phone')).body.chunk as Structured
    const other = (await as('worker-copy-idle')).body.chunk as Structured
    expect([free.jobId, other.jobId]).toEqual([unfixed.id, unfixed.id])
    expect((await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: unfixed.id } })).gamesRev).toBeNull()
    await slowDown(free.chunkId)
    await test.prisma.workerNode.update({ where: { id: 'worker-copy-phone' }, data: { gamesRev: 1 } })
    expect((await as('worker-copy-pc')).body.chunk).toBeNull()
    await test.prisma.workerNode.update({ where: { id: 'worker-copy-phone' }, data: { gamesRev: 0 } })
    expect((await as('worker-copy-pc')).body.chunk).toMatchObject({ chunkId: free.chunkId })
    expect((await result(free.chunkId, 'worker-copy-pc')).body).toEqual({ accepted: true })
    expect((await result(other.chunkId, 'worker-copy-idle')).body).toEqual({ accepted: true })

    // The job fixed meanwhile to another games revision by its other chunk: the copy of the old one gets nothing, and
    // the chunk goes back to the queue for a worker that plays it (review of #76).
    const fixedMeanwhile = async () => {
      const next = await make(1000)
      jobs.push(next.id)
      const held = (await as('worker-copy-phone')).body.chunk as Structured
      const rest = (await as('worker-copy-idle')).body.chunk as Structured
      expect([held.jobId, rest.jobId]).toEqual([next.id, next.id])
      await slowDown(held.chunkId)
      expect((await as('worker-copy-pc')).body.chunk).toMatchObject({ chunkId: held.chunkId })
      const updated = { cliVersion: '0.3.6', gamesRev: 1 }
      expect((await result(rest.chunkId, 'worker-copy-idle', 50_000, updated)).body).toEqual({ accepted: true })
      expect((await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: next.id } })).gamesRev).toBe(1)
      return held.chunkId
    }
    // Who plays it in the end: a worker of revision 1.
    const playedByRev1 = async (chunkId: unknown) => {
      const updated = { cliVersion: '0.3.6', gamesRev: 1 }
      expect((await as('worker-copy-rev1', updated)).body.chunk).toMatchObject({ chunkId })
      expect((await result(chunkId, 'worker-copy-rev1', 50_000, updated)).body).toEqual({ accepted: true })
    }
    const queuedAlone = { status: 'queued', workerId: null, copyWorker: null, copyUntil: null, copySince: null }
    const turned = await fixedMeanwhile()
    expect((await result(turned, 'worker-copy-phone', 600_000)).body).toEqual({ accepted: false })
    expect(await chunkRow(turned)).toMatchObject(queuedAlone)
    expect((await beat(turned, 'worker-copy-pc')).body).toMatchObject({ lost: true })
    await playedByRev1(turned)
    const failedOld = await fixedMeanwhile()
    expect(
      (
        await bearer('put', `/api/worker/chunks/${failedOld}/failure`).send({
          workerId: 'worker-copy-phone',
          error: 'x',
        })
      ).body,
    ).toEqual({ status: 'queued' })
    expect(await chunkRow(failedOld)).toMatchObject({ ...queuedAlone, attempt: 1 })
    await playedByRev1(failedOld)
    const releasedOld = await fixedMeanwhile()
    await test.app.get(WorkerQueueService).release('worker-copy-phone')
    expect(await chunkRow(releasedOld)).toMatchObject(queuedAlone)
    await playedByRev1(releasedOld)
    // At its heartbeat the copy is told to stop, also with the holder's lease run out: nobody of the right revision
    // could take the chunk while it went on.
    const beaten = await fixedMeanwhile()
    await test.prisma.simulationChunk.update({ where: { id: beaten as number }, data: { leaseUntil: new Date(0) } })
    expect((await beat(beaten, 'worker-copy-pc')).body).toEqual({ leaseUntil: null, cancelled: false, lost: true })
    expect(await chunkRow(beaten)).toMatchObject({ status: 'leased', workerId: 'worker-copy-phone', copyWorker: null })
    await playedByRev1(beaten)

    // The holder's failure while its copy lets go, or starts, between the read and the update: once more with the row
    // as it is now, so the chunk is never left leased to a worker that stopped (review of #76).
    const queue = test.app.get(WorkerQueueService) as unknown as {
      requireChunk: (id: number) => Promise<unknown>
    }
    const meanwhile = async (
      change: { copyWorker: string | null; copyUntil: Date | null; copySince: Date | null },
      go: () => Promise<{ body: unknown }>,
    ) => {
      const read = queue.requireChunk
      let first = true
      queue.requireChunk = async (id: number) => {
        const row = await read.call(queue, id)
        if (first) {
          first = false
          await test.prisma.simulationChunk.update({ where: { id }, data: change })
        }
        return row
      }
      try {
        return (await go()).body
      } finally {
        delete (queue as { requireChunk?: unknown }).requireChunk
      }
    }
    const fail = (chunkId: unknown) =>
      bearer('put', `/api/worker/chunks/${chunkId}/failure`).send({ workerId: 'worker-copy-phone', error: 'motor' })
    const letGoMeanwhile = await pcAndPhone()
    jobs.push(letGoMeanwhile.job.id)
    await slowDown(letGoMeanwhile.phone.chunkId)
    expect((await as('worker-copy-pc')).body.chunk).toMatchObject({ chunkId: letGoMeanwhile.phone.chunkId })
    const gone = { copyWorker: null, copyUntil: null, copySince: null }
    expect(await meanwhile(gone, () => fail(letGoMeanwhile.phone.chunkId))).toEqual({ status: 'queued' })
    expect(await chunkRow(letGoMeanwhile.phone.chunkId)).toMatchObject({ ...queuedAlone, attempt: 1 })
    expect((await as('worker-copy-pc')).body.chunk).toMatchObject({ chunkId: letGoMeanwhile.phone.chunkId })
    expect((await result(letGoMeanwhile.phone.chunkId, 'worker-copy-pc')).body).toEqual({ accepted: true })
    const startedMeanwhile = await pcAndPhone()
    jobs.push(startedMeanwhile.job.id)
    const started = {
      copyWorker: 'worker-copy-pc',
      copyUntil: new Date(Date.now() + 60_000),
      copySince: new Date(),
    }
    expect(await meanwhile(started, () => fail(startedMeanwhile.phone.chunkId))).toEqual({ status: 'leased' })
    expect(await chunkRow(startedMeanwhile.phone.chunkId)).toMatchObject({
      status: 'leased',
      workerId: 'worker-copy-pc',
      copyWorker: null,
      attempt: 1,
    })
    expect((await result(startedMeanwhile.phone.chunkId, 'worker-copy-pc')).body).toEqual({ accepted: true })

    // What a holder plays as one batch is copied whole, by a worker that plays batches, or not at all.
    const batched = await make(1000)
    jobs.push(batched.id)
    await test.prisma.simulationChunk.updateMany({
      where: { jobId: batched.id },
      data: {
        status: 'leased',
        workerId: 'worker-copy-phone',
        leaseUntil: new Date(Date.now() + 3 * 60 * 1000),
        gamesDone: 100,
        leasedAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    })
    await test.prisma.simulationJob.update({ where: { id: batched.id }, data: { status: 'running' } })
    expect((await as('worker-copy-pc')).body.chunk).toBeNull()
    const whole = (await as('worker-copy-pc', { batch: { maxChunks: 4, maxGames: 5000 } })).body as {
      chunks: Structured[]
    }
    expect(whole.chunks.map((chunk) => chunk.jobId)).toEqual([batched.id, batched.id])

    // A job with per-game results: the copy is checked like any result, with its per-game record.
    const detailed = await make(4, true)
    jobs.push(detailed.id)
    const [own, held] = await test.prisma.simulationChunk.findMany({
      where: { jobId: detailed.id },
      orderBy: { idx: 'asc' },
    })
    await test.prisma.simulationChunk.update({
      where: { id: own?.id as number },
      data: {
        status: 'done',
        workerId: 'worker-copy-detail',
        games: 4,
        gamesDone: 4,
        winsA: 2,
        winsB: 2,
        ties: 0,
        durationMs: 200,
        finishedAt: new Date(),
      },
    })
    // A slow worker with 3 of 4 games done in 10 minutes.
    await test.prisma.workerNode.upsert({
      where: { id: 'worker-copy-slowest' },
      create: { id: 'worker-copy-slowest', name: 'celu', engineRev: test.env.engineRev, cores: 1, gamesRev: 0 },
      update: {},
    })
    await test.prisma.simulationChunk.update({
      where: { id: held?.id as number },
      data: {
        status: 'leased',
        workerId: 'worker-copy-slowest',
        leaseUntil: new Date(Date.now() + 3 * 60 * 1000),
        gamesDone: 3,
        leasedAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    })
    await test.prisma.simulationJob.update({ where: { id: detailed.id }, data: { status: 'running' } })
    const detailCopy = (await as('worker-copy-detail', { version: '0.2.6', engineFeatures: ['perGame'] })).body
      .chunk as Structured
    expect(detailCopy).toMatchObject({ chunkId: held?.id, perGame: true })
    const perGame = {
      winners: 'ABTA',
      starters: 'AABB',
      endings: 'PNLP',
      turns: [12, 9, 31, 8],
      stagesA: '1201',
      stagesB: '0110',
    }
    const detailedResult = await bearer('put', `/api/worker/chunks/${held?.id}/result`).send({
      workerId: 'worker-copy-detail',
      engineRev: test.env.engineRev,
      winsA: 2,
      winsB: 1,
      ties: 1,
      games: 4,
      turns: 60,
      durationMs: 200,
      extra: { perGame },
    })
    expect(detailedResult.body).toEqual({ accepted: true })
    expect(((await chunkRow(held?.id)).extra as Structured).perGame).toEqual(perGame)

    for (const id of jobs) {
      await post(`/api/simulations/${id}/cancel`)
      expect((await test.http().delete(`/api/simulations/${id}`).set('Cookie', cookie)).status).toBe(204)
    }
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
