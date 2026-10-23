import type { PinoLogger } from 'nestjs-pino'
import type { AlertsService, AlertView } from '../alerts/alerts.service.js'
import type { Env } from '../config/env.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import type { NotificationsService } from './notifications.service.js'
import { NotificationsWatcher } from './notifications.watcher.js'
import type { PresenceService } from './presence.service.js'

const HOUR = 60 * 60 * 1000

/** The watcher with fakes: no live games nor jobs, the alerts given, `notifiedAlerts` in memory. */
function watcher(stored: string[] = []) {
  const settings = new Map<string, unknown>([['notifiedAlerts', stored]])
  let alerts: AlertView[] = []
  const pushed: { title: string; body: string }[] = []
  const prisma = {
    liveGame: { findMany: async () => [] },
    simulationJob: { findMany: async () => [] },
    appSetting: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null,
      upsert: async ({ where, update }: { where: { key: string }; update: { value: unknown } }) => {
        settings.set(where.key, update.value)
      },
    },
  }
  const notifications = {
    notify: async (_kind: string, payload: { title: string; body: string }) => {
      pushed.push(payload)
      return 1
    },
  }
  const logger = { setContext: () => undefined, warn: () => undefined }
  const instance = new NotificationsWatcher(
    { cli: false, notificationsWatch: false } as unknown as Env,
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationsService,
    { isWatching: () => false } as unknown as PresenceService,
    { list: async () => alerts } as unknown as AlertsService,
    logger as unknown as PinoLogger,
  )
  let now = Date.parse('2026-12-20T12:00:00Z')
  return {
    pushed,
    stored: () => settings.get('notifiedAlerts') as string[],
    set: (next: AlertView[]) => {
      alerts = next
    },
    /** One check an hour after the last one (the alerts are checked at most every hour). */
    tick: async () => {
      now += HOUR
      return instance.tick(new Date(now))
    },
  }
}

/** «Era nueva probable» as AlertsService builds it, with the days since the last era-opening set. */
const newEra = (lastRelease: string, days: number): AlertView => ({
  code: 'new_era_likely',
  level: 'warning',
  title: 'Era nueva probable',
  detail: `Pasaron ${days} días desde ${lastRelease}. Si salió un set, cargalo en la tabla de eras para que los torneos se separen bien.`,
  link: '/torneos/ajustes',
  notifyKey: `new_era_likely|${lastRelease}`,
})

describe('the alerts the watcher pushes', () => {
  it('«Era nueva probable» once per era: not every day, and again for the next era (its title never changes)', async () => {
    const w = watcher()
    w.set([newEra('B4a', 50)])
    expect(await w.tick()).toBe(1)
    // The next days: the days change, the era does not.
    w.set([newEra('B4a', 51)])
    expect(await w.tick()).toBe(0)
    w.set([newEra('B4a', 60)])
    expect(await w.tick()).toBe(0)
    // C1 loaded and 49 days later still no set after it: a new case, pushed once.
    w.set([])
    expect(await w.tick()).toBe(0)
    w.set([newEra('C1', 50)])
    expect(await w.tick()).toBe(1)
    w.set([newEra('C1', 51)])
    expect(await w.tick()).toBe(0)
    expect(w.pushed.map((push) => push.body)).toEqual([
      expect.stringContaining('desde B4a'),
      expect.stringContaining('desde C1'),
    ])
    expect(w.stored()).toEqual(['new_era_likely|B4a', 'new_era_likely|C1'])
  })

  it('the key stored before, the same for every era, does not hold back the alert of an era', async () => {
    // Production remembers `new_era_likely|Era nueva probable` from the one push this alert ever sent.
    const w = watcher(['new_era_likely|Era nueva probable', 'limited_pack|Sobre Deluxe Mega: hoy es el último día'])
    w.set([newEra('C1', 50)])
    expect(await w.tick()).toBe(1)
    expect(await w.tick()).toBe(0)
  })

  it('an alert without notifyKey is still told apart by its title, once each', async () => {
    const w = watcher()
    const backup = (title: string): AlertView => ({
      code: 'backup_stale',
      level: 'warning',
      title,
      detail: 'La copia diaria no se hizo.',
      link: '/mas/backup',
    })
    w.set([backup('Falló la copia diaria del 19/12 04:00')])
    expect(await w.tick()).toBe(1)
    expect(await w.tick()).toBe(0)
    w.set([backup('Falló la copia diaria del 20/12 04:00')])
    expect(await w.tick()).toBe(1)
    expect(w.stored()).toEqual([
      'backup_stale|Falló la copia diaria del 19/12 04:00',
      'backup_stale|Falló la copia diaria del 20/12 04:00',
    ])
  })
})
