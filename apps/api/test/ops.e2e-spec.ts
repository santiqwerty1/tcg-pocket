import { gzipSync } from 'node:zlib'
import { OFFSITE_KEPT, OffsiteBackupService } from '../src/backup/offsite.service.js'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/** Fase 39: the cleanup of old replays and raw standings, and the copy outside Supabase. */
describe('retention and the copy outside Supabase (e2e)', () => {
  let test: TestApp
  let cookie: string

  beforeAll(async () => {
    test = await createTestApp()
    await seedOwner(test.app, { totp: false })
    cookie = await login(test, { secret: null })
    // Avisos needs the catalog in memory.
    const summary = await test.app
      .get(CatalogSyncService)
      .sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    expect(summary.status).toBe('applied')
  }, 120_000)

  afterAll(async () => {
    await test.close()
  })

  const get = (path: string) => test.http().get(path).set('Cookie', cookie)
  const post = (path: string) => test.http().post(path).set('Cookie', cookie)

  const DAY = 86_400_000
  let seq = 0
  async function job(kind: 'matrix' | 'compare', data: { archivedAt?: Date; finishedAt?: Date } = {}) {
    seq += 1
    return test.prisma.simulationJob.create({
      data: {
        kind,
        status: data.finishedAt ? 'done' : 'running',
        label: `job ${seq}`,
        params: {},
        engineRev: 'x',
        players: ['e2', 'e2'],
        gamesPerPair: 2,
        baseSeed: BigInt(seq),
        totalGames: 2,
        ...data,
      },
    })
  }
  async function chunk(jobId: number, idx: number, a: number, b: number, replays: { size?: number; at?: Date }[]) {
    const row = await test.prisma.simulationChunk.create({
      data: { jobId, idx, snapshotAId: a, snapshotBId: b, games: 2, seed: BigInt(idx + 1) },
    })
    for (const [index, replay] of replays.entries()) {
      await test.prisma.simulationReplay.create({
        data: {
          chunkId: row.id,
          gameId: `g${index}`,
          gameIndex: index,
          seed: '1',
          winner: 'a',
          dataGz: new Uint8Array([1]),
          sizeBytes: replay.size ?? 1000,
          ...(replay.at ? { createdAt: replay.at } : {}),
        },
      })
    }
  }

  it('dry run first (nothing deleted), then the real run; the results stay', async () => {
    const now = Date.now()
    const t = (minutesAgo: number) => new Date(now - minutesAgo * 60_000)
    // A matrix: pairing 1–2 in two chunks (4 replays), pairing 1–3 (2): one replay per pairing stays.
    const matrix = await job('matrix')
    await chunk(matrix.id, 0, 1, 2, [{ at: t(50) }, { at: t(50) }])
    await chunk(matrix.id, 1, 1, 2, [{ at: t(49) }, { at: t(49) }])
    await chunk(matrix.id, 2, 1, 3, [{ at: t(48) }, { at: t(48) }])
    // Archived: every replay goes. Finished 40 days ago: every replay goes.
    await chunk((await job('compare', { archivedAt: t(1), finishedAt: t(10) })).id, 0, 4, 5, [{}, {}])
    await chunk((await job('compare', { finishedAt: new Date(now - 40 * DAY) })).id, 0, 6, 7, [{}])
    // Recent comparison: two big replays (60 MB each by their size field) push the total over 100 MB.
    await chunk((await job('compare', { finishedAt: t(5) })).id, 0, 8, 9, [
      { size: 60 * 1024 * 1024, at: t(2) },
      { size: 60 * 1024 * 1024, at: t(1) },
    ])
    // Raw standings: one tournament 200 days old, one recent.
    for (const [id, days] of [
      ['old-t', 200],
      ['new-t', 10],
    ] as const) {
      await test.prisma.tournament.create({
        data: {
          id,
          name: id,
          date: new Date(now - days * DAY),
          format: 'STANDARD',
          players: 20,
          status: 'complete',
          rawStandingsGz: gzipSync(Buffer.from('[]')),
        },
      })
    }
    const replaysBefore = await test.prisma.simulationReplay.count()
    expect(replaysBefore).toBe(11)

    const expected = {
      replays: { archived: 2, oldJobs: 1, matrixExtra: 4, overBudget: 3 },
      rawStandings: 1,
    }
    const dry = await post('/api/ops/retention')
    expect(dry.status).toBe(200)
    expect(dry.body).toMatchObject({ dryRun: true, ...expected, vacuumed: false })
    expect(dry.body.freedMb).toBeGreaterThan(50)
    expect(await test.prisma.simulationReplay.count()).toBe(replaysBefore)
    expect((await get('/api/ops/status')).body.retention).toBeNull()

    const real = await post('/api/ops/retention?apply=1')
    expect(real.status).toBe(200)
    expect(real.body).toMatchObject({ dryRun: false, ...expected, vacuumed: true })
    expect(real.body.freedMb).toBe(dry.body.freedMb)
    expect(real.body.replaysMb).toBe(60)
    // The newest big replay is the only one left; the chunks, jobs and tournaments stay.
    const left = await test.prisma.simulationReplay.findMany({ select: { sizeBytes: true } })
    expect(left).toEqual([{ sizeBytes: 60 * 1024 * 1024 }])
    expect(await test.prisma.simulationChunk.count()).toBe(6)
    expect(await test.prisma.simulationJob.count()).toBe(4)
    const tournaments = await test.prisma.tournament.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, rawStandingsGz: true },
    })
    expect(tournaments.map((row) => [row.id, row.rawStandingsGz === null])).toEqual([
      ['new-t', false],
      ['old-t', true],
    ])
    expect((await get('/api/ops/status')).body.retention).toMatchObject({ dryRun: false, ...expected })
    // Nothing left to clean.
    expect((await post('/api/ops/retention?apply=1')).body).toMatchObject({
      replays: { archived: 0, oldJobs: 0, matrixExtra: 0, overBudget: 0 },
      rawStandings: 0,
      vacuumed: false,
    })
  })

  it('the copy outside Supabase: off without the bucket, then uploaded to a fake one; a failure is an alert', async () => {
    expect((await get('/api/backup/offsite')).body).toEqual({ enabled: false, last: null })
    expect((await post('/api/backup/offsite')).status).toBe(400)
    expect((await get('/api/ops/status')).body.backup.offsite).toEqual({ enabled: false, last: null })

    test.env.offsite = {
      accessKeyId: 'AKIATEST',
      secretAccessKey: 'secret-test',
      endpoint: 'https://bucket.test',
      region: 'auto',
      bucket: 'tcg',
    }
    const stored = new Map<string, number>()
    let fail = false
    const offsite = test.app.get(OffsiteBackupService)
    offsite.fetchImpl = async (request) => {
      expect(request.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /)
      const key = decodeURIComponent(new URL(request.url).pathname.replace(/^\/tcg\/?/, ''))
      if (request.method === 'PUT') {
        if (fail) return new Response('denied', { status: 403 })
        stored.set(key, (await request.arrayBuffer()).byteLength)
        return new Response('', { status: 200 })
      }
      if (request.method === 'DELETE') {
        stored.delete(key)
        return new Response(null, { status: 204 })
      }
      const contents = [...stored.keys()]
        .map((name) => `<Contents><Key>${name}</Key><Size>1</Size></Contents>`)
        .join('')
      return new Response(`<ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`)
    }
    try {
      const uploaded = await post('/api/backup/offsite')
      expect(uploaded.status).toBe(200)
      expect(uploaded.body.result).toMatchObject({ ok: true, error: null, kept: 1 })
      expect([...stored.keys()]).toEqual([uploaded.body.result.key])
      expect([...stored.values()][0]).toBeGreaterThan(100)
      expect((await get('/api/backup/offsite')).body).toMatchObject({ enabled: true, last: { ok: true } })
      expect(OFFSITE_KEPT).toBe(30)

      // With the daily copy on, a failed upload is an alert (and so is none at all in 26 h).
      test.env.backupCron = true
      fail = true
      expect((await post('/api/backup/offsite')).body.result).toMatchObject({ ok: false })
      const alerts = (await get('/api/alerts')).body.items as { code: string; title: string }[]
      expect(alerts.filter((item) => item.code === 'backup_offsite').map((item) => item.title)[0]).toMatch(
        /^Falló la subida de la copia a la nube del /,
      )
    } finally {
      test.env.backupCron = false
      test.env.offsite = null
    }
  })
})
