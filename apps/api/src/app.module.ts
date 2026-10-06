import { type DynamicModule, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'
import { AuthModule } from './auth/auth.module.js'
import { CatalogModule } from './catalog/catalog.module.js'
import { configModule } from './config/config.module.js'
import type { Env } from './config/env.js'
import { HttpModule } from './http/http.module.js'
import { ApiExceptionFilter } from './http/http-exception.filter.js'
import { SecurityHeadersMiddleware } from './http/security-headers.middleware.js'
import { SessionMiddleware } from './http/session.middleware.js'
import { loggerModule } from './logging/logger.module.js'
import { McpModule } from './mcp/mcp.module.js'
import { PrismaModule } from './prisma/prisma.module.js'
import { TokensModule } from './tokens/tokens.module.js'
import { WebModule } from './web/web.module.js'
import { WorkerModule } from './worker/worker.module.js'

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
        ScheduleModule.forRoot(),
        PrismaModule,
        AuthModule,
        TokensModule,
        CatalogModule,
        HttpModule,
        WorkerModule,
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
