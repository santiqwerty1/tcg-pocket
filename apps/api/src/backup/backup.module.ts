import { Module } from '@nestjs/common'
import { CatalogModule } from '../catalog/catalog.module.js'
import { CollectionModule } from '../collection/collection.module.js'
import { TournamentsModule } from '../tournaments/tournaments.controller.js'
import { BackupController } from './backup.controller.js'
import { BackupService } from './backup.service.js'
import { BackupCronService } from './backup-cron.service.js'
import { OffsiteBackupService } from './offsite.service.js'

@Module({
  imports: [CatalogModule, CollectionModule, TournamentsModule],
  controllers: [BackupController],
  providers: [BackupService, BackupCronService, OffsiteBackupService],
  exports: [BackupService, OffsiteBackupService],
})
export class BackupModule {}
