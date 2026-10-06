import { Inject, Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { ENV, type Env } from '../config/env.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { RequestSession } from './request-auth.js'
import {
  clearSessionCookie,
  hashSessionId,
  newSessionId,
  serializeSessionCookie,
  sessionCookieName,
  sessionExpiresAt,
  shouldRefreshSession,
} from './session-cookie.js'

export interface ResolvedSession {
  session: RequestSession
  /** Set when the sliding expiry was extended: the cookie must be re-sent with a fresh Max-Age. */
  refreshedCookie: string | null
}

/** Memoizes session lookups briefly so a page load with 30 chunks does not hit the database 30 times. */
const CACHE_TTL_MS = 30_000

@Injectable()
export class SessionService {
  readonly cookieName: string
  private readonly secure: boolean
  private readonly cache = new Map<string, { session: RequestSession; cachedAt: number }>()

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) env: Env,
  ) {
    this.secure = env.cookieSecure
    this.cookieName = sessionCookieName(env.cookieSecure)
  }

  async create(input: { userAgent?: string | undefined }): Promise<{ cookie: string; idHash: string }> {
    const id = newSessionId()
    const idHash = hashSessionId(id)
    const now = new Date()
    await this.prisma.session.create({
      data: {
        idHash,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: sessionExpiresAt(now),
        userAgent: input.userAgent?.slice(0, 500) ?? null,
      },
    })
    return { cookie: serializeSessionCookie(this.cookieName, id, { secure: this.secure }), idHash }
  }

  /** Looks a cookie id up; expired sessions are deleted on sight. Applies the sliding refresh. */
  async resolve(id: string): Promise<ResolvedSession | null> {
    const idHash = hashSessionId(id)
    const now = new Date()
    const cached = this.cache.get(idHash)
    let session: RequestSession | null = null
    if (cached && now.getTime() - cached.cachedAt < CACHE_TTL_MS) session = cached.session
    else {
      const row = await this.prisma.session.findUnique({ where: { idHash } })
      session = row ? { idHash, createdAt: row.createdAt, expiresAt: row.expiresAt, lastSeenAt: row.lastSeenAt } : null
      if (session) this.cache.set(idHash, { session, cachedAt: now.getTime() })
    }
    if (!session) return null
    if (session.expiresAt.getTime() <= now.getTime()) {
      await this.destroy(idHash)
      return null
    }
    if (!shouldRefreshSession(session.lastSeenAt, now)) return { session, refreshedCookie: null }
    const refreshed: RequestSession = { ...session, lastSeenAt: now, expiresAt: sessionExpiresAt(now) }
    await this.prisma.session.update({
      where: { idHash },
      data: { lastSeenAt: refreshed.lastSeenAt, expiresAt: refreshed.expiresAt },
    })
    this.cache.set(idHash, { session: refreshed, cachedAt: now.getTime() })
    return {
      session: refreshed,
      refreshedCookie: serializeSessionCookie(this.cookieName, id, { secure: this.secure }),
    }
  }

  async destroy(idHash: string): Promise<void> {
    this.cache.delete(idHash)
    await this.prisma.session.deleteMany({ where: { idHash } })
  }

  /** Logs every other device out (password change). */
  async destroyAllExcept(idHash: string | null): Promise<number> {
    this.cache.clear()
    const result = await this.prisma.session.deleteMany(idHash ? { where: { idHash: { not: idHash } } } : undefined)
    return result.count
  }

  clearCookie(): string {
    return clearSessionCookie(this.cookieName, this.secure)
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpired(): Promise<number> {
    const result = await this.prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } })
    return result.count
  }
}
