import { createTestApp, type TestApp } from './helpers.js'

describe('exposure (e2e)', () => {
  let test: TestApp

  beforeAll(async () => {
    test = await createTestApp()
  })

  afterAll(async () => {
    await test.close()
  })

  it('redirects unauthenticated browser navigations to /login', async () => {
    const response = await test.http().get('/').set('Accept', 'text/html,application/xhtml+xml')
    expect(response.status).toBe(302)
    expect(response.headers.location).toBe('/login')
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('redirects unauthenticated chunk and shell requests too (nothing is served without the cookie)', async () => {
    for (const path of ['/assets/index-abc123.js', '/index.html', '/manifest.webmanifest', '/sw.js']) {
      const response = await test.http().get(path).set('Accept', '*/*')
      expect(response.status, path).toBe(302)
      expect(response.headers.location, path).toBe('/login')
    }
  })

  it('answers 401 JSON in the error envelope to unauthenticated API calls', async () => {
    const response = await test.http().get('/api/auth/me')
    expect(response.status).toBe(401)
    expect(response.body).toEqual({ error: { code: 'unauthenticated', message: 'Necesitás iniciar sesión.' } })
    const post = await test.http().post('/api/tokens').send({})
    expect(post.status).toBe(401)
    expect(post.body.error.code).toBe('unauthenticated')
  })

  it('serves /healthz publicly', async () => {
    const response = await test.http().get('/healthz')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true, version: test.env.version, catalogCommit: null, engineRev: null })
  })

  it('serves a self-contained Spanish login page with a nonce-protected inline script', async () => {
    const response = await test.http().get('/login').set('Accept', 'text/html')
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toMatch(/text\/html/)
    expect(response.headers['cache-control']).toBe('no-store')
    const html = response.text
    expect(html).toContain('<html lang="es">')
    expect(html).toContain('id="email"')
    expect(html).toContain('id="password"')
    expect(html).toContain('id="totp"')
    expect(html).toContain("fetch('/api/auth/login'")
    expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)=["']https?:/)
    const nonce = /<script nonce="([^"]+)">/.exec(html)?.[1]
    expect(nonce).toBeTruthy()
    expect(response.headers['content-security-policy']).toContain(`'nonce-${nonce}'`)
  })

  it('returns 404 under /.well-known without a session', async () => {
    const response = await test.http().get('/.well-known/oauth-protected-resource')
    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('not_found')
  })

  it('protects the integrations with bearer tokens, not the session', async () => {
    const mcp = await test.http().post('/api/mcp').send({})
    expect(mcp.status).toBe(401)
    expect(mcp.headers['www-authenticate']).toBe('Bearer')
    expect(mcp.body.error.code).toBe('unauthenticated')
    const worker = await test.http().get('/api/worker/ping')
    expect(worker.status).toBe(401)
    const bad = await test.http().get('/api/worker/ping').set('Authorization', 'Bearer tcg_wk_nope')
    expect(bad.status).toBe(401)
  })

  it('sets security headers on every response', async () => {
    const response = await test.http().get('/healthz')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['x-frame-options']).toBe('DENY')
    expect(response.headers['referrer-policy']).toBe('same-origin')
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(response.headers['content-security-policy']).toContain("default-src 'self'")
    expect(response.headers['x-powered-by']).toBeUndefined()
  })

  it('refuses cross-site writes on the cookie routes (login included) but not reads or the bearer integrations', async () => {
    const crossSite = await test
      .http()
      .post('/api/auth/login')
      .set('X-Forwarded-For', '10.9.9.8')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ email: 'a@b.c', password: 'x' })
    expect(crossSite.status).toBe(403)
    expect(crossSite.body).toEqual({
      error: { code: 'forbidden', message: 'Solicitud rechazada: viene de otro sitio.' },
    })
    expect(crossSite.headers['cache-control']).toBe('no-store')
    const foreignOrigin = await test.http().post('/api/tokens').set('Origin', 'https://evil.example').send({})
    expect(foreignOrigin.status).toBe(403)
    expect((await test.http().patch('/api/decks/1').set('Origin', 'null').send({})).status).toBe(403)
    // Same origin (what the login page's fetch sends) passes the check and reaches validation.
    const sameOrigin = await test
      .http()
      .post('/api/auth/login')
      .set('X-Forwarded-For', '10.9.9.8')
      .set('Host', '127.0.0.1')
      .set('Origin', 'http://127.0.0.1')
      .set('Sec-Fetch-Site', 'same-origin')
      .send({ email: '' })
    expect(sameOrigin.status).toBe(400)
    expect(sameOrigin.body.error.code).toBe('validation')
    expect((await test.http().get('/healthz').set('Sec-Fetch-Site', 'cross-site')).status).toBe(200)
    const bearer = await test.http().post('/api/mcp').set('Sec-Fetch-Site', 'cross-site').send({})
    expect(bearer.status).toBe(401)
    expect(bearer.headers['www-authenticate']).toBe('Bearer')
  })

  it('rejects malformed login bodies with 400 validation and Spanish messages', async () => {
    const response = await test.http().post('/api/auth/login').set('X-Forwarded-For', '10.9.9.9').send({ email: '' })
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation')
    expect(response.body.error.message).toBe('Datos inválidos.')
    expect(response.body.error.details.some((d: { path: string }) => d.path === 'password')).toBe(true)
  })
})
