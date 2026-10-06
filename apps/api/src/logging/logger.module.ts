import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DynamicModule } from '@nestjs/common'
import { LoggerModule } from 'nestjs-pino'
import type { Env } from '../config/env.js'

/**
 * Request logging with pino. The request serializer only emits method, url and client address, so cookies and
 * `Authorization` headers never reach the logs; `redact` covers anything a custom log line might attach.
 */
export function loggerModule(env: Env): DynamicModule {
  const pretty = !env.isProduction && !env.isTest && env.logLevel !== 'silent'
  return LoggerModule.forRoot({
    pinoHttp: {
      level: env.logLevel,
      ...(pretty
        ? {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, singleLine: true, translateTime: 'HH:MM:ss' },
            },
          }
        : {}),
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        censor: '[redacted]',
      },
      autoLogging: { ignore: (req: IncomingMessage) => req.url === '/healthz' },
      serializers: {
        req: (req: IncomingMessage & { id?: unknown; remoteAddress?: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
          remoteAddress: req.remoteAddress,
        }),
        res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
      },
    },
  })
}
