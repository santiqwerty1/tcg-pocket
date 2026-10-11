import { Module } from '@nestjs/common'
import { CatalogModule } from '../catalog/catalog.module.js'
import { CollectionController } from './collection.controller.js'
import { CollectionRepository } from './collection.repository.js'
import { CollectionService } from './collection.service.js'
import { TrackerClient } from './tracker-client.js'
import { TrackerSyncController } from './tracker-sync.controller.js'
import { TrackerSync } from './tracker-sync.service.js'

@Module({
  imports: [CatalogModule],
  controllers: [CollectionController, TrackerSyncController],
  providers: [CollectionRepository, CollectionService, TrackerClient, TrackerSync],
  exports: [CollectionRepository, CollectionService],
})
export class CollectionModule {}
