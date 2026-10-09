import { Module } from '@nestjs/common'
import { CatalogController } from './catalog.controller.js'
import { CatalogService } from './catalog.service.js'
import { CatalogRepository } from './catalog-repository.js'
import { CatalogSyncService } from './catalog-sync.service.js'
import { TrackerCommitsService } from './tracker-commits.service.js'

@Module({
  controllers: [CatalogController],
  providers: [CatalogRepository, CatalogService, CatalogSyncService, TrackerCommitsService],
  exports: [CatalogService, CatalogSyncService, CatalogRepository, TrackerCommitsService],
})
export class CatalogModule {}
