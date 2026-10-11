import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { LiveGamesService } from '../src/play/live-games.service.js'
import { WorkerPackages } from '../src/simulation/worker-packages.controller.js'
import { WorkerQueueService } from '../src/simulation/worker-queue.service.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

describe('worker packages (Android, and Windows updates, D-026)', () => {
  let test: TestApp, folder: string, worker: string, mcp: string
  const bytes = gzipSync('synthetic package: no real owner data')
  const windows = gzipSync('synthetic windows update package')
  const sum = (data: Buffer) => createHash('sha256').update(data).digest('hex')
  beforeAll(async () => {
    test = await createTestApp()
    folder = await mkdtemp(join(tmpdir(), 'tcg-package-'))
    test.app.get(WorkerPackages).directory = folder
    await writeFile(join(folder, 'android-arm64.tar.gz'), bytes)
    await writeFile(join(folder, 'install-android.sh'), '#!/bin/bash\nread -rs token\n')
    await writeFile(join(folder, 'android-version.json'), '{"engineRev":"pinned","cliVersion":"0.3.3"}')
    await writeFile(join(folder, 'windows-x64.tar.gz'), windows)
    await writeFile(
      join(folder, 'windows-x64-version.json'),
      '{"platform":"windows-x64","workerVersion":"0.3.0","engineRev":"pinned","cliVersion":"0.3.3"}',
    )
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
    expect(response.headers['x-checksum-sha256']).toBe(sum(bytes))
    expect(response.headers['cache-control']).toBe('no-store')
    const version = await test
      .http()
      .get('/api/worker/packages/android-arm64/version')
      .set('Authorization', `Bearer ${worker}`)
    // Workers 0.2.8–0.2.11 read only the engine; 0.3.0 compares the sum with the package it runs.
    expect(version.body).toEqual({
      platform: 'android-arm64',
      engineRev: 'pinned',
      cliVersion: '0.3.3',
      sha256: sum(bytes),
      size: bytes.length,
    })
  })
  it('serves the Windows update package with the sum its version announces', async () => {
    const version = await test
      .http()
      .get('/api/worker/packages/windows-x64/version')
      .set('Authorization', `Bearer ${worker}`)
    expect(version.status).toBe(200)
    expect(version.body).toEqual({
      platform: 'windows-x64',
      workerVersion: '0.3.0',
      engineRev: 'pinned',
      cliVersion: '0.3.3',
      sha256: sum(windows),
      size: windows.length,
    })
    const response = await test
      .http()
      .get('/api/worker/packages/windows-x64')
      .set('Authorization', `Bearer ${worker}`)
      .buffer(true)
      .parse((res, done) => {
        const parts: Buffer[] = []
        res.on('data', (part: Buffer) => parts.push(part))
        res.on('end', () => done(null, Buffer.concat(parts)))
      })
    expect(response.status).toBe(200)
    expect(response.body).toEqual(windows)
    expect(response.headers['x-checksum-sha256']).toBe(version.body.sha256)
    expect(response.headers['content-length']).toBe(String(windows.length))
    for (const path of ['/api/worker/packages/windows-x64', '/api/worker/packages/windows-x64/version']) {
      expect((await test.http().get(path)).status).toBe(401)
      expect((await test.http().get(path).set('Authorization', `Bearer ${mcp}`)).status).toBe(401)
    }
  })
  it('404 for a platform without a package; 503 when the image did not build it', async () => {
    for (const path of ['/api/worker/packages/linux-x64', '/api/worker/packages/constructor/version']) {
      expect((await test.http().get(path).set('Authorization', `Bearer ${worker}`)).status).toBe(404)
    }
    await rm(join(folder, 'windows-x64.tar.gz'))
    try {
      const missing = await test
        .http()
        .get('/api/worker/packages/windows-x64/version')
        .set('Authorization', `Bearer ${worker}`)
      expect(missing.status).toBe(503)
    } finally {
      await writeFile(join(folder, 'windows-x64.tar.gz'), windows)
    }
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
    expect(await test.app.get(WorkerQueueService).release(id)).toEqual({ chunks: 0 })
  })
  it('released live games notify open pages and wake claiming workers immediately', async () => {
    const owner = randomUUID(),
      other = randomUUID(),
      rev = randomUUID()
    const games = test.app.get(LiveGamesService)
    const created = await Promise.all(
      ['waiting', 'running', 'done'].map((status) =>
        test.prisma.liveGame.create({
          data: {
            humanSnapshotId: 0,
            botSnapshotId: 0,
            bot: 'r',
            seed: 42n,
            engineRev: rev,
            choices: [1],
            workerId: owner,
            status: status as 'waiting' | 'running' | 'done',
            leaseUntil: new Date(Date.now() + 60_000),
          },
        }),
      ),
    )
    const first = created[0],
      done = created[2]
    if (!first || !done) throw new Error('missing live game fixture')
    const changed = vi.fn()
    const unsubscribe = games.watch(first.id, changed)
    const controller = new AbortController()
    const claiming = games.claim({ workerId: other, engineRev: rev, version: '0.2.8' }, controller.signal)
    try {
      // Wait until the long-poll subscribes, so a missing notification cannot pass by claiming after release.
      const events = (games as unknown as { events: import('node:events').EventEmitter }).events
      await expect.poll(() => events.listenerCount('queued')).toBeGreaterThan(0)
      const response = await test
        .http()
        .post('/api/worker/release')
        .set('Authorization', `Bearer ${worker}`)
        .send({ workerId: owner })
      expect(response.body).toEqual({ chunks: 0, games: 2 })
      expect(changed).toHaveBeenCalled()
      const reply = await Promise.race([
        claiming,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
      ])
      expect(reply?.game?.id).toBe(first.id)
      expect(reply?.game?.choices).toEqual([1])
      expect((await test.prisma.liveGame.findUniqueOrThrow({ where: { id: done.id } })).status).toBe('done')
    } finally {
      controller.abort()
      await claiming
      unsubscribe()
    }
  })
})
