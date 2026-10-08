import { Module } from '@nestjs/common'
import { SimulationModule } from '../simulation/simulation.controller.js'
import { TournamentsModule } from '../tournaments/tournaments.controller.js'
import { DeckComparisonController, MatchesController } from './matches.controller.js'
import { MatchesService } from './matches.service.js'

@Module({
  imports: [TournamentsModule, SimulationModule],
  controllers: [MatchesController, DeckComparisonController],
  providers: [MatchesService],
  exports: [MatchesService],
})
export class MatchesModule {}
