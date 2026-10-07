import { Module } from '@nestjs/common'
import { DeckComparisonController, MatchesController } from './matches.controller.js'
import { MatchesService } from './matches.service.js'

@Module({
  controllers: [MatchesController, DeckComparisonController],
  providers: [MatchesService],
  exports: [MatchesService],
})
export class MatchesModule {}
