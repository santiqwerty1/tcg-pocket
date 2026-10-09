/** Operación (Fase 38, docs/API.md «Operación»): the server's own state, for the owner and for Claude. */
import { Controller, Get } from '@nestjs/common'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { OpsService, type OpsStatusView } from './ops.service.js'

@Controller('api/ops')
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @Get('status')
  async status(@CurrentSession() _session: RequestSession): Promise<OpsStatusView> {
    return this.ops.status()
  }
}
