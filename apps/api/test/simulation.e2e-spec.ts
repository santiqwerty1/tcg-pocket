import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { EngineStatusService } from '../src/simulation/snapshots.service.js'
import { WorkerQueueService } from '../src/simulation/worker-queue.service.js'
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
