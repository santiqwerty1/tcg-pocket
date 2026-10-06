import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common'
import { CatalogService } from '../catalog/catalog.service.js'
import { ENV, type Env } from '../config/env.js'
import { PrismaService } from '../prisma/prisma.service.js'

export interface HealthResponse {
  ok: true
  version: string
  /** Commits of the catalog loaded in memory (null until the first sync). */
  catalogCommit: string | null
  engineRev: string | null
}

/** Shorter than Fly's check timeout (5 s), so a hung database answers 503 instead of a timed-out check. */
export const DB_PING_TIMEOUT_MS = 3000

@Controller()
export class HealthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly catalog: CatalogService,
    private readonly prisma: PrismaService,
  ) {}

  /** Public (Fly health check). 503 `unavailable` when the database does not answer a `SELECT 1` in time. */
  @Get('healthz')
  async health(): Promise<HealthResponse> {
    await this.pingDatabase()
    return {
      ok: true,
      version: this.env.version,
      catalogCommit: this.catalog.trackerCommit,
      engineRev: this.catalog.engineRev,
    }
  }

  private async pingDatabase(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('database ping timed out')), DB_PING_TIMEOUT_MS)
    })
    try {
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout])
    } catch {
      throw new ServiceUnavailableException({ code: 'unavailable', message: 'La base de datos no responde.' })
    } finally {
      clearTimeout(timer)
    }
  }
}
