/**
 * Exposure rules (docs/PLAN.md §3.9). Everything requires the session cookie except:
 * - public: GET /healthz, GET /login, POST /api/auth/login, /.well-known/*
 * - bearer: /api/mcp and /api/worker/* (API tokens, enforced by BearerTokenGuard on those controllers)
 * The PWA shell, manifest, service worker and chunks are NOT public.
 */
export type RouteExposure = 'public' | 'bearer' | 'session'

/**
 * Full request pathname. Nest mounts `forRoutes('*')` middleware under a wildcard, which makes Express' `req.path`
 * relative to the mount point ('/'); `originalUrl` always carries the complete path.
 */
export function requestPathname(req: { originalUrl?: string; url?: string }): string {
  const raw = req.originalUrl ?? req.url ?? '/'
  const end = raw.indexOf('?')
  const pathname = end === -1 ? raw : raw.slice(0, end)
  return pathname === '' ? '/' : pathname
}

function startsWithSegment(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function routeExposure(method: string, pathname: string): RouteExposure {
  const verb = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase()
  if (verb === 'GET' && (pathname === '/healthz' || pathname === '/login')) return 'public'
  if (verb === 'POST' && pathname === '/api/auth/login') return 'public'
  if (startsWithSegment(pathname, '/.well-known')) return 'public'
  if (startsWithSegment(pathname, '/api/mcp') || startsWithSegment(pathname, '/api/worker')) return 'bearer'
  return 'session'
}

export function wantsHtml(accept: string | undefined): boolean {
  return accept?.includes('text/html') ?? false
}

export type UnauthenticatedAction = { kind: 'redirect'; location: '/login' } | { kind: 'json'; status: 401 }

/**
 * Browser GETs outside /api (navigations, the shell, chunks: PLAN §7 "GET / y GET /assets/*.js redirigen a /login")
 * go to the login page; API calls, non-GET requests and JSON-preferring clients get a 401 JSON body.
 */
export function unauthenticatedAction(
  method: string,
  pathname: string,
  accept: string | undefined,
): UnauthenticatedAction {
  const verb = method.toUpperCase()
  if (verb !== 'GET' && verb !== 'HEAD') return { kind: 'json', status: 401 }
  if (startsWithSegment(pathname, '/api')) return { kind: 'json', status: 401 }
  if (accept?.includes('application/json') && !wantsHtml(accept)) return { kind: 'json', status: 401 }
  return { kind: 'redirect', location: '/login' }
}
