import { type DynamicModule, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'
import { AlertsModule } from './alerts/alerts.controller.js'
import { AuthModule } from './auth/auth.module.js'
import { BackupModule } from './backup/backup.module.js'
import { CatalogModule } from './catalog/catalog.module.js'
import { CollectionModule } from './collection/collection.module.js'
import { configModule } from './config/config.module.js'
import type { Env } from './config/env.js'
import { DecksModule } from './decks/decks.module.js'
import { DrillsModule } from './drills/drills.controller.js'
import { EventsModule } from './events/events.controller.js'
import { HttpModule } from './http/http.module.js'
import { ApiExceptionFilter } from './http/http-exception.filter.js'
import { SecurityHeadersMiddleware } from './http/security-headers.middleware.js'
import { SessionMiddleware } from './http/session.middleware.js'
import { LabModule } from './lab/lab.controller.js'
import { loggerModule } from './logging/logger.module.js'
import { MatchesModule } from './matches/matches.module.js'
import { McpModule } from './mcp/mcp.module.js'
import { NextBuildModule } from './next-build/next-build.controller.js'
import { NotificationsModule } from './notifications/notifications.controller.js'
import { PresenceModule } from './notifications/presence.service.js'
import { PacksModule } from './packs/packs.controller.js'
import { PickModule } from './pick/pick.controller.js'
import { PlayModule } from './play/play.controller.js'
import { PrismaModule } from './prisma/prisma.module.js'
import { RankedModule } from './ranked/ranked.controller.js'
import { RivalNotesModule } from './rivals/rival-notes.controller.js'
import { SearchModule } from './search/search.controller.js'
import { SettingsModule } from './settings/settings.module.js'
import { CalibrationModule } from './simulation/calibration.controller.js'
import { SimulationModule } from './simulation/simulation.controller.js'
import { WorkerPackagesModule } from './simulation/worker-packages.controller.js'
import { TokensModule } from './tokens/tokens.module.js'
import { TournamentsModule } from './tournaments/tournaments.controller.js'
import { TradesModule } from './trades/trades.controller.js'
import { WebModule } from './web/web.module.js'
import { WeeklyModule } from './weekly/weekly.controller.js'

/**
 * Single process: REST API + PWA static serving + bearer-token integrations (PLAN §3). `WebModule` goes last so its
 * static handler and SPA fallback are registered after every controller route.
 */
@Module({})
export class AppModule implements NestModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        configModule(env),
        loggerModule(env),
        // The crons are the server's: a CLI context (`env.cli`) registers none.
        ...(env.cli ? [] : [ScheduleModule.forRoot()]),
        PrismaModule,
        PresenceModule,
        AuthModule,
        TokensModule,
        CatalogModule,
        CollectionModule,
        DecksModule,
        EventsModule,
        MatchesModule,
        RivalNotesModule,
        RankedModule,
        PacksModule,
        TournamentsModule,
        SettingsModule,
        BackupModule,
        HttpModule,
        SimulationModule,
        WorkerPackagesModule,
        LabModule,
        CalibrationModule,
        PickModule,
        NextBuildModule,
        SearchModule,
        DrillsModule,
        TradesModule,
        WeeklyModule,
        PlayModule,
        AlertsModule,
        NotificationsModule,
        McpModule,
        WebModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
    }
  }

  /** Security headers and the session check run before every route and before the static files. */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SecurityHeadersMiddleware, SessionMiddleware).forRoutes('*')
  }
}
