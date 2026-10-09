/**
 * Chat between the Claude sessions that work on the app's code (D-021). The coordinator and the local sessions used
 * a file on Santi's PC; the cloud sessions only reach the app, so the chat lives here: through the MCP
 * (`chat_read`, `chat_write`) and through `/api/mcp/chat` for `scripts/chat.mjs`. Not Santi's data.
 */
import { EventEmitter } from 'node:events'
import { BadRequestException, Injectable } from '@nestjs/common'
import { CHAT_EVERYONE, CHAT_MAX_WAIT_SECONDS, chatKey, parseRecipients } from '@tcg/domain'
import type { Prisma, SessionChatMessage } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'

export interface ChatMessageView {
  id: number
  at: Date
  from: string
  to: string[]
  topic: string
  text: string
}

export interface ChatReadView {
  as: string
  messages: ChatMessageView[]
  /** New messages for `as` still unread after this read (when more than `limit` were waiting). */
  unreadLeft: number
  /** Who wrote in the last week, to know whom to address. */
  participants: string[]
}

const DEFAULT_LIMIT = 30
const PARTICIPANTS_DAYS = 7

function toView(row: SessionChatMessage): ChatMessageView {
  return { id: row.id, at: row.at, from: row.fromName, to: row.toNames, topic: row.topic, text: row.body }
}

/** The messages `key` should read: addressed to it, or to everyone by someone else. */
function forParticipant(key: string): Prisma.SessionChatMessageWhereInput {
  return {
    OR: [{ toKeys: { has: key } }, { AND: [{ toKeys: { has: CHAT_EVERYONE } }, { NOT: { fromKey: key } }] }],
  }
}

function participantKey(name: string): string {
  const key = chatKey(name)
  if (key === '' || key === CHAT_EVERYONE) {
    throw new BadRequestException(`«${name}» no sirve como nombre de una sesión del chat.`)
  }
  return key
}

@Injectable()
export class ChatService {
  /** Wakes the readers that are waiting (one process: the app runs on a single machine). */
  private readonly events = new EventEmitter()

  constructor(private readonly prisma: PrismaService) {
    this.events.setMaxListeners(100)
  }

  async write(input: {
    from: string
    to: string | readonly string[]
    topic: string
    text: string
    tokenId: number | null
  }): Promise<ChatMessageView> {
    const fromKey = participantKey(input.from)
    const to = parseRecipients(input.to)
    if (to.length === 0) throw new BadRequestException('Indicá a quién va el mensaje (o «todos»).')
    const row = await this.prisma.sessionChatMessage.create({
      data: {
        fromName: input.from.trim(),
        fromKey,
        toNames: to,
        toKeys: to.map(chatKey),
        topic: input.topic.trim(),
        body: input.text.trim(),
        tokenId: input.tokenId,
      },
    })
    this.events.emit('message', row)
    return toView(row)
  }

  async read(input: { as: string; waitSeconds?: number; all?: boolean; limit?: number }): Promise<ChatReadView> {
    const key = participantKey(input.as)
    const limit = input.limit ?? DEFAULT_LIMIT
    const mine = forParticipant(key)
    const unseen: Prisma.SessionChatMessageWhereInput = { AND: [mine, { seen: { none: { participant: key } } }] }
    let messages: SessionChatMessage[]
    if (input.all) {
      messages = (
        await this.prisma.sessionChatMessage.findMany({ where: mine, orderBy: { id: 'desc' }, take: limit })
      ).reverse()
    } else {
      const wait = Math.min(input.waitSeconds ?? 0, CHAT_MAX_WAIT_SECONDS)
      // Listening before the first look, so a message written in between is not missed until the timeout.
      const next = wait > 0 ? this.nextFor(key, wait * 1000) : null
      const look = () => this.prisma.sessionChatMessage.findMany({ where: unseen, orderBy: { id: 'asc' }, take: limit })
      messages = await look()
      if (messages.length === 0 && next) {
        await next.arrived
        messages = await look()
      }
      next?.cancel()
    }
    // Exactly the messages returned are marked as read: an older one not returned (or committed late) stays unread.
    if (messages.length > 0) {
      await this.prisma.sessionChatSeen.createMany({
        data: messages.map((message) => ({ participant: key, messageId: message.id })),
        skipDuplicates: true,
      })
    }
    const [unreadLeft, participants] = await Promise.all([
      this.prisma.sessionChatMessage.count({ where: unseen }),
      this.participants(),
    ])
    return { as: input.as.trim(), messages: messages.map(toView), unreadLeft, participants }
  }

  /** Everyone who wrote in the last week, the most recent first. */
  private async participants(): Promise<string[]> {
    const since = new Date(Date.now() - PARTICIPANTS_DAYS * 24 * 60 * 60 * 1000)
    const rows = await this.prisma.$queryRaw<{ from_name: string; id: number }[]>`
      SELECT DISTINCT ON (from_key) from_name, id
      FROM session_chat_messages
      WHERE at >= ${since}
      ORDER BY from_key, id DESC`
    return rows.sort((a, b) => b.id - a.id).map((row) => row.from_name)
  }

  /** `arrived` resolves when a message for `key` is written, or after `ms`; `cancel` stops listening. */
  private nextFor(key: string, ms: number): { arrived: Promise<void>; cancel: () => void } {
    let done = () => {}
    const arrived = new Promise<void>((resolve) => {
      const onMessage = (row: SessionChatMessage) => {
        if (row.toKeys.includes(key) || (row.toKeys.includes(CHAT_EVERYONE) && row.fromKey !== key)) done()
      }
      const timer = setTimeout(() => done(), ms)
      done = () => {
        clearTimeout(timer)
        this.events.off('message', onMessage)
        resolve()
      }
      this.events.on('message', onMessage)
    })
    return { arrived, cancel: () => done() }
  }
}
