import type pg from 'pg'
import type { Env } from '../config/env.js'

/**
 * The options of the `pg` pool, for the API and for a command line run (`env.cli`).
 *
 * - H-015: waiting for a free connection gives up after 15 s instead of hanging the request forever.
 * - infra-egress (#180): one connection stays open for good (`min`).
 * - infra-egress (13/11/2026): the API's other connections close after a minute idle instead of pg's 10 s. In
 *   production, with nothing running, each burst (a worker asking for work, the notifications check) used 2–3
 *   connections at once every ~15–20 s. With 10 s idle they closed in between and reopened: ~5.500 new connections a
 *   day to the pooler, ~4,3 KB of TLS handshake and start-up each, ~23 MB a day of the database's egress.
 * - A CLI runs next to the live API and both share the pooler's 15 connections (session mode). After a burst the API
 *   now holds up to its 8 for a minute, so a CLI takes at most 6 and keeps pg's 10 s idle: it does not need the
 *   savings, and the API with one CLI (8 + 6) stay under the limit. Two CLIs at once, or one during a deploy (with
 *   the migrations' connections), can still go over.
 */
export function poolOptions(env: Pick<Env, 'databaseUrl' | 'cli'>): pg.PoolConfig {
  const common = { connectionString: env.databaseUrl, min: 1, connectionTimeoutMillis: 15_000 }
  return env.cli ? { ...common, max: 6, idleTimeoutMillis: 10_000 } : { ...common, max: 8, idleTimeoutMillis: 60_000 }
}
