/**
 * Remote MCP endpoint (PLAN §3.8, Fase 3): `POST /api/mcp`, Streamable HTTP, stateless, serving both protocol eras
 * (2026-07-28 and the 2025 `initialize` handshake the Claude apps still use) through the v2 SDK. Auth is the fixed
 * bearer `tcg_mcp_*` with scope `mcp:read` (DECISIONES A.6), checked by BearerTokenGuard before the SDK sees the
 * request; the SDK gets the result as pass-through `authInfo`.
 */

import { type NodeMcpRequestHandler, toNodeHandler } from '@modelcontextprotocol/node'
import { type AuthInfo, createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server'
import { All, Controller, Module, type OnModuleDestroy, Req, Res, UseGuards } from '@nestjs/common'
import type { Request, Response } from 'express'
import { PinoLogger } from 'nestjs-pino'
import { CurrentApiToken, type RequestApiToken } from '../auth/request-auth.js'
import { CatalogModule } from '../catalog/catalog.module.js'
import { CollectionModule } from '../collection/collection.module.js'
import { DecksModule } from '../decks/decks.module.js'
import { MatchesModule } from '../matches/matches.module.js'
import { BearerTokenGuard, RequireScopes } from '../tokens/bearer-token.guard.js'
import { TokensModule } from '../tokens/tokens.module.js'
import { McpToolsService } from './mcp-tools.service.js'

@Controller('api/mcp')
@UseGuards(BearerTokenGuard)
@RequireScopes('mcp:read')
export class McpController implements OnModuleDestroy {
  private readonly handler: McpHttpHandler
  private readonly serveNode: NodeMcpRequestHandler

  constructor(
    tools: McpToolsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(McpController.name)
    this.handler = createMcpHandler((context) => tools.buildServer(context), {
      onerror: (error) => this.logger.warn({ err: error }, 'mcp request rejected'),
    })
    this.serveNode = toNodeHandler(this.handler, {
      onerror: (error) => this.logger.error({ err: error }, 'mcp adapter failed'),
    })
  }

  /** Every method goes to the SDK: POST serves, GET/DELETE answer 405 (no sessions, no standalone stream). */
  @All()
  async serve(
    @Req() req: Request & { auth?: AuthInfo },
    @Res() res: Response,
    @CurrentApiToken() token: RequestApiToken,
  ): Promise<void> {
    req.auth = { token: `api-token:${token.id}`, clientId: `${token.kind}:${token.name}`, scopes: token.scopes }
    // Express already parsed the JSON body (app.useBodyParser): hand it over instead of re-reading the stream.
    await this.serveNode(req, res, req.body)
  }

  async onModuleDestroy(): Promise<void> {
    await this.handler.close()
  }
}

@Module({
  imports: [TokensModule, CatalogModule, CollectionModule, DecksModule, MatchesModule],
  controllers: [McpController],
  providers: [McpToolsService],
})
export class McpModule {}
