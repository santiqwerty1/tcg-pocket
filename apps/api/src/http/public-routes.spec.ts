import { isCrossSiteWrite, requestPathname, routeExposure, unauthenticatedAction, wantsHtml } from './public-routes.js'

describe('requestPathname', () => {
  it('uses the full original url without the query string', () => {
    expect(requestPathname({ originalUrl: '/api/cards?q=x', url: '/?q=x' })).toBe('/api/cards')
    expect(requestPathname({ originalUrl: '/login', url: '/' })).toBe('/login')
    expect(requestPathname({ url: '/x' })).toBe('/x')
    expect(requestPathname({ originalUrl: '' })).toBe('/')
  })
})

describe('routeExposure', () => {
  it('exposes only the documented public routes', () => {
    expect(routeExposure('GET', '/healthz')).toBe('public')
    expect(routeExposure('HEAD', '/healthz')).toBe('public')
    expect(routeExposure('GET', '/login')).toBe('public')
    expect(routeExposure('POST', '/api/auth/login')).toBe('public')
    expect(routeExposure('GET', '/.well-known/oauth-protected-resource')).toBe('public')
    expect(routeExposure('GET', '/.well-known')).toBe('public')
  })

  it('exposes what Chrome needs to install the PWA, and nothing else of it', () => {
    expect(routeExposure('GET', '/manifest.webmanifest')).toBe('public')
    expect(routeExposure('HEAD', '/manifest.webmanifest')).toBe('public')
    expect(routeExposure('GET', '/icons/icon-192.png')).toBe('public')
    expect(routeExposure('GET', '/icons/icon-maskable-512.png')).toBe('public')
    expect(routeExposure('GET', '/favicon.svg')).toBe('public')
    expect(routeExposure('GET', '/apple-touch-icon.png')).toBe('public')
    expect(routeExposure('GET', '/icons/../index.html')).toBe('session')
    expect(routeExposure('GET', '/icons/x.js')).toBe('session')
    expect(routeExposure('POST', '/manifest.webmanifest')).toBe('session')
  })

  it('routes the integrations to the bearer guard', () => {
    expect(routeExposure('POST', '/api/mcp')).toBe('bearer')
    expect(routeExposure('GET', '/api/mcp/')).toBe('bearer')
    expect(routeExposure('GET', '/api/worker/ping')).toBe('bearer')
    expect(routeExposure('POST', '/api/worker/claim')).toBe('bearer')
  })

  it('requires the session for everything else, including the PWA shell and chunks', () => {
    expect(routeExposure('GET', '/')).toBe('session')
    expect(routeExposure('GET', '/index.html')).toBe('session')
    expect(routeExposure('GET', '/sw.js')).toBe('session')
    expect(routeExposure('GET', '/assets/index-abc123.js')).toBe('session')
    expect(routeExposure('GET', '/api/auth/me')).toBe('session')
    expect(routeExposure('POST', '/api/auth/logout')).toBe('session')
    expect(routeExposure('GET', '/api/auth/login')).toBe('session')
    expect(routeExposure('POST', '/login')).toBe('session')
    expect(routeExposure('GET', '/healthz/extra')).toBe('session')
    expect(routeExposure('GET', '/api/workers')).toBe('session')
    expect(routeExposure('GET', '/api/mcpx')).toBe('session')
    expect(routeExposure('GET', '/.well-knownx')).toBe('session')
  })
})

describe('unauthenticatedAction', () => {
  it('redirects browser GETs outside /api to /login (navigations, shell and chunks)', () => {
    expect(unauthenticatedAction('GET', '/', 'text/html,application/xhtml+xml')).toEqual({
      kind: 'redirect',
      location: '/login',
    })
    expect(unauthenticatedAction('GET', '/decks/3', 'text/html')).toEqual({ kind: 'redirect', location: '/login' })
    expect(unauthenticatedAction('GET', '/assets/x.js', '*/*')).toEqual({ kind: 'redirect', location: '/login' })
    expect(unauthenticatedAction('HEAD', '/sw.js', undefined)).toEqual({
      kind: 'redirect',
      location: '/login',
    })
  })

  it('answers 401 JSON to API calls, JSON clients and non-GET methods', () => {
    expect(unauthenticatedAction('GET', '/api/auth/me', 'text/html')).toEqual({ kind: 'json', status: 401 })
    expect(unauthenticatedAction('GET', '/api/cards', '*/*')).toEqual({ kind: 'json', status: 401 })
    expect(unauthenticatedAction('GET', '/sw.js', 'application/json')).toEqual({ kind: 'json', status: 401 })
    expect(unauthenticatedAction('POST', '/decks', 'text/html')).toEqual({ kind: 'json', status: 401 })
    expect(unauthenticatedAction('DELETE', '/x', undefined)).toEqual({ kind: 'json', status: 401 })
  })

  it('detects html accept headers', () => {
    expect(wantsHtml('text/html')).toBe(true)
    expect(wantsHtml('application/json')).toBe(false)
    expect(wantsHtml(undefined)).toBe(false)
  })
})

describe('isCrossSiteWrite', () => {
  const own = 'https://tcg-pocket.fly.dev'

  it('never blocks reads', () => {
    expect(isCrossSiteWrite('GET', { secFetchSite: 'cross-site', origin: 'https://evil.example' }, own)).toBe(false)
    expect(isCrossSiteWrite('HEAD', { secFetchSite: 'cross-site' }, own)).toBe(false)
    expect(isCrossSiteWrite('OPTIONS', { origin: 'https://evil.example' }, own)).toBe(false)
  })

  it('lets same-origin, same-site and header-less writes through', () => {
    expect(isCrossSiteWrite('POST', { secFetchSite: 'same-origin', origin: own }, own)).toBe(false)
    expect(isCrossSiteWrite('POST', { secFetchSite: 'same-site' }, own)).toBe(false)
    expect(isCrossSiteWrite('POST', { secFetchSite: 'none', origin: own }, own)).toBe(false)
    expect(isCrossSiteWrite('POST', { origin: 'HTTPS://TCG-POCKET.FLY.DEV' }, own)).toBe(false)
    expect(isCrossSiteWrite('DELETE', {}, own)).toBe(false)
    expect(isCrossSiteWrite('POST', { origin: 'http://localhost:3000' }, 'http://localhost:3000')).toBe(false)
  })

  it('blocks writes that the browser marks as cross-site or that carry a foreign or null Origin', () => {
    expect(isCrossSiteWrite('POST', { secFetchSite: 'cross-site' }, own)).toBe(true)
    expect(isCrossSiteWrite('POST', { secFetchSite: 'cross-site', origin: own }, own)).toBe(true)
    expect(isCrossSiteWrite('PATCH', { origin: 'https://evil.example' }, own)).toBe(true)
    expect(isCrossSiteWrite('POST', { origin: 'null' }, own)).toBe(true)
    expect(isCrossSiteWrite('POST', { origin: 'https://tcg-pocket.fly.dev:8443' }, own)).toBe(true)
    expect(isCrossSiteWrite('POST', { origin: 'http://localhost:3001' }, 'http://localhost:3000')).toBe(true)
  })
})
