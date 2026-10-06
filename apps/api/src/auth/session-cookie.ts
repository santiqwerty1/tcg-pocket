/**
 * Session cookie helpers (docs/PLAN.md §2 Autenticación). The cookie carries a random 256-bit id; the database only
 * stores its SHA-256. `__Host-` prefix when the cookie is Secure (requires Path=/ and no Domain), `tcg_session` for
 * plain-HTTP development.
 */
import { createHash, randomBytes } from 'node:crypto'
import { parseCookie, stringifySetCookie } from 'cookie'

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Sliding expiry: refresh when more than this elapsed since `last_seen_at`. */
export const SESSION_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-session' : 'tcg_session'
}

export function newSessionId(): string {
  return randomBytes(32).toString('base64url')
}

export function hashSessionId(id: string): string {
  return createHash('sha256').update(id, 'utf8').digest('hex')
}

/** The session id carried by the request, or null when absent or malformed. */
export function readSessionId(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null
  const value = parseCookie(cookieHeader)[name]
  return value && SESSION_ID_PATTERN.test(value) ? value : null
}

export function serializeSessionCookie(
  name: string,
  id: string,
  options: { secure: boolean; maxAgeSeconds?: number },
): string {
  return stringifySetCookie(name, id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: options.secure,
    maxAge: options.maxAgeSeconds ?? Math.floor(SESSION_TTL_MS / 1000),
  })
}

export function clearSessionCookie(name: string, secure: boolean): string {
  return stringifySetCookie(name, '', { httpOnly: true, sameSite: 'lax', path: '/', secure, maxAge: 0 })
}

export function sessionExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_MS)
}

export function shouldRefreshSession(lastSeenAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - lastSeenAt.getTime() > SESSION_REFRESH_AFTER_MS
}
