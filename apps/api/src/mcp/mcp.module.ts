import { All, Controller, Module, NotImplementedException, UseGuards } from '@nestjs/common'
import { BearerTokenGuard, RequireScopes } from '../tokens/bearer-token.guard.js'
import { TokensModule } from '../tokens/tokens.module.js'

/** Stub of the MCP endpoint (PLAN §3.8, Phase 3). Bearer `tcg_mcp_*` tokens with `mcp:read`. */
@Controller('api/mcp')
@UseGuards(BearerTokenGuard)
@RequireScopes('mcp:read')
export class McpController {
  @All()
  notImplemented(): never {
    throw new NotImplementedException('El endpoint MCP llega en la Fase 3.')
  }
}

@Module({
  imports: [TokensModule],
  controllers: [McpController],
})
export class McpModule {}
