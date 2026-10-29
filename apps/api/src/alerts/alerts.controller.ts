/** Avisos (Fase 8, docs/API.md «Avisos»). */
import { Controller, Get, Module } from '@nestjs/common'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { BackupModule } from '../backup/backup.module.js'
import { CatalogModule } from '../catalog/catalog.module.js'
import { OpsController } from '../ops/ops.controller.js'
import { OpsService } from '../ops/ops.service.js'
import { RetentionService } from '../ops/retention.service.js'
import { SimulationModule } from '../simulation/simulation.controller.js'
import { TournamentsModule } from '../tournaments/tournaments.controller.js'
import { AlertsService, type AlertView, TrackerUpstreamService } from './alerts.service.js'

@Controller('api/alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  async list(@CurrentSession() _session: RequestSession): Promise<{ items: Omit<AlertView, 'notifyKey'>[] }> {
    // `notifyKey` is the notifications' business, not the screen's.
    return { items: (await this.alerts.list()).map(({ notifyKey: _notifyKey, ...alert }) => alert) }
  }
}

@Module({
  imports: [CatalogModule, TournamentsModule, SimulationModule, BackupModule],
  controllers: [AlertsController, OpsController],
  providers: [AlertsService, TrackerUpstreamService, OpsService, RetentionService],
  exports: [TrackerUpstreamService, AlertsService, OpsService],
})
export class AlertsModule {}
