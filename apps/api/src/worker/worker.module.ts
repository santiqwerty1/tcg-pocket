import { Controller, Get, Module, UseGuards } from '@nestjs/common'
import { CurrentApiToken, type RequestApiToken } from '../auth/request-auth.js'
import { BearerTokenGuard, RequireScopes } from '../tokens/bearer-token.guard.js'
import { TokensModule } from '../tokens/tokens.module.js'

/** Stub of the worker queue (PLAN §3.7, Phase 6). Bearer `tcg_wk_*` tokens with `worker:claim`. */
@Controller('api/worker')
@UseGuards(BearerTokenGuard)
@RequireScopes('worker:claim')
export class WorkerController {
  @Get('ping')
  ping(@CurrentApiToken() token: RequestApiToken): { ok: true; token: { name: string; kind: string } } {
    return { ok: true, token: { name: token.name, kind: token.kind } }
  }
}

@Module({
  imports: [TokensModule],
  controllers: [WorkerController],
})
export class WorkerModule {}
