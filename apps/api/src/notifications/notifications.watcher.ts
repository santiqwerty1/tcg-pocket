/**
 * What to notify (Fase 18), checked every 15 seconds: a game against the bot waiting for the owner who is not
 * looking at it, simulations and Laboratorio searches that finished since the last check, and app alerts not sent
 * yet (once each; a limited pack only on its last two days). Nothing is pushed for what happened before the server
 * started.
 */
import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { botLabel } from '@tcg/domain'
import { PinoLogger } from 'nestjs-pino'
import { AlertsService } from '../alerts/alerts.service.js'
import { ENV, type Env } from '../config/env.js'
import type { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { NotificationsService } from './notifications.service.js'
import { PresenceService } from './presence.service.js'

const TICK_MS = 15_000
const ALERTS_EVERY_MS = 60 * 60 * 1000

@Injectable()
export class NotificationsWatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private since = new Date()
  private timer: NodeJS.Timeout | null = null
  private lastAlerts = 0
  private ticking = false
  /** Waiting games already notified at a given decision (game id → ply). */
  private readonly told = new Map<number, number>()

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly presence: PresenceService,
    private readonly alerts: AlertsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(NotificationsWatcher.name)
  }

  onApplicationBootstrap(): void {
    // A CLI shares the database with the API that is running: this is the server's start-up work, not its own.
    if (this.env.cli) return
    if (!this.env.notificationsWatch || !this.notifications.enabled) return
    this.timer = setInterval(
      () => void this.tick().catch((error) => this.logger.warn({ err: error }, 'notify tick')),
      TICK_MS,
    )
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /** One check (tests call it). */
  async tick(now = new Date()): Promise<number> {
    if (this.ticking) return 0
    this.ticking = true
    try {
      let sent = 0
      const since = this.since
      this.since = now
      // A game waiting for the owner, who is not looking at it: once per decision.
      const waiting = await this.prisma.liveGame.findMany({
        where: { status: 'waiting' },
        select: { id: true, bot: true, decision: true, rivalLabel: true },
      })
      for (const game of waiting) {
        const ply = (game.decision as { ply?: number } | null)?.ply ?? 0
        if (this.told.get(game.id) === ply || this.presence.isWatching(`live:${game.id}`, now.getTime())) continue
        this.told.set(game.id, ply)
        sent += await this.notifications.notify('liveGame', {
          title: 'Te toca',
          body: `Partida #${game.id} contra ${game.rivalLabel || 'el bot'} (${botLabel(game.bot)}).`,
          url: `/jugar/${game.id}`,
          tag: `live-${game.id}`,
        })
      }
      // Jobs that ended since the last check.
      const ended = await this.prisma.simulationJob.findMany({
        where: { finishedAt: { gt: since, lte: now }, status: { in: ['done', 'failed'] } },
        select: { id: true, kind: true, label: true, status: true, params: true },
      })
      for (const job of ended) {
        const lab = (job.params as { lab?: { mode?: string; explore?: { base: number; incumbent: number } } } | null)
          ?.lab
        if (lab?.mode === 'explore') {
          const better = lab.explore && lab.explore.incumbent !== lab.explore.base
          sent += await this.notifications.notify('lab', {
            title: better ? 'El Laboratorio encontró una versión mejor' : 'Terminó la búsqueda del Laboratorio',
            body: `${job.label}${better ? ': mirala y actualizá el mazo si te convence.' : ': ninguna variante mejoró la lista.'}`,
            url: `/laboratorio/${job.id}`,
            tag: `job-${job.id}`,
          })
        } else {
          sent += await this.notifications.notify(lab ? 'lab' : 'simulations', {
            title: job.status === 'done' ? 'Simulación terminada' : 'Simulación con errores',
            body: `#${job.id} ${job.label}`,
            url: lab ? `/laboratorio/${job.id}` : `/simulacion/${job.id}`,
            tag: `job-${job.id}`,
          })
        }
      }
      // App alerts, at most every hour, each once.
      if (now.getTime() - this.lastAlerts >= ALERTS_EVERY_MS) {
        this.lastAlerts = now.getTime()
        sent += await this.alertsTick()
      }
      return sent
    } finally {
      this.ticking = false
    }
  }

  private async alertsTick(): Promise<number> {
    const alerts = await this.alerts.list().catch(() => [])
    const row = await this.prisma.appSetting.findUnique({ where: { key: 'notifiedAlerts' } })
    const done = new Set(Array.isArray(row?.value) ? (row.value as string[]) : [])
    let sent = 0
    for (const alert of alerts) {
      if (alert.code === 'limited_pack' && !/hoy es el último día|quedan 1 día/.test(alert.title)) continue
      // `notifyKey` when the alert says what makes a case new (new_era_likely: its era); the title otherwise. A key
      // stored before (`new_era_likely|Era nueva probable`, the same for every era) matches no case now and rolls out.
      const key = alert.notifyKey ?? `${alert.code}|${alert.title}`
      if (done.has(key)) continue
      done.add(key)
      sent += await this.notifications.notify('alerts', {
        title: alert.title,
        body: alert.detail,
        url: alert.link ?? '/mas',
        tag: `alert-${alert.code}`,
      })
    }
    const kept = [...done].slice(-200)
    await this.prisma.appSetting.upsert({
      where: { key: 'notifiedAlerts' },
      create: { key: 'notifiedAlerts', value: kept as Prisma.InputJsonValue },
      update: { value: kept as Prisma.InputJsonValue },
    })
    return sent
  }
}
