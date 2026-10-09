import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import compression from 'compression'
import { Logger } from 'nestjs-pino'
import { AppModule } from './app.module.js'
import type { Env } from './config/env.js'

/** JSON bodies up to 10 MB (CSV uploads arrive as multipart later). */
export const JSON_BODY_LIMIT = '10mb'

/** Server-sent events (`…/events`) and the MCP endpoint stream: they are never compressed. */
export function isStream(req: { path?: string; url?: string; headers: { accept?: string | undefined } }): boolean {
  const path = req.path ?? req.url ?? ''
  return (
    path.endsWith('/events') || path.startsWith('/api/mcp') || (req.headers.accept ?? '').includes('text/event-stream')
  )
}

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
  // H-015: compressed answers (JSON and the PWA's files), except streams: server-sent events and the MCP endpoint
  // would be held back by the compressor.
  app.use(compression({ filter: (req, res) => !isStream(req) && compression.filter(req, res) }))
  app.enableShutdownHooks()
  return app
}
