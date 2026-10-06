import { Module } from '@nestjs/common'
import { CatalogModule } from '../catalog/catalog.module.js'
import { CollectionController } from './collection.controller.js'
import { CollectionRepository } from './collection.repository.js'
import { CollectionService } from './collection.service.js'

@Module({
  imports: [CatalogModule],
  controllers: [CollectionController],
  providers: [CollectionRepository, CollectionService],
  exports: [CollectionRepository, CollectionService],
})
export class CollectionModule {}
