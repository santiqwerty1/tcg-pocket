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
import { AlertsModule } from '../alerts/alerts.controller.js'
import { CurrentApiToken, type RequestApiToken } from '../auth/request-auth.js'
import { CatalogModule } from '../catalog/catalog.module.js'
import { CollectionModule } from '../collection/collection.module.js'
import { DecksModule } from '../decks/decks.module.js'
import { EventsModule } from '../events/events.controller.js'
import { LabModule } from '../lab/lab.controller.js'
import { MatchesModule } from '../matches/matches.module.js'
import { PacksModule } from '../packs/packs.controller.js'
import { PickModule } from '../pick/pick.controller.js'
import { PlayModule } from '../play/play.controller.js'
import { RivalNotesModule } from '../rivals/rival-notes.controller.js'
import { SimulationModule } from '../simulation/simulation.controller.js'
import { BearerTokenGuard, RequireScopes } from '../tokens/bearer-token.guard.js'
import { TokensModule } from '../tokens/tokens.module.js'
import { clientFromUserAgent, TokensService } from '../tokens/tokens.service.js'
import { TournamentsModule } from '../tournaments/tournaments.controller.js'
import { TradesModule } from '../trades/trades.controller.js'
import { WeeklyModule } from '../weekly/weekly.controller.js'
import { DeckRefResolver } from './deck-ref.js'
import { McpAuditController } from './mcp-audit.controller.js'
import { McpAuditService } from './mcp-audit.service.js'
import { McpLabToolsService } from './mcp-lab-tools.service.js'
import { McpPlayToolsService } from './mcp-play-tools.service.js'
import { type McpCallerInfo, McpToolsService } from './mcp-tools.service.js'
import { McpWriteToolsService } from './mcp-write-tools.service.js'

@Controller('api/mcp')
@UseGuards(BearerTokenGuard)
@RequireScopes('mcp:read')
export class McpController implements OnModuleDestroy {
  private readonly handler: McpHttpHandler
  private readonly serveNode: NodeMcpRequestHandler

  constructor(
    tools: McpToolsService,
    private readonly tokens: TokensService,
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
    @Req() req: Request & { auth?: AuthInfo; id?: unknown },
    @Res() res: Response,
    @CurrentApiToken() token: RequestApiToken,
  ): Promise<void> {
    // Fase 43 (R-010): who is calling, for the write log and the «cliente nuevo» alert.
    const client = clientFromUserAgent(req.headers['user-agent'])
    const tokenId = Number(token.id)
    if (await this.tokens.noteClient(tokenId, client).catch(() => false)) {
      this.logger.warn({ token: token.name, client }, 'mcp token used by a new client')
    }
    const extra: McpCallerInfo = { tokenId, tokenName: token.name, client, requestId: String(req.id ?? '') }
    req.auth = {
      token: `api-token:${token.id}`,
      clientId: `${token.kind}:${token.name}`,
      scopes: token.scopes,
      extra: { ...extra },
    }
    // Express already parsed the JSON body (app.useBodyParser): hand it over instead of re-reading the stream.
    await this.serveNode(req, res, req.body)
  }

  async onModuleDestroy(): Promise<void> {
    await this.handler.close()
  }
}

@Module({
  imports: [
    AlertsModule,
    TokensModule,
    CatalogModule,
    CollectionModule,
    DecksModule,
    MatchesModule,
    PacksModule,
    TournamentsModule,
    SimulationModule,
    LabModule,
    RivalNotesModule,
    PickModule,
    EventsModule,
    PlayModule,
    TradesModule,
    WeeklyModule,
  ],
  controllers: [McpController, McpAuditController],
  providers: [
    McpToolsService,
    McpWriteToolsService,
    McpLabToolsService,
    McpPlayToolsService,
    McpAuditService,
    DeckRefResolver,
  ],
})
export class McpModule {}
