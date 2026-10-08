/** Notificaciones (Fase 18, docs/API.md «Notificaciones»): session-protected. */
import { Body, Controller, Delete, Get, HttpCode, Module, Post, Put } from '@nestjs/common'
import { z } from 'zod'
import { AlertsModule } from '../alerts/alerts.controller.js'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { NOTIFICATION_KINDS, NotificationsService, PushSender } from './notifications.service.js'
import { NotificationsWatcher } from './notifications.watcher.js'

const subscribeSchema = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({ p256dh: z.string().min(10).max(500), auth: z.string().min(4).max(200) }),
  userAgent: z.string().max(300).optional(),
})
const unsubscribeSchema = z.object({ endpoint: z.url().max(2000) })
const preferencesSchema = z.object(
  Object.fromEntries(NOTIFICATION_KINDS.map((kind) => [kind, z.boolean().optional()])) as Record<
    (typeof NOTIFICATION_KINDS)[number],
    z.ZodOptional<z.ZodBoolean>
  >,
)

@Controller('api/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  status(@CurrentSession() _session: RequestSession) {
    return this.notifications.status()
  }

  @Post('subscribe')
  @HttpCode(204)
  async subscribe(
    @Body(new ZodValidationPipe(subscribeSchema)) body: z.infer<typeof subscribeSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<void> {
    await this.notifications.subscribe(body)
  }

  @Delete('subscribe')
  @HttpCode(204)
  async unsubscribe(
    @Body(new ZodValidationPipe(unsubscribeSchema)) body: z.infer<typeof unsubscribeSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<void> {
    await this.notifications.unsubscribe(body.endpoint)
  }

  @Put('preferences')
  preferences(
    @Body(new ZodValidationPipe(preferencesSchema)) body: z.infer<typeof preferencesSchema>,
    @CurrentSession() _session: RequestSession,
  ) {
    return this.notifications.setPreferences(body)
  }

  /** A test notification to every device: `{ sent }`. */
  @Post('test')
  @HttpCode(200)
  async test(@CurrentSession() _session: RequestSession): Promise<{ sent: number }> {
    return {
      sent: await this.notifications.notify(null, {
        title: 'TCG Pocket',
        body: 'Las notificaciones funcionan en este dispositivo.',
        url: '/mas/ajustes',
        tag: 'test',
      }),
    }
  }
}

@Module({
  imports: [AlertsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, PushSender, NotificationsWatcher],
  exports: [NotificationsService, NotificationsWatcher],
})
export class NotificationsModule {}
