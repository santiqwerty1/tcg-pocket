import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Prisma } from '../src/generated/prisma/client.js'
import { WorkerQueueService } from '../src/simulation/worker-queue.service.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

describe('worker slow bot preference (D-025)', () => {
  let test: TestApp, token: string
  const rev = 'a'.repeat(40)
  const hello = {
    workerId: 'worker-slow-bots',
    name: 'synthetic worker',
    engineRev: rev,
    cores: 2,
    version: '0.2.11',
    cliVersion: '0.3.3',
    engineFeatures: ['perGame', 'batch', 'fairBots'],
    batch: { maxChunks: 10, maxGames: 5000 },
  }
  beforeAll(async () => {
    test = await createTestApp()
    test.app.get(WorkerQueueService).longPollMs = 5
    await seedOwner(test.app, { totp: false })
    const cookie = await login(test)
    const created = await test
      .http()
      .post('/api/tokens')
      .set('Cookie', cookie)
      .send({
        name: 'synthetic worker',
        kind: 'worker',
        scopes: ['worker:claim'],
      })
    expect(created.status).toBe(201)
    token = created.body.token
  })
  afterAll(async () => test?.close())
  beforeEach(async () => {
    await test.prisma.simulationJob.deleteMany()
  })

  const claim = (input: object) =>
    test.http().post('/api/worker/claim').set('Authorization', `Bearer ${token}`).send(input)
  const chunks = (jobId: number) => test.prisma.simulationChunk.findMany({ where: { jobId }, orderBy: { idx: 'asc' } })
  async function job(players: string[], extra: Partial<Prisma.SimulationJobCreateInput> = {}) {
    return test.prisma.simulationJob.create({
      data: {
        kind: 'compare',
        status: 'queued',
        engineRev: rev,
        baseSeed: 500n,
        label: 'synthetic D-025',
        gamesPerPair: 1500,
        totalGames: 1500,
        players,
        params: {},
        ...extra,
        chunks: {
          create: [
            { idx: 0, games: 1000, firstGame: 0, seed: 500n },
            { idx: 1, games: 500, firstGame: 1000, seed: 1500n },
          ],
        },
      },
    })
  }

  it.each(['m', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9'])(
    'excludes %s on either side before leasing, even with priority and batching',
    async (bot) => {
      const one = await job([bot, 'e2'], { priority: 10 })
      const two = await job(['f2', bot], { priority: 20 })
      const before = [await chunks(one.id), await chunks(two.id)]
      const blocked = await claim({ ...hello, allowSlowBots: false })
      expect(blocked.status).toBe(200)
      expect(blocked.body).toMatchObject({ chunk: null, chunks: [] })
      expect([await chunks(one.id), await chunks(two.id)]).toEqual(before)
      expect(await test.prisma.simulationJob.findMany({ select: { status: true, startedAt: true } })).toEqual([
        { status: 'queued', startedAt: null },
        { status: 'queued', startedAt: null },
      ])
    },
  )

  it.each([true, undefined])(
    'allows slow bots with opt-in=%s, preserves chunk boundaries and seeds',
    async (allowSlowBots) => {
      const slow = await job(['m', 'f9'])
      const before = await chunks(slow.id)
      const response = await claim({ ...hello, ...(allowSlowBots === undefined ? {} : { allowSlowBots }) })
      expect(response.status).toBe(200)
      expect(response.body.chunk).toMatchObject({ chunkId: before[0]?.id, jobId: slow.id })
      expect(response.body.chunks).toEqual(
        before.map((chunk) =>
          expect.objectContaining({
            chunkId: chunk.id,
            jobId: slow.id,
            idx: chunk.idx,
            games: chunk.games,
            firstGame: chunk.firstGame,
            seed: chunk.seed.toString(),
            players: ['m', 'f9'],
          }),
        ),
      )
      const shape = (rows: Awaited<ReturnType<typeof chunks>>) =>
        rows.map(({ id, jobId, idx, games, firstGame, seed, attempt }) => ({
          id,
          jobId,
          idx,
          games,
          firstGame,
          seed,
          attempt,
        }))
      expect(shape(await chunks(slow.id))).toEqual(shape(before))
    },
  )

  it('keeps D-024 class, priority and remaining-chunk order among eligible jobs', async () => {
    const slow = await job(['e3', 'e2'], { priority: 100, params: { lab: {} } })
    const matrix = await job(['e2', 'f2'], { kind: 'matrix', priority: 50 })
    const lab = await job(['r', 'r'], { params: { lab: {} } })
    const low = await job(['e1', 'f1'], { priority: 1 })
    const high = await job(['et', 'r'], { priority: 2 })
    const quick = await job(['e2', 'e2'], { priority: 2 })
    await test.prisma.simulationChunk.deleteMany({ where: { jobId: quick.id, idx: 1 } })
    const before = await chunks(slow.id)
    for (const id of [lab.id, matrix.id, quick.id, high.id, low.id]) {
      const response = await claim({ ...hello, allowSlowBots: false })
      expect(response.status).toBe(200)
      expect(response.body.chunk.jobId).toBe(id)
      expect(response.body.chunks.every((chunk: { jobId: number }) => chunk.jobId === id)).toBe(true)
    }
    expect((await claim({ ...hello, allowSlowBots: false })).body.chunk).toBeNull()
    expect(await chunks(slow.id)).toEqual(before)
  })

  it('leaves an expired slow lease unchanged until an opted-in worker reclaims it', async () => {
    const slow = await job(['m', 'e2'])
    await claim(hello)
    await test.prisma.simulationChunk.updateMany({
      where: { jobId: slow.id },
      data: { leaseUntil: new Date(0), gamesDone: 17 },
    })
    const before = await chunks(slow.id)
    expect((await claim({ ...hello, workerId: 'worker-android', allowSlowBots: false })).body.chunk).toBeNull()
    expect(await chunks(slow.id)).toEqual(before)
    const response = await claim({ ...hello, workerId: 'worker-opt-in', allowSlowBots: true })
    expect(response.body.chunks.map((chunk: { chunkId: number }) => chunk.chunkId)).toEqual(before.map(({ id }) => id))
    expect(
      (await chunks(slow.id)).every(({ workerId, attempt }) => workerId === 'worker-opt-in' && attempt === 0),
    ).toBe(true)
  })

  it.each(['consistency', 'optimize', 'explore'] as const)('filters slow bots for %s jobs', async (kind) => {
    const slow = await job(['f3', 'f3'], { kind })
    const before = await chunks(slow.id)
    expect((await claim({ ...hello, allowSlowBots: false })).body.chunk).toBeNull()
    expect(await chunks(slow.id)).toEqual(before)
    expect((await claim({ ...hello, allowSlowBots: true })).body.chunk.jobId).toBe(slow.id)
  })

  it('opt-in keeps the engine revision, fairBots, perGame and consistency version gates', async () => {
    const mismatch = await job(['e2', 'e2'], { engineRev: 'b'.repeat(40) })
    const fair = await job(['f3', 'e2'])
    const perGame = await job(['m', 'e2'], { params: { perGame: true } })
    const consistency = await job(['e3', 'et'], { kind: 'consistency' })
    const meta = await job(['e3', 'e3'], { kind: 'consistency', params: { consistency: { mode: 'meta' } } })
    const ids = [mismatch.id, fair.id, perGame.id, consistency.id, meta.id]
    const before = await Promise.all(ids.map(chunks))
    const old = { ...hello, cliVersion: '0.1.0', engineFeatures: [], allowSlowBots: true }
    for (const version of ['0.1.0', '0.2.0']) {
      // At 0.2.0 goldfish is eligible; isolate the meta gate by holding goldfish for another revision.
      if (version === '0.2.0')
        await test.prisma.simulationJob.update({ where: { id: consistency.id }, data: { engineRev: 'b'.repeat(40) } })
      expect((await claim({ ...old, version })).body.chunk).toBeNull()
    }
    expect(await Promise.all(ids.map(chunks))).toEqual(before)
  })

  it.each(['false', 0, null])('rejects non-boolean hello preference %s', async (allowSlowBots) => {
    const slow = await job(['m', 'e2'])
    const before = await chunks(slow.id)
    expect((await claim({ ...hello, allowSlowBots })).status).toBe(400)
    expect(await chunks(slow.id)).toEqual(before)
  })
})
