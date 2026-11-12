import type pg from 'pg'
import { loadEnv } from '../src/config/env.js'
import { PrismaService } from '../src/prisma/prisma.service.js'

/**
 * infra-egress: the pool keeps one connection open. With pg's 10 s idle timeout it closed the last one between the
 * notifications check (every 15 s) and the crons and opened a new one ~5.000 times a day in production, each with its
 * TLS handshake (~4,3 KB of the database's egress).
 */
describe('database pool (e2e)', () => {
  it('keeps one connection when idle and still closes the others after 10 s', async () => {
    const prisma = new PrismaService(loadEnv())
    await prisma.$connect()
    const opened: pg.PoolClient[] = []
    const onConnect = (client: pg.PoolClient) => opened.push(client)
    try {
      // Two at once: two connections.
      await Promise.all([
        prisma.$queryRaw`SELECT 1 AS ok FROM pg_sleep(0.3)`,
        prisma.$queryRaw`SELECT 1 AS ok FROM pg_sleep(0.3)`,
      ])
      expect(prisma.pool.totalCount).toBe(2)
      // Past pg's idle timeout: one goes, one stays.
      await new Promise((resolve) => setTimeout(resolve, 11_000))
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
