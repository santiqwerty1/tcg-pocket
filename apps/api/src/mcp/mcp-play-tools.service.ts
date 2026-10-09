/**
 * Claude analiza una partida (Fase 29): the owner's games against the bot and the review of one, for every token
 * (read only). The service is the same as `GET /api/play/:id/review`.
 */
import type { CallToolResult, McpServer, StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import { Injectable } from '@nestjs/common'
import { MCP_READ_TOOLS } from '@tcg/domain'
import { GameReviewService } from '../play/game-review.service.js'

type Json = Record<string, unknown>
type Run = (name: string, work: () => Promise<Json>) => Promise<CallToolResult>

interface ToolDefinition<S extends StandardSchemaWithJSON> {
  name: string
  title: string
  description: string
  input: S
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const

function config<S extends StandardSchemaWithJSON>(def: ToolDefinition<S>) {
  return { title: def.title, description: def.description, inputSchema: def.input, annotations: READ_ONLY }
}

@Injectable()
export class McpPlayToolsService {
  constructor(private readonly reviews: GameReviewService) {}

  registerRead(server: McpServer, run: Run): void {
    const t = MCP_READ_TOOLS
    server.registerTool(t.playGames.name, config(t.playGames), (args) =>
      run(t.playGames.name, async () => ({ games: await this.reviews.list(args.limit ?? 15) })),
    )
    server.registerTool(t.playGameReview.name, config(t.playGameReview), (args) =>
      run(t.playGameReview.name, async () => {
        const view = await this.reviews.review(String(args.id), {
          fromTurn: args.fromTurn,
          toTurn: args.toTurn,
          detail: args.detail,
        })
        return { ...view }
      }),
    )
  }
}
