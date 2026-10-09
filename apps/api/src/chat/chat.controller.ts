/**
 * The bridge between the chat file on Santi's PC and the cloud sessions (D-021): the coordinator's `chat.mjs` reads
 * here what the cloud sessions wrote (`after` its own position, nothing marked read) and copies here what was written
 * at the PC. Only with a `chat:relay` token, the only one that can write as the PC's participants.
 */
import { Body, Controller, Get, HttpCode, Module, Post, Query, UseGuards } from '@nestjs/common'
import { MCP_CHAT_TOOLS } from '@tcg/domain'
import { z } from 'zod'
import { CurrentApiToken, type RequestApiToken } from '../auth/request-auth.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { BearerTokenGuard, RequireScopes } from '../tokens/bearer-token.guard.js'
import { CHAT_RELAY_SCOPE } from '../tokens/token-format.js'
import { TokensModule } from '../tokens/tokens.module.js'
import { type ChatFeedView, type ChatMessageView, ChatService } from './chat.service.js'

const feedQuerySchema = z.object({
  after: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

const relayWriteSchema = MCP_CHAT_TOOLS.chatWrite.input.omit({ allowNew: true }).extend({
  /** The bridge's id for the message (its id in the PC chat): sending it again returns the one already copied. */
  ref: z.string().trim().min(1).max(100).optional(),
})

@Controller('api/mcp/chat')
@UseGuards(BearerTokenGuard)
@RequireScopes(CHAT_RELAY_SCOPE)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  feed(@Query(new ZodValidationPipe(feedQuerySchema)) query: z.infer<typeof feedQuerySchema>): Promise<ChatFeedView> {
    return this.chat.feed(query)
  }

  @Post()
  @HttpCode(201)
  async write(
    @Body(new ZodValidationPipe(relayWriteSchema)) body: z.infer<typeof relayWriteSchema>,
    @CurrentApiToken() token: RequestApiToken,
  ): Promise<ChatMessageView & { duplicate: boolean }> {
    const { message, duplicate } = await this.chat.write({
      ...body,
      via: token.name,
      tokenId: Number(token.id),
      relay: true,
    })
    return { ...message, duplicate }
  }
}

@Module({
  imports: [TokensModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
