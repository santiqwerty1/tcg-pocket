/** Avisos (Fase 8, docs/API.md «Avisos»). */
import { Controller, Get, Module } from '@nestjs/common'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { CatalogModule } from '../catalog/catalog.module.js'
import { SimulationModule } from '../simulation/simulation.controller.js'
import { TournamentsModule } from '../tournaments/tournaments.controller.js'
import { AlertsService, type AlertView, TrackerUpstreamService } from './alerts.service.js'

@Controller('api/alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  async list(@CurrentSession() _session: RequestSession): Promise<{ items: AlertView[] }> {
    return { items: await this.alerts.list() }
  }
}

@Module({
  imports: [CatalogModule, TournamentsModule, SimulationModule],
  controllers: [AlertsController],
  providers: [AlertsService, TrackerUpstreamService],
  exports: [TrackerUpstreamService],
})
export class AlertsModule {}
