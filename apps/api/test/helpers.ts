import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { AlertsService } from '../src/alerts/alerts.service.js'
import { createApp } from '../src/app.js'
import { OwnerService } from '../src/auth/owner.service.js'
import { hashPassword } from '../src/auth/password.js'
import { currentTotp, generateTotpSecret } from '../src/auth/totp.js'
import { type Env, loadEnv } from '../src/config/env.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { truncateAllTables } from './global-setup.js'

export const OWNER = { email: 'santi@example.com', password: 'correct-horse-battery-staple' }

export interface TestApp {
  app: NestExpressApplication
  env: Env
  prisma: PrismaService
  /** Fresh supertest client bound to the app's HTTP server. */
  http: () => ReturnType<typeof request>
  close: () => Promise<void>
}

/**
 * The day of the tournament fixtures (`docs/fase0/limitless/`, era B4a). The tests see the era table as it was then:
 * a set the server seeds that comes out later (C1 on 29/10/2026) would make «today» another era, with no tournaments.
 */
export const FIXTURES_DAY = '2026-10-06'

export async function createTestApp(): Promise<TestApp> {
  const env = loadEnv()
  await truncateAllTables(env.databaseUrl)
  const app = await createApp(env)
  await app.init()
  await app
    .get(PrismaService)
    .setRelease.deleteMany({ where: { releaseDate: { gt: new Date(`${FIXTURES_DAY}T00:00:00Z`) } } })
  // The tests start the app and look at the alerts right away: no grace after a «deploy».
  app.get(AlertsService).deployGraceMs = 0
  return {
    app,
    env,
    prisma: app.get(PrismaService),
    http: () => request(app.getHttpServer()),
    close: () => app.close(),
  }
}

/** Creates the owner; returns the TOTP secret when enrolled. */
export async function seedOwner(
  app: NestExpressApplication,
  options: { totp: boolean },
): Promise<{ secret: string | null }> {
  const secret = options.totp ? generateTotpSecret() : null
  await app
    .get(OwnerService)
    .upsert({ email: OWNER.email, passwordHash: await hashPassword(OWNER.password), totpSecret: secret })
  return { secret }
}

export function setCookies(response: { headers: Record<string, string | string[] | undefined> }): string[] {
  const header = response.headers['set-cookie']
  if (!header) return []
  return Array.isArray(header) ? header : [header]
}

/** `Cookie` header value from `Set-Cookie` lines (name=value pairs only). */
export function cookieHeader(setCookie: string[]): string {
  return setCookie.map((line) => line.split(';')[0] as string).join('; ')
}

/** Logs in through the API (204 + cookie) and returns the Cookie header to reuse. */
export async function login(
  test: TestApp,
  options: { secret: string | null; ip?: string } = { secret: null },
): Promise<string> {
  const body: Record<string, string> = { email: OWNER.email, password: OWNER.password }
  if (options.secret) {
    // A TOTP code is accepted once (replay guard); the suite logs in several times within one 30-second step.
    await test.prisma.owner.updateMany({ data: { totpLastStep: null } })
    body.totp = await currentTotp(options.secret)
  }
  const response = await test
    .http()
    .post('/api/auth/login')
    .set('X-Forwarded-For', options.ip ?? '10.0.0.1')
    .send(body)
  if (response.status !== 204) throw new Error(`login failed: ${response.status} ${JSON.stringify(response.body)}`)
  return cookieHeader(setCookies(response))
}

/** Polls `GET /api/catalog/status` until the given sync is no longer running. */
export async function waitForSync(test: TestApp, cookie: string, syncId: number, timeoutMs = 60_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const status = await test.http().get('/api/catalog/status').set('Cookie', cookie)
    const last = status.body.lastSync as { id: number; status: string } | null
    // Done means the row says so and the in-memory catalog finished reloading (a new sync would get a 409 before).
    if (last && last.id === syncId && last.status !== 'running' && !status.body.syncRunning) return status.body
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`sync ${syncId} still running after ${timeoutMs} ms`)
}
