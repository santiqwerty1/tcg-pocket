/**
 * The session chat over HTTP (D-021).
 * - `/api/mcp/chat`: the bridge between the chat file on Santi's PC and the cloud sessions. The coordinator's
 *   `chat.mjs` reads here what the cloud sessions wrote (`after` its own position, nothing marked read), copies here
 *   what was written at the PC, and can add a new session to the list. Only with a `chat:relay` token.
 * - `/api/chat/participants`: Santi's list of participants (Más → Tokens de API), with his session.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { CHAT_CHANNELS, chatParticipantName, MCP_CHAT_TOOLS } from '@tcg/domain'
import type { Request, Response } from 'express'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { CurrentApiToken, CurrentSession, type RequestApiToken, type RequestSession } from '../auth/request-auth.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { BearerTokenGuard, RequireScopes } from '../tokens/bearer-token.guard.js'
import { CHAT_RELAY_SCOPE } from '../tokens/token-format.js'
import { TokensModule } from '../tokens/tokens.module.js'
import { clientFromUserAgent, TokensService } from '../tokens/tokens.service.js'
import { type ChatFeedView, type ChatMessageView, type ChatParticipantView, ChatService } from './chat.service.js'

const feedQuerySchema = z.object({
  after: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

const relayWriteSchema = MCP_CHAT_TOOLS.chatWrite.input.extend({
  /** The bridge's id for the message (its id in the PC chat): sending it again returns the one already copied. */
  ref: z.string().trim().min(1).max(100),
})

const participantSchema = z.object({ name: chatParticipantName, channel: z.enum(CHAT_CHANNELS) })

@Controller('api/mcp/chat')
@UseGuards(BearerTokenGuard)
@RequireScopes(CHAT_RELAY_SCOPE)
export class ChatRelayController {
  constructor(
    private readonly chat: ChatService,
    private readonly tokens: TokensService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ChatRelayController.name)
  }

  @Get()
  async feed(
    @Query(new ZodValidationPipe(feedQuerySchema)) query: z.infer<typeof feedQuerySchema>,
    @Req() req: Request,
    @CurrentApiToken() token: RequestApiToken,
  ): Promise<ChatFeedView> {
    await this.noteClient(req, token)
    return this.chat.feed(query)
  }

  @Post()
  @HttpCode(201)
  async write(
    @Body(new ZodValidationPipe(relayWriteSchema)) body: z.infer<typeof relayWriteSchema>,
    @Req() req: Request,
    @CurrentApiToken() token: RequestApiToken,
  ): Promise<ChatMessageView & { duplicate: boolean }> {
    await this.noteClient(req, token)
    const { message, duplicate } = await this.chat.write({
      ...body,
      via: token.name,
      tokenId: Number(token.id),
      caller: 'relay',
    })
    return { ...message, duplicate }
  }

  @Get('participants')
  async participants(
    @Req() req: Request,
    @CurrentApiToken() token: RequestApiToken,
  ): Promise<{ items: ChatParticipantView[] }> {
    await this.noteClient(req, token)
    return { items: await this.chat.participants() }
  }

  /** A new PC or cloud session: `201`, or `200` if it was already there with that channel. */
  @Post('participants')
  async addParticipant(
    @Body(new ZodValidationPipe(participantSchema)) body: z.infer<typeof participantSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentApiToken() token: RequestApiToken,
  ): Promise<ChatParticipantView> {
    await this.noteClient(req, token)
    const { participant, created } = await this.chat.saveParticipant(body, 'relay')
    res.status(created ? 201 : 200)
    return participant
  }

  /** Like the MCP (Fase 43): another client using the bridge's token shows up in Avisos. */
  private async noteClient(req: Request, token: RequestApiToken): Promise<void> {
    const client = clientFromUserAgent(req.headers['user-agent'])
    if (await this.tokens.noteClient(Number(token.id), client).catch(() => false)) {
      this.logger.warn({ token: token.name, client }, 'chat relay token used by a new client')
    }
  }
}

/** Santi's list of chat participants (session-protected). */
@Controller('api/chat/participants')
export class ChatParticipantsController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  async list(@CurrentSession() _session: RequestSession): Promise<{ items: ChatParticipantView[] }> {
    return { items: await this.chat.participants() }
  }

  /** Adds a participant, or changes its channel or how its name is written. */
  @Put()
  async save(
    @Body(new ZodValidationPipe(participantSchema)) body: z.infer<typeof participantSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<ChatParticipantView> {
    return (await this.chat.saveParticipant(body, 'owner')).participant
  }

  @Delete(':name')
  @HttpCode(204)
  async remove(@Param('name') name: string, @CurrentSession() _session: RequestSession): Promise<void> {
    await this.chat.removeParticipant(name)
  }
}

@Module({
  imports: [TokensModule],
  controllers: [ChatRelayController, ChatParticipantsController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
