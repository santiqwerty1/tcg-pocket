import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WorkerPackages } from '../src/simulation/worker-packages.controller.js'
import { WorkerQueueService } from '../src/simulation/worker-queue.service.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

describe('Android worker distribution', () => {
  let test: TestApp, folder: string, worker: string, mcp: string
  const bytes = gzipSync('synthetic package: no real owner data')
  beforeAll(async () => {
    test = await createTestApp()
    folder = await mkdtemp(join(tmpdir(), 'tcg-package-'))
    test.app.get(WorkerPackages).directory = folder
    await writeFile(join(folder, 'android-arm64.tar.gz'), bytes)
    await writeFile(join(folder, 'install-android.sh'), '#!/bin/bash\nread -rs token\n')
    await writeFile(join(folder, 'android-version.json'), '{"engineRev":"pinned","cliVersion":"0.3.3"}')
    await seedOwner(test.app, { totp: false })
    const cookie = await login(test, { secret: null })
    const create = (kind: string, scopes: string[]) =>
      test.http().post('/api/tokens').set('Cookie', cookie).send({ name: kind, kind, scopes })
    worker = (await create('worker', ['worker:claim'])).body.token
    mcp = (await create('mcp', ['mcp:read'])).body.token
  })
  afterAll(async () => {
    await test?.close()
    if (folder) await rm(folder, { recursive: true, force: true })
  })

  it('401 without bearer, with a non-worker or with token only in URL', async () => {
    for (const token of [undefined, mcp, 'tcg_wk_invalid']) {
      const call = test.http().get('/api/worker/packages/android-arm64')
      if (token) call.set('Authorization', `Bearer ${token}`)
      expect((await call).status).toBe(401)
    }
    expect((await test.http().get(`/api/worker/packages/android-arm64?token=${worker}`)).status).toBe(401)
  })
  it('sends exact archive and its sha256 over bearer authentication', async () => {
    const response = await test
      .http()
      .get('/api/worker/packages/android-arm64')
      .set('Authorization', `Bearer ${worker}`)
      .buffer(true)
    expect(response.status).toBe(200)
    expect(response.body).toEqual(bytes)
    expect(response.headers['x-checksum-sha256']).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(response.headers['cache-control']).toBe('no-store')
    const version = await test
      .http()
      .get('/api/worker/packages/android-arm64/version')
      .set('Authorization', `Bearer ${worker}`)
    expect(version.body).toEqual({ engineRev: 'pinned', cliVersion: '0.3.3' })
  })
  it('bootstrap is public; other worker routes still require bearer', async () => {
    expect((await test.http().get('/api/worker/install/android.sh')).status).toBe(200)
    expect((await test.http().get('/api/worker/ping')).status).toBe(401)
  })
  it('releases only this worker leases; repeated shutdown is harmless', async () => {
    const id = randomUUID(),
      other = randomUUID()
    for (const workerId of [id, other])
      await test.prisma.workerNode.create({
        data: { id: workerId, name: 'test', engineRev: 'test', cores: 1, version: '0.2.8' },
      })
    const job = await test.prisma.simulationJob.create({
      data: {
        kind: 'matrix',
        status: 'running',
        engineRev: 'test',
        label: 'synthetic',
        baseSeed: 7n,
        gamesPerPair: 1,
        totalGames: 2,
        players: ['r', 'r'],
        params: {},
      },
    })
    for (const [idx, workerId] of [id, other].entries())
      await test.prisma.simulationChunk.create({
        data: {
          jobId: job.id,
          idx,
          games: 1,
          seed: BigInt(idx),
          firstGame: idx,
          status: 'leased',
          workerId,
          leaseUntil: new Date(Date.now() + 60_000),
        },
      })
    const response = await test
      .http()
      .post('/api/worker/release')
      .set('Authorization', `Bearer ${worker}`)
      .send({ workerId: id })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ chunks: 1, games: 0 })
    expect(await test.prisma.simulationChunk.findMany({ where: { workerId: other } })).toHaveLength(1)
    expect((await test.prisma.simulationChunk.findFirstOrThrow({ where: { jobId: job.id, idx: 0 } })).attempt).toBe(0)
    expect(await test.app.get(WorkerQueueService).release(id)).toEqual({ chunks: 0, games: 0 })
  })
})
