/**
 * The session chat over HTTP (D-021).
 * - `/api/mcp/chat`: the bridge between the chat file on Santi's PC and the cloud sessions. The coordinator's
 *   `chat.mjs` reads here what the cloud sessions wrote (`after` its own position, nothing marked read), copies here
 *   what was written at the PC, and can add a new session to the list. Only with a `chat:relay` token.
 * - `/api/chat/participants`: Santi's list of participants (Más → Tokens de API), with his session.
 * Rooms (13/10/2026): every bridge route takes `?sala=` («tcg» without it, so the bridge of before sees only «tcg»).
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
import {
  CHAT_CHANNELS,
  CHAT_DEFAULT_ROOM,
  CHAT_EXPORT_MAX_LIMIT,
  CHAT_ROOMS,
  type ChatRoom,
  chatParticipantName,
  chatRoom,
  MCP_CHAT_TOOLS,
} from '@tcg/domain'
import type { Request, Response } from 'express'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { CurrentApiToken, CurrentSession, type RequestApiToken, type RequestSession } from '../auth/request-auth.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { BearerTokenGuard, RequireScopes } from '../tokens/bearer-token.guard.js'
import { CHAT_EXPORT_SCOPE, CHAT_RELAY_SCOPE } from '../tokens/token-format.js'
import { TokensModule } from '../tokens/tokens.module.js'
import { clientFromUserAgent, TokensService } from '../tokens/tokens.service.js'
import { type ChatFeedView, type ChatMessageView, type ChatParticipantView, ChatService } from './chat.service.js'
import { ChatTransferService } from './chat-transfer.service.js'

/** The bridge's room: «tcg» when it does not say it. */
const roomQuerySchema = z.object({ sala: chatRoom.optional() })
const roomOf = (query: { sala?: ChatRoom | undefined }): ChatRoom => query.sala ?? CHAT_DEFAULT_ROOM

const feedQuerySchema = roomQuerySchema.extend({
  after: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

/** The room goes in `?sala=`, like the other routes of the bridge. */
const relayWriteSchema = MCP_CHAT_TOOLS.chatWrite.input.omit({ sala: true }).extend({
  /** The bridge's id for the message (its id in the PC chat): sending it again returns the one already copied. */
  ref: z.string().trim().min(1).max(100),
})

const participantSchema = z.object({ name: chatParticipantName, channel: z.enum(CHAT_CHANNELS) })

/** Santi's: also its rooms, the main one first. */
const ownerParticipantSchema = participantSchema.extend({
  rooms: z
    .array(chatRoom)
    .min(1)
    .max(CHAT_ROOMS.length)
    .refine((rooms) => new Set(rooms).size === rooms.length, 'Cada sala una vez')
    .optional(),
})

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
    return this.chat.feed({ after: query.after, limit: query.limit, room: roomOf(query) })
  }

  @Post()
  @HttpCode(201)
  async write(
    @Body(new ZodValidationPipe(relayWriteSchema)) body: z.infer<typeof relayWriteSchema>,
    @Query(new ZodValidationPipe(roomQuerySchema)) query: z.infer<typeof roomQuerySchema>,
    @Req() req: Request,
    @CurrentApiToken() token: RequestApiToken,
  ): Promise<ChatMessageView & { duplicate: boolean }> {
    await this.noteClient(req, token)
    const { message, duplicate } = await this.chat.write({
      ...body,
      via: token.name,
      tokenId: Number(token.id),
      caller: 'relay',
      room: roomOf(query),
    })
    return { ...message, duplicate }
  }

  /** Who is in the room. */
  @Get('participants')
  async participants(
    @Query(new ZodValidationPipe(roomQuerySchema)) query: z.infer<typeof roomQuerySchema>,
    @Req() req: Request,
    @CurrentApiToken() token: RequestApiToken,
  ): Promise<{ items: ChatParticipantView[] }> {
    await this.noteClient(req, token)
    return { items: await this.chat.participants(roomOf(query)) }
  }

  /**
   * A new PC or cloud session in the room: `201` (also when one already there with that channel joins the room), or
   * `200` if it was already in it.
   */
  @Post('participants')
  async addParticipant(
    @Body(new ZodValidationPipe(participantSchema)) body: z.infer<typeof participantSchema>,
    @Query(new ZodValidationPipe(roomQuerySchema)) query: z.infer<typeof roomQuerySchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentApiToken() token: RequestApiToken,
  ): Promise<ChatParticipantView> {
    await this.noteClient(req, token)
    const { participant, created } = await this.chat.saveParticipant(body, 'relay', roomOf(query))
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

/** «tcg,posta»: rooms of `CHAT_ROOMS` only; without it, all of them. */
const exportQuerySchema = z.object({
  salas: z
    .string()
    .max(200)
    .optional()
    .transform((value, ctx) => {
      const rooms = [
        ...new Set(
          (value ?? '')
            .split(',')
            .map((room) => room.trim())
            .filter(Boolean),
        ),
      ]
      const unknown = rooms.filter((room) => !(CHAT_ROOMS as readonly string[]).includes(room))
      if (unknown.length > 0) {
        ctx.addIssue({ code: 'custom', message: `Salas del chat: ${CHAT_ROOMS.join(', ')} (no ${unknown.join(', ')})` })
        return z.NEVER
      }
      return (rooms.length === 0 ? [...CHAT_ROOMS] : rooms) as ChatRoom[]
    }),
  after: z.coerce.number().int().min(0).max(2_147_483_647).optional(),
  limit: z.coerce.number().int().min(1).max(CHAT_EXPORT_MAX_LIMIT).optional(),
})

/**
 * The export of the chat for its move to the hub (D-030, T1a): `chat-export` v1 in pages by id, only with a token
 * whose only scope is `chat:export` (no token gets it unless chosen on purpose). Read only.
 */
@Controller('api/mcp/chat/export')
@UseGuards(BearerTokenGuard)
@RequireScopes(CHAT_EXPORT_SCOPE)
export class ChatExportController {
  constructor(
    private readonly transfer: ChatTransferService,
    private readonly tokens: TokensService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ChatExportController.name)
  }

  @Get()
  async export(
    @Query(new ZodValidationPipe(exportQuerySchema)) query: z.infer<typeof exportQuerySchema>,
    @Req() req: Request,
    @CurrentApiToken() token: RequestApiToken,
  ) {
    const client = clientFromUserAgent(req.headers['user-agent'])
    if (await this.tokens.noteClient(Number(token.id), client).catch(() => false)) {
      this.logger.warn({ token: token.name, client }, 'chat export token used by a new client')
    }
    return this.transfer.exportPage({ rooms: query.salas, after: query.after, limit: query.limit })
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

  /** Adds a participant, or changes its channel, its rooms or how its name is written. */
  @Put()
  async save(
    @Body(new ZodValidationPipe(ownerParticipantSchema)) body: z.infer<typeof ownerParticipantSchema>,
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
  controllers: [ChatRelayController, ChatParticipantsController, ChatExportController],
  providers: [ChatService, ChatTransferService],
  exports: [ChatService, ChatTransferService],
})
export class ChatModule {}
