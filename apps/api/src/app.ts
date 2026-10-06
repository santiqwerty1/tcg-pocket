import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Logger } from 'nestjs-pino'
import { AppModule } from './app.module.js'
import type { Env } from './config/env.js'

/** JSON bodies up to 10 MB (CSV uploads arrive as multipart later). */
export const JSON_BODY_LIMIT = '10mb'

/** Builds the HTTP application (shared by main.ts and the e2e tests). The caller listens or inits. */
export async function createApp(env: Env): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    bufferLogs: true,
    bodyParser: false,
  })
  app.useLogger(app.get(Logger))
  app.set('trust proxy', env.trustProxy)
  app.disable('x-powered-by')
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT })
  app.enableShutdownHooks()
  return app
}
