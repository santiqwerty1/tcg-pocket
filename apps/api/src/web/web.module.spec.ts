import { cacheControlFor, isSpaNavigation } from './web.module.js'

describe('static cache policy', () => {
  it('marks hashed assets immutable and the PWA shell no-store', () => {
    expect(cacheControlFor('/assets/index-Cx1.js')).toBe('public, max-age=31536000, immutable')
    expect(cacheControlFor('\\assets\\index-Cx1.css')).toBe('public, max-age=31536000, immutable')
    expect(cacheControlFor('/index.html')).toBe('no-store')
    expect(cacheControlFor('/sw.js')).toBe('no-store')
    expect(cacheControlFor('/manifest.webmanifest')).toBe('no-store')
    expect(cacheControlFor('/workbox-abc.js')).toBe('no-store')
    expect(cacheControlFor('/favicon.svg')).toBe('no-cache')
  })
})

describe('isSpaNavigation', () => {
  it('matches html GETs outside /api only', () => {
    expect(isSpaNavigation('GET', '/', 'text/html')).toBe(true)
    expect(isSpaNavigation('GET', '/decks/3', 'text/html,*/*')).toBe(true)
    expect(isSpaNavigation('HEAD', '/x', 'text/html')).toBe(true)
    expect(isSpaNavigation('GET', '/api/cards', 'text/html')).toBe(false)
    expect(isSpaNavigation('GET', '/assets/x.js', '*/*')).toBe(false)
    expect(isSpaNavigation('POST', '/', 'text/html')).toBe(false)
    expect(isSpaNavigation('GET', '/', undefined)).toBe(false)
  })
})
