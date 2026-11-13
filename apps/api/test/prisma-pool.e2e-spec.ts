import type pg from 'pg'
import { loadEnv } from '../src/config/env.js'
import { PrismaService } from '../src/prisma/prisma.service.js'

/**
 * infra-egress: the pool keeps one connection open and reuses it. Each new connection to the pooler costs ~4,3 KB of
 * TLS handshake and start-up of the database's egress. The idle timeouts themselves (a minute for the API, 10 s for a
 * CLI) are checked on the real pg-pool in `src/prisma/pool-options.spec.ts`; here, against Postgres, with a short one.
 */
describe('database pool (e2e)', () => {
  it('starts with a minute of idle and keeps one connection when the others close', async () => {
    const prisma = new PrismaService(loadEnv())
    expect(prisma.pool.options.idleTimeoutMillis).toBe(60_000)
    await prisma.$connect()
    const opened: pg.PoolClient[] = []
    const onConnect = (client: pg.PoolClient) => opened.push(client)
    try {
      // A short idle for the test: pg-pool reads it when a connection goes back to the pool.
      prisma.pool.options.idleTimeoutMillis = 500
      // Two at once: two connections.
      await Promise.all([
        prisma.$queryRaw`SELECT 1 AS ok FROM pg_sleep(0.3)`,
        prisma.$queryRaw`SELECT 1 AS ok FROM pg_sleep(0.3)`,
      ])
      expect(prisma.pool.totalCount).toBe(2)
      // Past the idle timeout: one goes, one stays.
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      expect(prisma.pool.totalCount).toBe(1)
      expect(prisma.pool.idleCount).toBe(1)
      // The next query uses it: no new connection.
      prisma.pool.on('connect', onConnect)
      await prisma.$queryRaw`SELECT 1 AS ok`
      expect(opened).toHaveLength(0)
    } finally {
      prisma.pool.off('connect', onConnect)
      await prisma.$disconnect()
    }
  }, 30_000)
})
