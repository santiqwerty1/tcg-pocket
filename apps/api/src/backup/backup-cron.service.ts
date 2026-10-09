import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PinoLogger } from 'nestjs-pino'
import { ENV, type Env } from '../config/env.js'
import { OWNER_TIME_ZONE } from '../config/time-zone.js'
import { BACKUP_FAILURE_KEY } from '../ops/ops.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { BackupService } from './backup.service.js'

/** The owner's local time: the container runs in UTC, so the schedule names the zone explicitly. */
export const BACKUP_CRON_TIMEZONE = OWNER_TIME_ZONE

/** Daily snapshot at 04:00 Buenos Aires time into `backup_blobs`; `BACKUP_CRON` turns it on (default: production). */
@Injectable()
export class BackupCronService implements OnModuleInit {
  constructor(
    private readonly backup: BackupService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(BackupCronService.name)
  }

  onModuleInit(): void {
    this.logger.info({ enabled: this.env.backupCron, timeZone: BACKUP_CRON_TIMEZONE }, 'daily backup cron')
  }

  /** Fase 35: the 1st of each month at 04:30, the restore drill (a failure shows up in Avisos and is pushed). */
  @Cron('30 4 1 * *', { timeZone: BACKUP_CRON_TIMEZONE })
  async monthly(): Promise<void> {
    if (!this.env.backupCron) return
    await this.backup.drill().catch((error) => this.logger.error({ err: error }, 'backup drill crashed'))
  }

  @Cron('0 4 * * *', { timeZone: BACKUP_CRON_TIMEZONE })
  async daily(): Promise<void> {
    if (!this.env.backupCron) return
    try {
      await this.backup.snapshot()
    } catch (error) {
      this.logger.error({ err: error }, 'daily backup failed')
      // Fase 38 (R-011): kept for Avisos, which push it to the phone (a log line alone nobody reads).
      const value = {
        at: new Date().toISOString(),
        error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      }
      await this.prisma.appSetting
        .upsert({ where: { key: BACKUP_FAILURE_KEY }, create: { key: BACKUP_FAILURE_KEY, value }, update: { value } })
        .catch((saveError) => this.logger.error({ err: saveError }, 'could not record the backup failure'))
    }
  }
}
