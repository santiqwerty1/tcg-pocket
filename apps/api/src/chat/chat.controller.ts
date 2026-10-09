/**
 * The session chat over plain HTTP (D-021), for `scripts/chat.mjs` on Santi's PC: same data as the MCP tools
 * `chat_read` and `chat_write`. Under `/api/mcp`, so it takes the MCP bearer token (with `mcp:write`), not the
 * session cookie.
 */
import { Body, Controller, Get, HttpCode, Module, Post, Query, UseGuards } from '@nestjs/common'
import { CHAT_MAX_WAIT_SECONDS, MCP_CHAT_TOOLS } from '@tcg/domain'
import { z } from 'zod'
import { CurrentApiToken, type RequestApiToken } from '../auth/request-auth.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { BearerTokenGuard, RequireScopes } from '../tokens/bearer-token.guard.js'
import { TokensModule } from '../tokens/tokens.module.js'
import { type ChatMessageView, type ChatReadView, ChatService } from './chat.service.js'

const readQuerySchema = z.object({
  as: MCP_CHAT_TOOLS.chatRead.input.shape.as,
  wait: z.coerce.number().int().min(0).max(CHAT_MAX_WAIT_SECONDS).optional(),
  all: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

@Controller('api/mcp/chat')
@UseGuards(BearerTokenGuard)
@RequireScopes('mcp:write')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  read(@Query(new ZodValidationPipe(readQuerySchema)) query: z.infer<typeof readQuerySchema>): Promise<ChatReadView> {
    return this.chat.read({ as: query.as, waitSeconds: query.wait, all: query.all, limit: query.limit })
  }

  @Post()
  @HttpCode(201)
  write(
    @Body(new ZodValidationPipe(MCP_CHAT_TOOLS.chatWrite.input)) body: z.infer<typeof MCP_CHAT_TOOLS.chatWrite.input>,
    @CurrentApiToken() token: RequestApiToken,
  ): Promise<ChatMessageView> {
    return this.chat.write({ ...body, tokenId: Number(token.id) })
  }
}

@Module({
  imports: [TokensModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
