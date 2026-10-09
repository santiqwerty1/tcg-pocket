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
    let messages: SessionChatMessage[]
    if (input.all) {
      messages = (
        await this.prisma.sessionChatMessage.findMany({ where: mine, orderBy: { id: 'desc' }, take: limit })
      ).reverse()
    } else {
      const lastRead = (await this.prisma.sessionChatRead.findUnique({ where: { participant: key } }))?.lastReadId ?? 0
      const unread = () =>
        this.prisma.sessionChatMessage.findMany({
          where: { AND: [mine, { id: { gt: lastRead } }] },
          orderBy: { id: 'asc' },
          take: limit,
        })
      const wait = Math.min(input.waitSeconds ?? 0, CHAT_MAX_WAIT_SECONDS)
      // Listening before the first look, so a message written in between is not missed until the timeout.
      const next = wait > 0 ? this.nextFor(key, wait * 1000) : null
      messages = await unread()
      if (messages.length === 0 && next) {
        await next.arrived
        messages = await unread()
      }
      next?.cancel()
    }
    const newest = messages.at(-1)?.id
    if (newest !== undefined) {
      await this.prisma.sessionChatRead.upsert({
        where: { participant: key },
        create: { participant: key, lastReadId: newest },
        update: { lastReadId: { set: newest } },
      })
    }
    const readUpTo =
      newest ?? (await this.prisma.sessionChatRead.findUnique({ where: { participant: key } }))?.lastReadId ?? 0
    const [unreadLeft, participants] = await Promise.all([
      this.prisma.sessionChatMessage.count({ where: { AND: [mine, { id: { gt: readUpTo } }] } }),
      this.participants(),
    ])
    return { as: input.as.trim(), messages: messages.map(toView), unreadLeft, participants }
  }

  /** Senders of the last week, most recent first. */
  private async participants(): Promise<string[]> {
    const rows = await this.prisma.sessionChatMessage.findMany({
      where: { at: { gte: new Date(Date.now() - PARTICIPANTS_DAYS * 24 * 60 * 60 * 1000) } },
      orderBy: { id: 'desc' },
      select: { fromName: true, fromKey: true },
      take: 500,
    })
    const seen = new Map<string, string>()
    for (const row of rows) if (!seen.has(row.fromKey)) seen.set(row.fromKey, row.fromName)
    return [...seen.values()]
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
