import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AlertsService, TrackerUpstreamService } from '../src/alerts/alerts.service.js'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { todayInOwnerZone } from '../src/config/time-zone.js'
import { BACKUP_FAILURE_KEY, OpsService } from '../src/ops/ops.service.js'
import { EngineUpstreamService } from '../src/simulation/engine-upstream.service.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/** Fase 8: the alerts (a new set in the tracker, a limited pack ending), with a fake tracker. */
const TYPES_INDEX = join(REPO_ROOT, 'packages/domain/test/fixtures/tracker/types.index.ts')

describe('alerts (e2e)', () => {
  let test: TestApp
  let cookie: string

  beforeAll(async () => {
    test = await createTestApp()
    await seedOwner(test.app, { totp: false })
    cookie = await login(test, { secret: null })
    const summary = await test.app
      .get(CatalogSyncService)
      .sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    expect(summary.status).toBe('applied')
  }, 120_000)

  afterAll(async () => {
    await test.close()
  })

  const get = (path: string) => test.http().get(path).set('Cookie', cookie)

  it('nothing to say by default (no upstream checks outside production)', async () => {
    const response = await get('/api/alerts')
    expect(response.status).toBe(200)
    expect(response.body.items.filter((item: { code: string }) => item.code === 'new_set')).toEqual([])
  })

  it('a set the tracker has and the catalog does not; a limited pack in its last week', async () => {
    const tracker = test.app.get(TrackerUpstreamService)
    test.env.trackerUpstreamCheck = true
    const source = readFileSync(TYPES_INDEX, 'utf8').replace(/expansionIds\s*=\s*\[/, "expansionIds = [\n  'B5',")
    let calls = 0
    tracker.fetchImpl = (async (url: string | URL) => {
      calls++
      expect(String(url)).toMatch(/\/main\/frontend\/src\/types\/index\.ts$/)
      return new Response(source, { status: 200 })
    }) as typeof fetch
    const today = todayInOwnerZone()
    const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 3 * 86_400_000)
    await test.prisma.pack.update({
      where: { id: 'B4b/deluxepackmega' },
      data: { limited: true, available: true, limitedUntil: soon },
    })

    const items = (await get('/api/alerts')).body.items as {
      code: string
      level: string
      title: string
      link: string
    }[]
    expect(items.find((item) => item.code === 'new_set')).toMatchObject({
      level: 'warning',
      title: 'Set nuevo en el tracker: B5',
      link: '/mas/catalogo',
    })
    expect(items.find((item) => item.code === 'limited_pack')?.title).toMatch(/quedan 3 días$/)
    // Cached for 12 hours: one fetch.
    await get('/api/alerts')
    expect(calls).toBe(1)
    test.env.trackerUpstreamCheck = false
  })

  it('H-016: work waiting and no worker in 30 minutes; the title says since when', async () => {
    const titles = async () =>
      ((await get('/api/alerts')).body.items as { code: string; title: string }[])
        .filter((item) => item.code === 'worker_idle')
        .map((item) => item.title)
    expect(await titles()).toEqual([])
    const game = await test.prisma.liveGame.create({
      data: {
        status: 'queued',
        humanSnapshotId: 1,
        botSnapshotId: 2,
        bot: 'e2',
        seed: 1n,
        engineRev: test.env.engineRev ?? 'x',
        choices: [],
      },
    })
    expect(await titles()).toEqual(['Hay trabajo esperando y nunca se conectó un worker'])
    await test.prisma.workerNode.create({
      // With the app's deckgym: a worker of another one could not take the game either (worker_idle says so).
      data: {
        id: 'worker-h016',
        name: 'PC',
        engineRev: test.env.engineRev ?? 'x',
        lastSeenAt: new Date('2026-10-09T05:35:59Z'),
      },
    })
    expect(await titles()).toEqual(['Hay trabajo esperando y ningún worker desde el 9/10 02:35'])
    await test.prisma.workerNode.update({ where: { id: 'worker-h016' }, data: { lastSeenAt: new Date() } })
    expect(await titles()).toEqual([])
    await test.prisma.liveGame.delete({ where: { id: game.id } })
  })

  it('a worker paused after lost results (0.3.4): the alert says until when and not to restart it (review of #72)', async () => {
    const rev = test.env.engineRev ?? 'x'
    const alerts = async () =>
      ((await get('/api/alerts')).body.items as { code: string; title: string; detail: string }[]).filter((item) =>
        ['worker_idle', 'worker_paused'].includes(item.code),
      )
    const job = await test.prisma.simulationJob.create({
      data: {
        kind: 'compare',
        status: 'queued',
        label: 'pausa',
        params: {},
        engineRev: rev,
        players: ['r', 'r'],
        gamesPerPair: 10,
        baseSeed: 1n,
        totalGames: 10,
        chunks: { create: [{ idx: 0, games: 10, firstGame: 0, seed: 1n }] },
      },
    })
    // Only the paused one is around: the workers other tests left are not seen for this one.
    const others = await test.prisma.workerNode.findMany({ select: { id: true, lastSeenAt: true } })
    await test.prisma.workerNode.updateMany({ data: { lastSeenAt: new Date('2026-10-01T00:00:00Z') } })
    try {
      await test.prisma.workerNode.create({
        data: {
          id: 'worker-paused',
          name: 'S25',
          engineRev: rev,
          gamesRev: 1,
          lastSeenAt: new Date(),
          pausedUntil: new Date('2099-10-12T21:30:00Z'),
          pauseReason: 'lost_results',
          pausedSince: new Date('2026-10-12T17:00:00Z'),
          platform: 'android',
        },
      })
      const [paused, ...rest] = await alerts()
      expect(rest).toEqual([])
      expect(paused).toMatchObject({
        code: 'worker_paused',
        // The episode's start, not the end of this pause: a push goes once per title (review of #72).
        title: 'S25 en pausa por resultados perdidos (desde el 12/10 14:00)',
        detail: expect.stringMatching(/^Vuelve solo el .*No hace falta reiniciarlo: revisá que Termux esté/),
      })
      expect(paused?.detail).not.toContain('reiniciá')
      // The next pause of the same episode keeps the title (no new push); off Android, no word of Termux.
      await test.prisma.workerNode.update({
        where: { id: 'worker-paused' },
        data: { pausedUntil: new Date('2099-10-13T03:30:00Z'), platform: 'win32' },
      })
      const [next] = await alerts()
      expect(next?.title).toBe(paused?.title)
      expect(next?.detail).not.toContain('Termux')
      // Paused no longer: no alert (it can take the chunk).
      await test.prisma.workerNode.update({ where: { id: 'worker-paused' }, data: { pausedUntil: null } })
      expect(await alerts()).toEqual([])
    } finally {
      await test.prisma.simulationJob.delete({ where: { id: job.id } })
      await test.prisma.workerNode.deleteMany({ where: { id: 'worker-paused' } })
      for (const other of others) {
        await test.prisma.workerNode.update({ where: { id: other.id }, data: { lastSeenAt: other.lastSeenAt } })
      }
    }
  })

  it('H-051: work no worker can take: «et», the f bots, both in one worker, the same deckgym and games revision', async () => {
    const rev = test.env.engineRev ?? 'x'
    const idle = async () =>
      ((await get('/api/alerts')).body.items as { code: string; title: string; detail: string }[]).filter(
        (item) => item.code === 'worker_idle',
      )
    const node = (id: string, engineFeatures: string[], engineRev = rev, gamesRev: number | null = 1) =>
      test.prisma.workerNode.upsert({
        where: { id },
        create: { id, name: 'PC', engineRev, lastSeenAt: new Date(), engineFeatures, gamesRev },
        update: { engineRev, lastSeenAt: new Date(), engineFeatures, gamesRev },
      })
    const game = (bot: string) =>
      test.prisma.liveGame.create({
        data: {
          status: 'queued',
          humanSnapshotId: 1,
          botSnapshotId: 2,
          bot,
          seed: 1n,
          engineRev: rev,
          choices: [],
          createdAt: new Date('2026-10-11T15:00:00Z'),
        },
      })
    const job = (players: string[], extra: { kind?: 'compare' | 'consistency'; gamesRev?: number } = {}) =>
      test.prisma.simulationJob.create({
        data: {
          kind: extra.kind ?? 'compare',
          status: 'queued',
          label: 'alerta',
          params: {},
          engineRev: rev,
          gamesRev: extra.gamesRev ?? null,
          players,
          gamesPerPair: 10,
          baseSeed: 1n,
          totalGames: 20,
          createdAt: new Date('2026-10-11T16:00:00Z'),
          chunks: {
            create: [
              { idx: 0, games: 10, firstGame: 0, seed: 1n },
              { idx: 1, games: 10, firstGame: 10, seed: 2n },
            ],
          },
        },
      })
    const workers = ['worker-h051', 'worker-h051-fair', 'worker-h051-old']
    // Everything this test leaves goes even if it fails half way (review of #67: /api/ops/status counts it).
    try {
      await node('worker-h051', ['perGame', 'batch'])
      // A game against «et»: the title and the detail call it so.
      const et = await game('et')
      expect(await idle()).toEqual([
        expect.objectContaining({
          title: 'Hay partidas contra el bot que ningún worker puede jugar (desde el 11/10 12:00)',
          detail: expect.stringMatching(/^1 partida contra el bot pide el bot «et» \(solo termina el turno\).*0\.3\.5/),
        }),
      ])
      // Right after a deploy the workers are still updating themselves: no alert yet.
      const alerts = test.app.get(AlertsService)
      alerts.deployGraceMs = 60 * 60 * 1000
      try {
        expect(await idle()).toEqual([])
      } finally {
        alerts.deployGraceMs = 0
      }
      await node('worker-h051', ['perGame', 'batch', 'etBot'])
      expect(await idle()).toEqual([])
      await test.prisma.liveGame.delete({ where: { id: et.id } })
      // A consistency keeps «et» as the goldfish rival, which any engine builds: no alert for it.
      await node('worker-h051', ['perGame', 'batch'])
      const goldfish = await job(['e2', 'et'], { kind: 'consistency' })
      expect(await idle()).toEqual([])
      await test.prisma.simulationJob.delete({ where: { id: goldfish.id } })
      // A simulation with «et» and an f bot: one worker with only etBot and another with only fairBots cannot take it.
      await node('worker-h051', ['perGame', 'batch', 'etBot'])
      const both = await job(['et', 'f2'])
      await node('worker-h051-fair', ['perGame', 'batch', 'fairBots'])
      expect(await idle()).toEqual([
        expect.objectContaining({
          title: 'Hay simulaciones que ningún worker puede jugar (desde el 11/10 13:00)',
          detail: expect.stringMatching(/^2 chunks piden el bot «et» \(solo termina el turno\) y los bots f, /),
        }),
      ])
      // A worker with both, but of another deckgym: still nobody.
      await node('worker-h051-old', ['perGame', 'batch', 'etBot', 'fairBots'], 'b'.repeat(40))
      expect(await idle()).toHaveLength(1)
      await node('worker-h051', ['perGame', 'batch', 'etBot', 'fairBots'])
      expect(await idle()).toEqual([])
      await test.prisma.simulationJob.delete({ where: { id: both.id } })
      // Phase 42: a simulation fixed to games revision 2, and the workers of its deckgym play revision 1.
      const fixed = await job(['r', 'r'], { gamesRev: 2 })
      expect(await idle()).toEqual([
        expect.objectContaining({ detail: expect.stringMatching(/^2 chunks piden la revisión 2 de las partidas/) }),
      ])
      await node('worker-h051', ['perGame', 'batch', 'etBot', 'fairBots'], rev, 2)
      expect(await idle()).toEqual([])
      await test.prisma.simulationJob.delete({ where: { id: fixed.id } })
      // T-021: a g bot needs «gBots» and the g of engine-cli 0.3.16; 0.3.13–0.3.15 list «gBots» with an earlier g.
      await node('worker-h051', ['perGame', 'batch', 'etBot', 'fairBots', 'gBots'])
      await test.prisma.workerNode.update({ where: { id: 'worker-h051' }, data: { cliVersion: '0.3.15' } })
      const g = await job(['g2', 'r'])
      expect(await idle()).toEqual([
        expect.objectContaining({ detail: expect.stringMatching(/^2 chunks piden los bots g, .*0\.3\.16/) }),
      ])
      await test.prisma.workerNode.update({ where: { id: 'worker-h051' }, data: { cliVersion: '0.3.16' } })
      expect(await idle()).toEqual([])
      await test.prisma.simulationJob.delete({ where: { id: g.id } })
      // The same for a game against g2 (review of #142: the live branch had no test).
      await test.prisma.workerNode.update({ where: { id: 'worker-h051' }, data: { cliVersion: '0.3.15' } })
      const live = await game('g2')
      expect(await idle()).toEqual([
        expect.objectContaining({
          detail: expect.stringMatching(/^1 partida contra el bot pide los bots g, .*0\.3\.16/),
        }),
      ])
      await test.prisma.workerNode.update({ where: { id: 'worker-h051' }, data: { cliVersion: '0.3.16' } })
      expect(await idle()).toEqual([])
      await test.prisma.liveGame.delete({ where: { id: live.id } })
      // A simulation with an f bot and a game against «et» nobody plays: both in one alert.
      await node('worker-h051', ['perGame', 'batch'])
      await test.prisma.workerNode.deleteMany({ where: { id: { in: ['worker-h051-fair', 'worker-h051-old'] } } })
      await job(['f2', 'r'])
      await game('et')
      expect(await idle()).toEqual([
        expect.objectContaining({
          title: 'Hay simulaciones y partidas contra el bot que ningún worker puede jugar (desde el 11/10 12:00)',
          detail: expect.stringMatching(/^2 chunks y 1 partida contra el bot piden /),
        }),
      ])
    } finally {
      await test.prisma.simulationJob.deleteMany({ where: { label: 'alerta' } })
      await test.prisma.liveGame.deleteMany({ where: { humanSnapshotId: 1, botSnapshotId: 2, status: 'queued' } })
      await test.prisma.workerNode.deleteMany({ where: { id: { in: workers } } })
    }
  })

  const operationAlerts = async (code: string) =>
    ((await get('/api/alerts')).body.items as { code: string; title: string; level: string }[]).filter(
      (item) => item.code === code,
    )

  it('Fase 38: the daily copy — none yet, too old, failed', async () => {
    expect(await operationAlerts('backup_stale')).toEqual([])
    test.env.backupCron = true
    try {
      expect((await operationAlerts('backup_stale')).map((item) => item.title)).toEqual([
        'Todavía no hay ninguna copia diaria',
      ])
      const old = await test.prisma.backupBlob.create({
        data: { createdAt: new Date('2026-10-07T07:00:00Z'), sizeBytes: 10, dataGz: new Uint8Array([1]) },
      })
      expect((await operationAlerts('backup_stale')).map((item) => item.title)).toEqual([
        'No hay copia diaria desde el 7/10 04:00',
      ])
      const value = { at: new Date('2026-10-08T07:00:05Z').toISOString(), error: 'connection terminated' }
      await test.prisma.appSetting.create({ data: { key: BACKUP_FAILURE_KEY, value } })
      const failed = await operationAlerts('backup_stale')
      expect(failed.map((item) => item.title)).toEqual(['Falló la copia diaria del 8/10 04:00'])
      // A good copy after the failure clears both.
      const fresh = await test.prisma.backupBlob.create({ data: { sizeBytes: 10, dataGz: new Uint8Array([1]) } })
      expect(await operationAlerts('backup_stale')).toEqual([])
      await test.prisma.backupBlob.deleteMany({ where: { id: { in: [old.id, fresh.id] } } })
      await test.prisma.appSetting.delete({ where: { key: BACKUP_FAILURE_KEY } })
    } finally {
      test.env.backupCron = false
    }
  })

  it('Fase 38: Limitless — a failed run, then no good run in 13 hours', async () => {
    test.env.limitlessSync = true
    try {
      const failed = await test.prisma.limitlessSyncRun.create({
        data: {
          kind: 'incremental',
          status: 'failed',
          startedAt: new Date('2026-10-09T12:00:00Z'),
          finishedAt: new Date('2026-10-09T12:01:00Z'),
          error: 'Limitless 503',
        },
      })
      const titles = (await operationAlerts('limitless_sync')).map((item) => item.title)
      expect(titles).toEqual(['Falló la sincronización de Limitless del 9/10'])
      await test.prisma.limitlessSyncRun.update({
        where: { id: failed.id },
        data: { status: 'done', error: null, startedAt: new Date(Date.now() - 20 * 3_600_000), finishedAt: null },
      })
      await test.prisma.limitlessSyncRun.update({
        where: { id: failed.id },
        data: { finishedAt: new Date(Date.now() - 20 * 3_600_000) },
      })
      expect((await operationAlerts('limitless_sync'))[0]?.title).toMatch(/^Limitless no se sincroniza desde el /)
      await test.prisma.limitlessSyncRun.update({ where: { id: failed.id }, data: { finishedAt: new Date() } })
      expect(await operationAlerts('limitless_sync')).toEqual([])
      await test.prisma.limitlessSyncRun.delete({ where: { id: failed.id } })
    } finally {
      test.env.limitlessSync = false
    }
  })

  it('Fase 38: a failed catalog sync, a GitHub check that fails, a database near the limit', async () => {
    const applied = await test.prisma.catalogSync.findFirstOrThrow({ orderBy: { id: 'desc' } })
    const broken = await test.prisma.catalogSync.create({
      data: {
        commitSha: applied.commitSha,
        engineRev: applied.engineRev,
        source: applied.source,
        status: 'failed',
        fetchedAt: new Date('2026-10-09T13:30:00Z'),
        fileHashes: {},
        counts: {},
        error: 'tracker 404',
      },
    })
    expect((await operationAlerts('catalog_sync')).map((item) => item.title)).toEqual([
      'Falló la actualización del catálogo del 9/10 10:30',
    ])
    await test.prisma.catalogSync.delete({ where: { id: broken.id } })
    expect(await operationAlerts('catalog_sync')).toEqual([])

    const engine = test.app.get(EngineUpstreamService)
    engine.lastFailure = { at: '2026-10-09T13:00:00.000Z', message: 'GitHub 403' }
    const github = await operationAlerts('github_check')
    expect(github).toEqual([
      expect.objectContaining({ level: 'info', title: 'No se pudo consultar GitHub (GitHub 403)' }),
    ])
    engine.lastFailure = null
    expect(await operationAlerts('github_check')).toEqual([])

    const ops = test.app.get(OpsService)
    const real = ops.databaseBytes.bind(ops)
    ops.databaseBytes = async () => 380 * 1024 * 1024
    try {
      expect((await operationAlerts('database_size')).map((item) => item.title)).toEqual([
        'La base pasó los 350 MB (de 500)',
      ])
    } finally {
      ops.databaseBytes = real
    }
    expect(await operationAlerts('database_size')).toEqual([])
  })

  it('Fase 38: /api/ops/status — version, memory, database, jobs, workers', async () => {
    const response = await get('/api/ops/status')
    expect(response.status).toBe(200)
    const status = response.body
    expect(status.version).toBe(test.env.version)
    expect(status.memory.heapLimitMb).toBeGreaterThan(status.memory.heapUsedMb)
    expect(status.database.sizeMb).toBeGreaterThan(0)
    expect(status.database).toMatchObject({ alertMb: 350, limitMb: 500 })
    expect(status.backup).toMatchObject({ enabled: false, copies: 0, last: null, failure: null })
    expect(status.limitless).toMatchObject({ enabled: false, running: false })
    expect(status.catalog.lastSync).toMatchObject({ status: 'applied' })
    expect(status.github).toEqual({ token: false, engineCheck: null, trackerCheck: null })
    expect(status.queue).toEqual({ chunks: 0, liveGames: 0 })
    expect(Array.isArray(status.workers.online)).toBe(true)
    expect((await test.http().get('/api/ops/status')).status).toBe(401)
  })
})
