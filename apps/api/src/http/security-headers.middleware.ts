import { Inject, Injectable, type NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { ENV, type Env } from '../config/env.js'

/**
 * Baseline CSP for the Vite SPA: own scripts/styles only (Tailwind emits inline styles, hence 'unsafe-inline' for
 * style-src), card images from the tracker's raw GitHub URLs (invariant I11: links, never copies; the service worker
 * fetches them too, to keep the ones already seen — Fase 22 — hence connect-src), no framing.
 * The login page overrides script-src with a per-response nonce for its inline script. deckgym's replay viewer
 * (`/viewer/`, D-014) compiles PixiJS shaders with `new Function`: its pages alone get 'unsafe-eval'. The engine of the
 * browser (T-015) is WebAssembly, compiled in a Web Worker whose policy is the one of its script's response:
 * 'wasm-unsafe-eval' lets it compile WebAssembly and nothing else (no `eval`, no `new Function`).
 */
export function contentSecurityPolicy(scriptNonce?: string, options: { allowEval?: boolean } = {}): string {
  const scriptSrc = [
    "'self'",
    ...(scriptNonce ? [`'nonce-${scriptNonce}'`] : []),
    "'wasm-unsafe-eval'",
    ...(options.allowEval ? ["'unsafe-eval'"] : []),
  ].join(' ')
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://raw.githubusercontent.com",
    "font-src 'self' data:",
    "connect-src 'self' https://raw.githubusercontent.com",
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
}

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  private readonly hsts: boolean

  constructor(@Inject(ENV) env: Env) {
    this.hsts = env.cookieSecure
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const viewer = req.originalUrl.startsWith('/viewer/')
    res.setHeader('Content-Security-Policy', contentSecurityPolicy(undefined, { allowEval: viewer }))
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    if (this.hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    next()
  }
}
