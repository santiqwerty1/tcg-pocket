import { Inject, Injectable, type NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { ENV, type Env } from '../config/env.js'

/**
 * Baseline CSP for the Vite SPA: own scripts/styles only (Tailwind emits inline styles, hence 'unsafe-inline' for
 * style-src), card images from the tracker's raw GitHub URLs (invariant I11: links, never copies), no framing.
 * The login page overrides script-src with a per-response nonce for its inline script.
 */
export function contentSecurityPolicy(scriptNonce?: string): string {
  const scriptSrc = scriptNonce ? `'self' 'nonce-${scriptNonce}'` : "'self'"
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://raw.githubusercontent.com",
    "font-src 'self' data:",
    "connect-src 'self'",
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

  use(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('Content-Security-Policy', contentSecurityPolicy())
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    if (this.hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    next()
  }
}
