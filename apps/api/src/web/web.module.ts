import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Inject, Module, type OnModuleInit } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { PinoLogger } from 'nestjs-pino'
import { ENV, type Env } from '../config/env.js'
import { requestPathname, wantsHtml } from '../http/public-routes.js'

const IMMUTABLE = 'public, max-age=31536000, immutable'
const NO_STORE = 'no-store'
/** Shell files the browser must always revalidate (PWA updates, logout clearing). */
const NO_STORE_FILES = new Set(['index.html', 'sw.js', 'manifest.webmanifest', 'registerSW.js'])

export function cacheControlFor(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (normalized.startsWith('assets/')) return IMMUTABLE
  if (NO_STORE_FILES.has(normalized) || /^workbox-.*\.js$/.test(normalized)) return NO_STORE
  return 'no-cache'
}

/** GET/HEAD browser navigations outside /api fall back to the SPA shell. */
export function isSpaNavigation(method: string, pathname: string, accept: string | undefined): boolean {
  const verb = method.toUpperCase()
  if (verb !== 'GET' && verb !== 'HEAD') return false
  if (pathname === '/api' || pathname.startsWith('/api/')) return false
  return wantsHtml(accept)
}

const MISSING_BUILD_PAGE = `<!doctype html><html lang="es"><meta charset="utf-8"><title>TCG Pocket</title>
<body style="font-family:system-ui;padding:2rem"><h1>La interfaz no está compilada</h1>
<p>Ejecutá <code>pnpm -F @tcg/web build</code> o apuntá <code>WEB_DIST</code> a la carpeta <code>dist</code> de la PWA.</p></body></html>`

/**
 * Serves the built PWA (WEB_DIST) behind the session middleware. Registered in `onModuleInit`, which Nest runs after
 * the controllers' routes and before its 404 handler: API routes win, the SPA fallback catches the rest.
 */
@Module({})
export class WebModule implements OnModuleInit {
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WebModule.name)
  }

  onModuleInit(): void {
    const adapter = this.adapterHost.httpAdapter
    if (!adapter) return // application context (CLI): no HTTP server
    const app = adapter.getInstance<Express>()
    const dist = this.env.webDist
    const indexFile = join(dist, 'index.html')
    const built = existsSync(indexFile)
    if (built) {
      app.use(
        express.static(dist, {
          index: false,
          redirect: false,
          fallthrough: true,
          setHeaders: (res, filePath) => {
            res.setHeader('Cache-Control', cacheControlFor(filePath.slice(dist.length)))
          },
        }),
      )
    } else {
      this.logger.warn({ webDist: dist }, 'PWA build not found; serving a placeholder for navigations')
    }
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (!isSpaNavigation(req.method, requestPathname(req), req.headers.accept)) {
        next()
        return
      }
      res.setHeader('Cache-Control', NO_STORE)
      if (built) res.sendFile(indexFile)
      else res.status(503).type('html').send(MISSING_BUILD_PAGE)
    })
  }
}
