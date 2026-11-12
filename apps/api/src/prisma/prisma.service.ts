import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { ENV, type Env } from '../config/env.js'
import { PrismaClient } from '../generated/prisma/client.js'

/**
 * Prisma 7 client over a `pg` pool (driver adapter). The pool is also exposed for the few bulk operations that are
 * simpler in plain SQL (catalog sync); `$disconnect` ends it.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  readonly pool: pg.Pool

  constructor(@Inject(ENV) env: Env) {
    // H-015: waiting for a free connection gives up after 15 s instead of hanging the request forever.
    // infra-egress: one connection stays open (`min`). With pg's 10 s idle timeout the pool closed its last connection
    // between the notifications check (every 15 s) and the crons, and opened a new one ~5.000 times a day: ~4,3 KB of
    // TLS handshake and start-up each, ~20 MB a day of the database's egress. The others still close after 10 s idle,
    // so a burst does not hold the pooler's connections (15 in session mode) any longer than before.
    const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 8, min: 1, connectionTimeoutMillis: 15_000 })
    super({ adapter: new PrismaPg(pool, { disposeExternalPool: true }), log: ['warn', 'error'] })
    this.pool = pool
  }

  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
