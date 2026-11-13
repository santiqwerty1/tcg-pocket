import type pg from 'pg'

/**
 * The options of the API's `pg` pool.
 *
 * - H-015: waiting for a free connection gives up after 15 s instead of hanging the request forever.
 * - infra-egress (#180): one connection stays open for good (`min`).
 * - infra-egress (13/11/2026): the others close after a minute idle instead of pg's 10 s. In production, with nothing
 *   running, each burst (a worker asking for work, the notifications check) used 2–3 connections at once every
 *   ~15–20 s. With 10 s idle they closed in between and reopened: ~5.500 new connections a day to the pooler, ~4,3 KB
 *   of TLS handshake and start-up each, ~23 MB a day of the database's egress. The cost: after a burst, up to `max`
 *   of the pooler's connections (15 in session mode) stay held for a minute instead of 10 s.
 */
export function poolOptions(databaseUrl: string): pg.PoolConfig {
  return { connectionString: databaseUrl, max: 8, min: 1, idleTimeoutMillis: 60_000, connectionTimeoutMillis: 15_000 }
}
