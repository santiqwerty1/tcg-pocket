import { SchedulerRegistry } from '@nestjs/schedule'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import webpush from 'web-push'
import { createCliApplication } from '../src/cli/context.js'
import { TrackerSync } from '../src/collection/tracker-sync.service.js'
import { NotificationsWatcher } from '../src/notifications/notifications.watcher.js'
import { TournamentSettings } from '../src/tournaments/tournament-settings.js'
import { createTestApp, seedOwner, type TestApp } from './helpers.js'

/**
 * A CLI (retention, catalog-sync, owner-init, worker-timing) runs in production next to the API that is running, on
 * the same database: its context must not do the server's start-up work (review of #73).
 */
describe('CLI context (e2e)', () => {
  let test: TestApp

  beforeAll(async () => {
    test = await createTestApp()
    await seedOwner(test.app, { totp: false })
  })

  afterAll(async () => {
    await test.close()
  })

  it('leaves the server alone: a catalog sync and a Limitless run in course, jobs and games of another engine', async () => {
    const other = 'b'.repeat(40)
    const sync = await test.prisma.catalogSync.create({
      data: {
        commitSha: 'c'.repeat(40),
        engineRev: other,
        source: 'fixtures',
        status: 'running',
        fetchedAt: new Date(),
        fileHashes: {},
        counts: {},
      },
    })
    const run = await test.prisma.limitlessSyncRun.create({ data: { kind: 'incremental', status: 'running' } })
    const job = await test.prisma.simulationJob.create({
      data: {
        kind: 'compare',
        status: 'queued',
        label: 'cli',
        params: {},
        engineRev: other,
        players: ['r', 'r'],
        gamesPerPair: 10,
        baseSeed: 1n,
        totalGames: 10,
        chunks: { create: [{ idx: 0, games: 10, firstGame: 0, seed: 1n }] },
      },
    })
    // A Laboratorio search between rounds: the server picks it up again at start-up.
    const search = await test.prisma.simulationJob.create({
      data: {
        kind: 'explore',
        status: 'running',
        label: 'cli',
        params: {},
        engineRev: test.env.engineRev,
        players: ['r', 'r'],
        gamesPerPair: 10,
        baseSeed: 1n,
        totalGames: 0,
      },
    })
    const game = await test.prisma.liveGame.create({
      data: {
        humanSnapshotId: 1,
        botSnapshotId: 2,
        bot: 'r',
        seed: 1n,
        engineRev: other,
        status: 'waiting',
        choices: [],
      },
    })
    const before = {
      sync: await test.prisma.catalogSync.findUniqueOrThrow({ where: { id: sync.id } }),
      run: await test.prisma.limitlessSyncRun.findUniqueOrThrow({ where: { id: run.id } }),
      job: await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: job.id } }),
      search: await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: search.id } }),
      game: await test.prisma.liveGame.findUniqueOrThrow({ where: { id: game.id } }),
    }

    // The sets the server seeds at start-up: gone, to see that the CLI does not seed them again.
    const sets = await test.prisma.setRelease.count()
    expect(sets).toBeGreaterThan(0)
    await test.prisma.setRelease.deleteMany()

    // As in production: not a test run, the notifications watcher on and push keys set (the tracker and the
    // notifications would start their timers).
    const keys = webpush.generateVAPIDKeys()
    const cli = await createCliApplication({
      ...test.env,
      isTest: false,
      notificationsWatch: true,
      vapid: { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: 'mailto:owner@example.invalid' },
    })
    // No crons (no ScheduleModule) and no watcher started.
    expect(() => cli.get(SchedulerRegistry)).toThrow()
    expect((cli.get(NotificationsWatcher) as unknown as { timer: unknown }).timer).toBeNull()
    expect((cli.get(TrackerSync) as unknown as { timer: unknown }).timer).toBeNull()
    await cli.close()
    expect(await test.prisma.setRelease.count()).toBe(0)
    await test.app.get(TournamentSettings).seedSets()
    expect(await test.prisma.setRelease.count()).toBe(sets)

    expect(await test.prisma.catalogSync.findUniqueOrThrow({ where: { id: sync.id } })).toEqual(before.sync)
    expect(await test.prisma.limitlessSyncRun.findUniqueOrThrow({ where: { id: run.id } })).toEqual(before.run)
    expect(await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: job.id } })).toEqual(before.job)
    expect(await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: search.id } })).toEqual(before.search)
    expect(await test.prisma.liveGame.findUniqueOrThrow({ where: { id: game.id } })).toEqual(before.game)

    await test.prisma.liveGame.delete({ where: { id: game.id } })
    await test.prisma.simulationJob.deleteMany({ where: { label: 'cli' } })
    await test.prisma.limitlessSyncRun.delete({ where: { id: run.id } })
    await test.prisma.catalogSync.delete({ where: { id: sync.id } })
  })
})
