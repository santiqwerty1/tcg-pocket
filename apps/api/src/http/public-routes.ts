/**
 * Exposure rules (docs/PLAN.md §3.9). Everything requires the session cookie except:
 * - public: GET /healthz, GET /login, POST /api/auth/login, /.well-known/*, and the PWA's install metadata: GET
 *   /manifest.webmanifest, /icons/*, /favicon.svg, /apple-touch-icon.png (Chrome fetches the manifest without cookies
 *   and Android builds the installed app from its icons; they carry no data of the owner)
 * - bearer: /api/mcp and /api/worker/* (API tokens, enforced by BearerTokenGuard on those controllers)
 * The PWA shell, service worker and chunks are NOT public.
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

/** What Chrome needs to offer «Instalar app» before anyone logs in (no data of the owner in them). */
const INSTALL_FILES = new Set(['/manifest.webmanifest', '/favicon.svg', '/apple-touch-icon.png', '/push-sw.js'])

export function routeExposure(method: string, pathname: string): RouteExposure {
  const verb = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase()
  if (verb === 'GET' && pathname === '/api/worker/install/android.sh') return 'public'
  if (verb === 'GET' && (pathname === '/healthz' || pathname === '/login')) return 'public'
  if (verb === 'GET' && (INSTALL_FILES.has(pathname) || /^\/icons\/[\w.-]+\.png$/.test(pathname))) return 'public'
  if (verb === 'POST' && pathname === '/api/auth/login') return 'public'
  if (startsWithSegment(pathname, '/.well-known')) return 'public'
  if (startsWithSegment(pathname, '/api/mcp') || startsWithSegment(pathname, '/api/worker')) return 'bearer'
  return 'session'
}

export function wantsHtml(accept: string | undefined): boolean {
  return accept?.includes('text/html') ?? false
}

export interface WriteRequestHeaders {
  secFetchSite?: string | undefined
  origin?: string | undefined
}

/**
 * Belt and braces over `SameSite=Lax` for the cookie-authenticated routes: a request that can change state (anything
 * but GET/HEAD/OPTIONS) is refused when the browser says it comes from another site (`Sec-Fetch-Site: cross-site`)
 * or when its `Origin` is not the origin serving the app (`null` included). Requests without either header (curl,
 * supertest, old browsers) pass: the cookie attributes still protect them.
 */
export function isCrossSiteWrite(method: string, headers: WriteRequestHeaders, ownOrigin: string): boolean {
  const verb = method.toUpperCase()
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return false
  if (headers.secFetchSite?.toLowerCase() === 'cross-site') return true
  if (headers.origin !== undefined && headers.origin.toLowerCase() !== ownOrigin.toLowerCase()) return true
  return false
}

export type UnauthenticatedAction = { kind: 'redirect'; location: '/login' } | { kind: 'json'; status: 401 }

/**
 * Browser GETs outside /api (navigations, the shell, chunks: PLAN §7 "GET / y GET /assets/*.js redirigen a /login")
 * go to the login page; API calls, the browser's engine (/engine/), non-GET requests and JSON-preferring clients get a
 * 401 JSON body.
 */
export function unauthenticatedAction(
  method: string,
  pathname: string,
  accept: string | undefined,
): UnauthenticatedAction {
  const verb = method.toUpperCase()
  if (verb !== 'GET' && verb !== 'HEAD') return { kind: 'json', status: 401 }
  if (startsWithSegment(pathname, '/api')) return { kind: 'json', status: 401 }
  // T-015: the browser's engine is fetched by its Web Worker and kept by the service worker: the login page in its place
  // would be kept as the engine (review of #86).
  if (startsWithSegment(pathname, '/engine')) return { kind: 'json', status: 401 }
  if (accept?.includes('application/json') && !wantsHtml(accept)) return { kind: 'json', status: 401 }
  return { kind: 'redirect', location: '/login' }
}
