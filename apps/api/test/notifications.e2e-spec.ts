import webpush from 'web-push'
import { PushSender } from '../src/notifications/notifications.service.js'
import { NotificationsWatcher } from '../src/notifications/notifications.watcher.js'
import { PresenceService } from '../src/notifications/presence.service.js'
import { WeeklyCron, WeeklyService } from '../src/weekly/weekly.controller.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/**
 * Notificaciones (Fase 18): subscriptions, preferences, the test push, and what the watcher sends — a game waiting
 * for the owner who is not looking, a finished simulation, once each. The push service is a fake.
 */
describe('notifications (e2e)', () => {
  let test: TestApp
  let cookie: string
  const sent: { endpoint: string; payload: { title: string; body: string; url: string } }[] = []
  let failNext: number | null = null

  beforeAll(async () => {
    const keys = webpush.generateVAPIDKeys()
    process.env.VAPID_PUBLIC_KEY = keys.publicKey
    process.env.VAPID_PRIVATE_KEY = keys.privateKey
    test = await createTestApp()
    await seedOwner(test.app, { totp: false })
    cookie = await login(test, { secret: null })
    test.app.get(PushSender).send = async (subscription, payload) => {
      if (failNext !== null) {
        const status = failNext
        failNext = null
        throw Object.assign(new Error('gone'), { statusCode: status })
      }
      sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) })
    }
  })

  afterAll(async () => {
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
    await test.close()
  })

  const get = (path: string) => test.http().get(path).set('Cookie', cookie)
  const post = (path: string) => test.http().post(path).set('Cookie', cookie)
  const put = (path: string) => test.http().put(path).set('Cookie', cookie)
  const device = (n: number) => ({
    endpoint: `https://push.example.test/send/${n}`,
    keys: { p256dh: 'BOr3x0fakefakefakefakefakefake', auth: 'fakeauthfake' },
    userAgent: `Android ${n}`,
  })

  it('subscribes a device, changes preferences and sends the test push', async () => {
    const before = (await get('/api/notifications')).body
    expect(before).toMatchObject({ enabled: true, devices: [], preferences: { liveGame: true, simulations: true } })
    expect(before.publicKey.length).toBeGreaterThan(20)
    expect((await post('/api/notifications/subscribe').send(device(1))).status).toBe(204)
    expect((await post('/api/notifications/subscribe').send(device(1))).status).toBe(204)
    expect((await get('/api/notifications')).body.devices).toHaveLength(1)
    expect((await put('/api/notifications/preferences').send({ alerts: false })).body).toMatchObject({
      alerts: false,
      liveGame: true,
    })
    const tested = await post('/api/notifications/test')
    expect(tested.body).toEqual({ sent: 1 })
    expect(sent.at(-1)?.payload).toMatchObject({ title: 'TCG Pocket', url: '/mas/ajustes' })
    expect((await post('/api/notifications/subscribe').send({ endpoint: 'nope' })).status).toBe(400)
    expect((await test.http().get('/api/notifications')).status).toBe(401)
  })

  it('the watcher: «te toca» when the owner is not looking, once per decision; a finished job; a gone device', async () => {
    const watcher = test.app.get(NotificationsWatcher)
    await watcher.tick(new Date(Date.now() - 60_000))
    sent.length = 0
    const game = await test.prisma.liveGame.create({
      data: {
        status: 'waiting',
        humanSnapshotId: 1,
        botSnapshotId: 2,
        rivalLabel: 'Mega Lucario ex',
        bot: 'e2',
        seed: 1n,
        engineRev: test.env.engineRev ?? 'x',
        choices: [],
        decision: { ply: 1, turn: 1, state: {}, actions: [] },
      },
    })
    // Looking at it: nothing.
    test.app.get(PresenceService).saw(`live:${game.id}`)
    expect(await watcher.tick()).toBe(0)
    // Not looking (presence expired): one push, and not again for the same decision.
    test.app.get(PresenceService).saw(`live:${game.id}`, Date.now() - 60_000)
    expect(await watcher.tick()).toBe(1)
    expect(sent.at(-1)?.payload).toMatchObject({ title: 'Te toca', url: `/jugar/${game.id}` })
    expect(sent.at(-1)?.payload.body).toContain('Mega Lucario ex')
    expect(await watcher.tick()).toBe(0)

    const job = await test.prisma.simulationJob.create({
      data: {
        kind: 'compare',
        status: 'done',
        label: 'Prueba de notificación',
        params: { sideA: [], sideB: [] },
        engineRev: 'x',
        players: ['r', 'r'],
        gamesPerPair: 1,
        baseSeed: 1n,
        totalGames: 1,
        finishedAt: new Date(Date.now() + 1000),
      },
    })
    expect(await watcher.tick(new Date(Date.now() + 2000))).toBe(1)
    expect(sent.at(-1)?.payload).toMatchObject({ title: 'Simulación terminada', url: `/simulacion/${job.id}` })

    // Simulations turned off: the next finished job is not pushed.
    await put('/api/notifications/preferences').send({ simulations: false })
    await test.prisma.simulationJob.update({ where: { id: job.id }, data: { finishedAt: new Date(Date.now() + 3000) } })
    expect(await watcher.tick(new Date(Date.now() + 4000))).toBe(0)

    // The push service says the device is gone: it is removed.
    failNext = 410
    expect((await post('/api/notifications/test')).body).toEqual({ sent: 0 })
    expect((await get('/api/notifications')).body.devices).toEqual([])
  })

  it('resumen semanal (Fase 32): last week from Monday to Sunday in Buenos Aires, pushed once on Monday', async () => {
    const now = new Date('2026-10-12T14:00:00Z') // Monday 11:00 in Buenos Aires
    await test.prisma.drillAttempt.createMany({
      data: [
        { kind: 'draw', seed: 1n, correct: true, createdAt: new Date('2026-10-07T15:00:00Z') },
        { kind: 'ko', seed: 2n, correct: true, createdAt: new Date('2026-10-11T23:00:00Z') }, // Sunday 20:00 local
        { kind: 'ko', seed: 3n, correct: false, createdAt: new Date('2026-10-08T15:00:00Z') },
        { kind: 'ko', seed: 4n, correct: true, createdAt: new Date('2026-10-12T04:00:00Z') }, // Monday 01:00 local: next week
      ],
    })
    const summary = await test.app.get(WeeklyService).summary({ now })
    expect(summary.week).toMatchObject({
      start: '2026-10-05',
      label: '5/10 al 11/10',
      previous: '2026-09-28',
      next: '2026-10-12',
      current: false,
    })
    expect(summary.practice).toMatchObject({ drillsAnswered: 3, drillsCorrect: 2 })
    expect(summary.matches.overall.games).toBe(0)
    expect(summary).toMatchObject({ headline: '2/3 ejercicios', quiet: false })

    expect((await post('/api/notifications/subscribe').send(device(7))).status).toBe(204)
    sent.length = 0
    const cron = test.app.get(WeeklyCron)
    expect(await cron.send(now)).toBe(1)
    expect(sent.at(-1)?.payload).toMatchObject({
      title: 'Tu semana (5/10 al 11/10)',
      body: '2/3 ejercicios',
      url: '/partidas/semana?semana=2026-10-05',
    })
    expect(await cron.send(now)).toBe(0) // once per week
    // Two weeks later nothing happened: no push.
    expect(await cron.send(new Date('2026-10-26T14:00:00Z'))).toBe(0)

    const http = (await get('/api/weekly?semana=2026-10-08')).body
    expect(http.week.start).toBe('2026-10-05')
    expect(http.practice.drillsAnswered).toBe(3)
    expect((await get('/api/weekly?semana=ayer')).status).toBe(400)
    expect((await get('/api/notifications')).body.preferences.weekly).toBe(true)
  })
})
