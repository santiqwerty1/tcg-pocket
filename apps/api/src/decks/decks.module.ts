import { Module } from '@nestjs/common'
import { CatalogModule } from '../catalog/catalog.module.js'
import { CollectionModule } from '../collection/collection.module.js'
import { DecksController } from './decks.controller.js'
import { DecksService } from './decks.service.js'

@Module({
  imports: [CatalogModule, CollectionModule],
  controllers: [DecksController],
  providers: [DecksService],
  exports: [DecksService],
})
export class DecksModule {}
