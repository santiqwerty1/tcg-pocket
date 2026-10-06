import { Injectable, type NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { SessionService } from '../auth/session.service.js'
import { readSessionId } from '../auth/session-cookie.js'
import type { ApiErrorBody } from './http-exception.filter.js'
import { requestPathname, routeExposure, unauthenticatedAction } from './public-routes.js'

export const UNAUTHENTICATED_BODY: ApiErrorBody = {
  error: { code: 'unauthenticated', message: 'Necesitás iniciar sesión.' },
}

/**
 * Runs before every route and before the static files: resolves the session cookie, applies the sliding expiry and
 * blocks anything that is not public or bearer-guarded. Registered for '*' in AppModule.
 */
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(private readonly sessions: SessionService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const pathname = requestPathname(req)
    const exposure = routeExposure(req.method, pathname)
    const id = exposure === 'bearer' ? null : readSessionId(req.headers.cookie, this.sessions.cookieName)
    if (id !== null) {
      const resolved = await this.sessions.resolve(id)
      if (resolved) {
        req.session = resolved.session
        if (resolved.refreshedCookie) res.append('Set-Cookie', resolved.refreshedCookie)
      } else if (exposure === 'session') {
        // Stale cookie: drop it so the browser stops sending it.
        res.append('Set-Cookie', this.sessions.clearCookie())
      }
    }
    if (exposure !== 'session' || req.session) {
      next()
      return
    }
    res.setHeader('Cache-Control', 'no-store')
    const action = unauthenticatedAction(req.method, pathname, req.headers.accept)
    if (action.kind === 'redirect') {
      res.redirect(302, action.location)
      return
    }
    res.status(401).json(UNAUTHENTICATED_BODY)
  }
}
