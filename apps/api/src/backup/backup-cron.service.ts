import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PinoLogger } from 'nestjs-pino'
import { ENV, type Env } from '../config/env.js'
import { BackupService } from './backup.service.js'

/** Daily snapshot at 04:00 (server time) into `backup_blobs`; `BACKUP_CRON` turns it on (default: production). */
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
    this.logger.info({ enabled: this.env.backupCron }, 'daily backup cron')
  }

  @Cron('0 4 * * *')
  async daily(): Promise<void> {
    if (!this.env.backupCron) return
    try {
      await this.backup.snapshot()
    } catch (error) {
      this.logger.error({ err: error }, 'daily backup failed')
    }
  }
}
