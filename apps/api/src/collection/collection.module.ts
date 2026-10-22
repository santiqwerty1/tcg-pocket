import { Module } from '@nestjs/common'
import { CatalogModule } from '../catalog/catalog.module.js'
import { CollectionController } from './collection.controller.js'
import { CollectionRepository } from './collection.repository.js'
import { CollectionService } from './collection.service.js'
import { DotggClient } from './dotgg-client.js'
import { DotggLinkStore } from './dotgg-link.store.js'
import { DotggSyncController, TrackerGapController } from './dotgg-sync.controller.js'
import { DotggSync } from './dotgg-sync.service.js'
import { TrackerClient } from './tracker-client.js'
import { TrackerGapService } from './tracker-gap.service.js'
import { TrackerSyncController } from './tracker-sync.controller.js'
import { TrackerSync } from './tracker-sync.service.js'

@Module({
  imports: [CatalogModule],
  controllers: [CollectionController, TrackerSyncController, DotggSyncController, TrackerGapController],
  providers: [
    CollectionRepository,
    CollectionService,
    TrackerClient,
    TrackerSync,
    DotggLinkStore,
    DotggClient,
    DotggSync,
    TrackerGapService,
  ],
  exports: [CollectionRepository, CollectionService, TrackerGapService],
})
export class CollectionModule {}
