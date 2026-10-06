import { currentTotp } from '../src/auth/totp.js'
import { cookieHeader, createTestApp, login, OWNER, seedOwner, setCookies, type TestApp } from './helpers.js'

describe('auth (e2e)', () => {
  let test: TestApp
  let secret: string

  beforeAll(async () => {
    test = await createTestApp()
    secret = (await seedOwner(test.app, { totp: true })).secret as string
  })

  afterAll(async () => {
    await test.close()
  })

  const attempt = (body: Record<string, string>, ip: string) =>
    test.http().post('/api/auth/login').set('X-Forwarded-For', ip).send(body)

  it('rejects a wrong password with a generic 401', async () => {
    const response = await attempt(
      { email: OWNER.email, password: 'wrong', totp: await currentTotp(secret) },
      '10.1.0.1',
    )
    expect(response.status).toBe(401)
    expect(response.body).toEqual({ error: { code: 'invalid_credentials', message: 'Credenciales inválidas.' } })
    expect(setCookies(response)).toEqual([])
  })

  it('rejects an unknown email with the same 401', async () => {
    const response = await attempt({ email: 'other@example.com', password: OWNER.password }, '10.1.0.1')
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('invalid_credentials')
  })

  it('asks for the TOTP code when the owner is enrolled and rejects wrong codes', async () => {
    const missing = await attempt({ email: OWNER.email, password: OWNER.password }, '10.1.0.2')
    expect(missing.status).toBe(401)
    expect(missing.body.error.code).toBe('totp_required')
    const wrong = await attempt({ email: OWNER.email, password: OWNER.password, totp: '000000' }, '10.1.0.2')
    expect(wrong.status).toBe(401)
    expect(wrong.body.error.code).toBe('invalid_credentials')
  })

  it('logs in with password + TOTP (204), sets the session cookie and serves /api/auth/me', async () => {
    const response = await attempt(
      { email: OWNER.email, password: OWNER.password, totp: await currentTotp(secret) },
      '10.1.0.3',
    )
    expect(response.status).toBe(204)
    expect(response.text).toBe('')
    const cookies = setCookies(response)
    expect(cookies).toHaveLength(1)
    const cookie = cookies[0] as string
    expect(cookie).toMatch(/^tcg_session=[A-Za-z0-9_-]{43};/)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=2592000')
    expect(cookie).not.toContain('Secure')

    const me = await test.http().get('/api/auth/me').set('Cookie', cookieHeader(cookies))
    expect(me.status).toBe(200)
    expect(me.body).toEqual({ email: OWNER.email, totpEnabled: true })

    const loginPage = await test.http().get('/login').set('Cookie', cookieHeader(cookies)).set('Accept', 'text/html')
    expect(loginPage.status).toBe(302)
    expect(loginPage.headers.location).toBe('/')

    const home = await test.http().get('/').set('Cookie', cookieHeader(cookies)).set('Accept', 'text/html')
    expect([200, 503]).toContain(home.status)
    expect(home.headers['content-type']).toMatch(/text\/html/)
  })

  it('slides the expiry (and re-sends the cookie) after a day without activity', async () => {
    const cookie = await login(test, { secret, ip: '10.1.0.4' })
    const before = await test.prisma.session.findFirstOrThrow({ orderBy: { createdAt: 'desc' } })
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    await test.prisma.session.update({
      where: { idHash: before.idHash },
      data: { lastSeenAt: twoDaysAgo, expiresAt: new Date(twoDaysAgo.getTime() + 30 * 24 * 60 * 60 * 1000) },
    })
    const me = await test.http().get('/api/auth/me').set('Cookie', cookie)
    expect(me.status).toBe(200)
    expect(setCookies(me)[0]).toMatch(/^tcg_session=.*Max-Age=2592000/)
    const after = await test.prisma.session.findUniqueOrThrow({ where: { idHash: before.idHash } })
    expect(after.lastSeenAt.getTime()).toBeGreaterThan(twoDaysAgo.getTime())
    expect(after.expiresAt.getTime()).toBeGreaterThan(before.expiresAt.getTime() - 1000)
  })

  it('logs out: the cookie is cleared and the session no longer works', async () => {
    const cookie = await login(test, { secret, ip: '10.1.0.5' })
    const logout = await test.http().post('/api/auth/logout').set('Cookie', cookie)
    expect(logout.status).toBe(204)
    expect(setCookies(logout)[0]).toMatch(/^tcg_session=;.*Max-Age=0/)
    const me = await test.http().get('/api/auth/me').set('Cookie', cookie)
    expect(me.status).toBe(401)
    // The stale cookie is cleared on the way out.
    expect(setCookies(me)[0]).toMatch(/Max-Age=0/)
  })

  it('throttles the 6th login attempt within 15 minutes per IP', async () => {
    const ip = '10.1.0.6'
    for (let i = 0; i < 5; i += 1) {
      const response = await attempt({ email: OWNER.email, password: 'wrong' }, ip)
      expect(response.status, `attempt ${i + 1}`).toBe(401)
    }
    const sixth = await attempt({ email: OWNER.email, password: OWNER.password, totp: await currentTotp(secret) }, ip)
    expect(sixth.status).toBe(429)
    expect(sixth.body.error.code).toBe('rate_limited')
    expect(sixth.body.error.message).toContain('Demasiados intentos')
    // Other IPs are unaffected.
    const other = await attempt(
      { email: OWNER.email, password: OWNER.password, totp: await currentTotp(secret) },
      '10.1.0.7',
    )
    expect(other.status).toBe(204)
  })

  it('changes the password with the current one and closes the other sessions', async () => {
    const first = await login(test, { secret, ip: '10.1.0.8' })
    const second = await login(test, { secret, ip: '10.1.0.9' })
    const wrong = await test
      .http()
      .post('/api/auth/password')
      .set('Cookie', first)
      .send({ currentPassword: 'nope', newPassword: 'another-long-password-123' })
    expect(wrong.status).toBe(401)
    expect(wrong.body.error.code).toBe('invalid_credentials')
    const short = await test
      .http()
      .post('/api/auth/password')
      .set('Cookie', first)
      .send({ currentPassword: OWNER.password, newPassword: 'short' })
    expect(short.status).toBe(400)
    expect(short.body.error.code).toBe('validation')
    const ok = await test
      .http()
      .post('/api/auth/password')
      .set('Cookie', first)
      .send({ currentPassword: OWNER.password, newPassword: 'another-long-password-123' })
    expect(ok.status).toBe(204)
    expect((await test.http().get('/api/auth/me').set('Cookie', first)).status).toBe(200)
    expect((await test.http().get('/api/auth/me').set('Cookie', second)).status).toBe(401)
    const oldPassword = await attempt(
      { email: OWNER.email, password: OWNER.password, totp: await currentTotp(secret) },
      '10.1.0.10',
    )
    expect(oldPassword.status).toBe(401)
    const newPassword = await attempt(
      { email: OWNER.email, password: 'another-long-password-123', totp: await currentTotp(secret) },
      '10.1.0.10',
    )
    expect(newPassword.status).toBe(204)
  })
})
