import { Controller, Get, Inject } from '@nestjs/common'
import { CatalogService } from '../catalog/catalog.service.js'
import { ENV, type Env } from '../config/env.js'

export interface HealthResponse {
  ok: true
  version: string
  /** Commits of the catalog loaded in memory (null until the first sync). */
  catalogCommit: string | null
  engineRev: string | null
}

@Controller()
export class HealthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly catalog: CatalogService,
  ) {}

  /** Public (Fly health check). */
  @Get('healthz')
  health(): HealthResponse {
    return {
      ok: true,
      version: this.env.version,
      catalogCommit: this.catalog.trackerCommit,
      engineRev: this.catalog.engineRev,
    }
  }
}
