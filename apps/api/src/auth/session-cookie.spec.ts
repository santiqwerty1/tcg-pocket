import {
  clearSessionCookie,
  hashSessionId,
  newSessionId,
  readSessionId,
  SESSION_TTL_MS,
  serializeSessionCookie,
  sessionCookieName,
  sessionExpiresAt,
  shouldRefreshSession,
} from './session-cookie.js'

describe('session cookie helpers', () => {
  it('names the cookie __Host-session only when secure', () => {
    expect(sessionCookieName(true)).toBe('__Host-session')
    expect(sessionCookieName(false)).toBe('tcg_session')
  })

  it('generates 32 random bytes as base64url and hashes them with sha256', () => {
    const id = newSessionId()
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(newSessionId()).not.toBe(id)
    expect(hashSessionId(id)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashSessionId(id)).toBe(hashSessionId(id))
    expect(hashSessionId(id)).not.toBe(hashSessionId(newSessionId()))
  })

  it('reads the id back from the Cookie header and rejects malformed values', () => {
    const id = newSessionId()
    expect(readSessionId(`other=1; tcg_session=${id}; x=y`, 'tcg_session')).toBe(id)
    expect(readSessionId(`__Host-session=${id}`, '__Host-session')).toBe(id)
    expect(readSessionId(`tcg_session=${id}`, '__Host-session')).toBeNull()
    expect(readSessionId('tcg_session=short', 'tcg_session')).toBeNull()
    expect(readSessionId('tcg_session=../../etc/passwd/aaaaaaaaaaaaaaaaaaaaaaaaaaa', 'tcg_session')).toBeNull()
    expect(readSessionId(undefined, 'tcg_session')).toBeNull()
  })

  it('serializes HttpOnly, SameSite=Lax, Path=/ and Secure when asked', () => {
    const id = newSessionId()
    const secure = serializeSessionCookie('__Host-session', id, { secure: true })
    expect(secure).toContain(`__Host-session=${id}`)
    expect(secure).toContain('HttpOnly')
    expect(secure).toContain('SameSite=Lax')
    expect(secure).toContain('Path=/')
    expect(secure).toContain('Secure')
    expect(secure).toContain(`Max-Age=${SESSION_TTL_MS / 1000}`)
    expect(secure).not.toContain('Domain=')
    const plain = serializeSessionCookie('tcg_session', id, { secure: false })
    expect(plain).not.toContain('Secure')
  })

  it('clears the cookie with Max-Age=0', () => {
    const cleared = clearSessionCookie('tcg_session', false)
    expect(cleared).toContain('tcg_session=;')
    expect(cleared).toContain('Max-Age=0')
    expect(cleared).toContain('HttpOnly')
  })

  it('slides the expiry only after a day of activity gap', () => {
    const now = new Date('2026-10-06T12:00:00Z')
    expect(sessionExpiresAt(now).getTime() - now.getTime()).toBe(SESSION_TTL_MS)
    expect(shouldRefreshSession(new Date('2026-10-06T00:00:00Z'), now)).toBe(false)
    expect(shouldRefreshSession(new Date('2026-10-05T11:59:00Z'), now)).toBe(true)
  })
})
