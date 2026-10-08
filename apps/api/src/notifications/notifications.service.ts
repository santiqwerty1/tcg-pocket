/**
 * Notificaciones al celu (Fase 18): Web Push to the devices the owner subscribed (VAPID keys in the environment;
 * without them everything here is off). What goes out and when is decided by `NotificationsWatcher`; this service
 * keeps the subscriptions and the preferences and sends.
 */
import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import webpush from 'web-push'
import { z } from 'zod'
import { ENV, type Env } from '../config/env.js'
import type { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'

export const NOTIFICATION_KINDS = ['liveGame', 'simulations', 'lab', 'alerts'] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]
export type NotificationPreferences = Record<NotificationKind, boolean>

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  liveGame: true,
  simulations: true,
  lab: true,
  alerts: true,
}
const preferencesSchema = z.object(
  Object.fromEntries(NOTIFICATION_KINDS.map((kind) => [kind, z.boolean().optional()])) as Record<
    NotificationKind,
    z.ZodOptional<z.ZodBoolean>
  >,
)

export interface PushPayload {
  title: string
  body: string
  /** Where tapping it opens, inside the app. */
  url: string
  /** Same tag replaces the previous notification instead of stacking. */
  tag?: string
}

/** The actual sending (tests swap `send`). Throws `{ statusCode }` like web-push. */
@Injectable()
export class PushSender {
  constructor(@Inject(ENV) env: Env) {
    if (env.vapid) webpush.setVapidDetails(env.vapid.subject, env.vapid.publicKey, env.vapid.privateKey)
  }

  send = async (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => {
    await webpush.sendNotification(subscription, payload, { TTL: 60 * 60 })
  }
}

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly sender: PushSender,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(NotificationsService.name)
  }

  get enabled(): boolean {
    return this.env.vapid !== null
  }

  async preferences(): Promise<NotificationPreferences> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: 'notifications' } })
    const parsed = preferencesSchema.safeParse(row?.value ?? {})
    return { ...DEFAULT_PREFERENCES, ...(parsed.success ? parsed.data : {}) } as NotificationPreferences
  }

  async setPreferences(patch: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    const next = { ...(await this.preferences()), ...patch }
    await this.prisma.appSetting.upsert({
      where: { key: 'notifications' },
      create: { key: 'notifications', value: next as Prisma.InputJsonValue },
      update: { value: next as Prisma.InputJsonValue },
    })
    return next
  }

  async status(): Promise<{
    enabled: boolean
    publicKey: string | null
    devices: { id: number; userAgent: string; createdAt: Date; lastSuccessAt: Date | null; endpoint: string }[]
    preferences: NotificationPreferences
  }> {
    const devices = await this.prisma.pushSubscription.findMany({ orderBy: { id: 'asc' } })
    return {
      enabled: this.enabled,
      publicKey: this.env.vapid?.publicKey ?? null,
      devices: devices.map((device) => ({
        id: device.id,
        userAgent: device.userAgent,
        createdAt: device.createdAt,
        lastSuccessAt: device.lastSuccessAt,
        endpoint: device.endpoint,
      })),
      preferences: await this.preferences(),
    }
  }

  async subscribe(input: {
    endpoint: string
    keys: { p256dh: string; auth: string }
    userAgent?: string
  }): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent ?? '',
      },
      update: { p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: input.userAgent ?? '', failures: 0 },
    })
  }

  async unsubscribe(endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint } })
  }

  /**
   * Sends to every device when the kind is on (`null` kind: always, for the test). A device the push service says
   * is gone (404/410) is removed; other errors count failures and drop the device after 10.
   */
  async notify(kind: NotificationKind | null, payload: PushPayload): Promise<number> {
    if (!this.enabled) return 0
    if (kind !== null && !(await this.preferences())[kind]) return 0
    const devices = await this.prisma.pushSubscription.findMany()
    let sent = 0
    for (const device of devices) {
      try {
        await this.sender.send(
          { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
          JSON.stringify(payload),
        )
        sent += 1
        await this.prisma.pushSubscription.update({
          where: { id: device.id },
          data: { lastSuccessAt: new Date(), failures: 0 },
        })
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode
        if (status === 404 || status === 410 || device.failures + 1 >= 10) {
          await this.prisma.pushSubscription.delete({ where: { id: device.id } }).catch(() => undefined)
        } else {
          await this.prisma.pushSubscription.update({ where: { id: device.id }, data: { failures: { increment: 1 } } })
        }
        this.logger.warn({ status, err: error }, 'push failed')
      }
    }
    return sent
  }
}
