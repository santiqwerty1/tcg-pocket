import { Module } from '@nestjs/common'
import { CatalogModule } from '../catalog/catalog.module.js'
import { BackupController } from './backup.controller.js'
import { BackupService } from './backup.service.js'
import { BackupCronService } from './backup-cron.service.js'

@Module({
  imports: [CatalogModule],
  controllers: [BackupController],
  providers: [BackupService, BackupCronService],
  exports: [BackupService],
})
export class BackupModule {}
