/** Operación (Fase 38, docs/API.md «Operación»): the server's own state, for the owner and for Claude. */
import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { OpsService, type OpsStatusView } from './ops.service.js'
import { type RetentionResult, RetentionService } from './retention.service.js'

@Controller('api/ops')
export class OpsController {
  constructor(
    private readonly ops: OpsService,
    private readonly retention: RetentionService,
  ) {}

  @Get('status')
  async status(@CurrentSession() _session: RequestSession): Promise<OpsStatusView> {
    return this.ops.status()
  }

  /**
   * Fase 39: the daily cleanup (old replays, raw standings). By default a dry run (what it would delete, nothing
   * deleted); `?apply=1` deletes.
   */
  @Post('retention')
  @HttpCode(200)
  async runRetention(
    @Query('apply') apply: string | undefined,
    @CurrentSession() _session: RequestSession,
  ): Promise<RetentionResult> {
    return this.retention.run({ dryRun: apply !== '1' && apply !== 'true' })
  }
}
