import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PinoLogger } from 'nestjs-pino'
import { ENV, type Env } from '../config/env.js'
import { OWNER_TIME_ZONE } from '../config/time-zone.js'
import { BackupService } from './backup.service.js'

/** The owner's local time: the container runs in UTC, so the schedule names the zone explicitly. */
export const BACKUP_CRON_TIMEZONE = OWNER_TIME_ZONE

/** Daily snapshot at 04:00 Buenos Aires time into `backup_blobs`; `BACKUP_CRON` turns it on (default: production). */
@Injectable()
export class BackupCronService implements OnModuleInit {
  constructor(
    private readonly backup: BackupService,
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(BackupCronService.name)
  }

  onModuleInit(): void {
    this.logger.info({ enabled: this.env.backupCron, timeZone: BACKUP_CRON_TIMEZONE }, 'daily backup cron')
  }

  @Cron('0 4 * * *', { timeZone: BACKUP_CRON_TIMEZONE })
  async daily(): Promise<void> {
    if (!this.env.backupCron) return
    try {
      await this.backup.snapshot()
    } catch (error) {
      this.logger.error({ err: error }, 'daily backup failed')
    }
  }
}
