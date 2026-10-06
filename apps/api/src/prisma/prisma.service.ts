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
    const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 8 })
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
