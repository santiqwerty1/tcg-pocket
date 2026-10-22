import { Module } from '@nestjs/common'
import { CatalogModule } from '../catalog/catalog.module.js'
import { RankedModule } from '../ranked/ranked.controller.js'
import { SimulationModule } from '../simulation/simulation.controller.js'
import { TournamentsModule } from '../tournaments/tournaments.controller.js'
import { DeckComparisonController, MatchesController } from './matches.controller.js'
import { MatchesService } from './matches.service.js'
import { SheetImportService } from './sheet-import.service.js'

@Module({
  imports: [TournamentsModule, SimulationModule, CatalogModule, RankedModule],
  controllers: [MatchesController, DeckComparisonController],
  providers: [MatchesService, SheetImportService],
  exports: [MatchesService],
})
export class MatchesModule {}
