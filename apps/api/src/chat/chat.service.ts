/**
 * Chat between the Claude sessions that work on the app's code (D-021). The main chat is a file on Santi's PC; this
 * is its bridge to the cloud sessions, which only reach the app through the MCP (`chat_read`, `chat_write`). The
 * coordinator's `chat.mjs` copies messages both ways through `/api/mcp/chat` with a `chat:relay` token: only it can
 * write as the PC's participants (`CHAT_RESERVED`). Not Santi's data.
 *
 * What a cloud session has read is a set of message ids, not a watermark. The bridge keeps its own position (`after`
 * an id): inserts are serialized, so ids commit in order and nothing written later gets a smaller id.
 */
import { EventEmitter } from 'node:events'
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import {
  CHAT_EVERYONE,
  CHAT_MAX_WAIT_SECONDS,
  CHAT_RESERVED,
  chatKey,
  isReservedChatName,
  parseRecipients,
} from '@tcg/domain'
import { Prisma, type SessionChatMessage } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'

export interface ChatMessageView {
  id: number
  at: Date
  from: string
  to: string[]
  topic: string
  text: string
  /** How it arrived: the API token's name. */
  via: string
}

export interface ChatReadView {
  as: string
  /** `forYou`: addressed to the reader (or to «todos»). */
  messages: (ChatMessageView & { forYou: boolean })[]
  /** What is still new for the reader in the same scope after this read. */
  unreadLeft: number
  /** Who wrote in the last week, the most recent first. */
  participants: string[]
}

export interface ChatFeedView {
  /** In id order; `ref` is the bridge's own id for the ones it copied from the PC. */
  messages: (ChatMessageView & { ref: string | null })[]
  /** There are more after the last one: ask again with its id. */
  more: boolean
}

const DEFAULT_LIMIT = 30
const PARTICIPANTS_DAYS = 7
/** Development chatter is kept three months (D-021). */
const RETENTION_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000
/** `pg_advisory_xact_lock` key that serializes the inserts (any constant no other lock uses). */
const WRITE_LOCK = 20_261_009
const RESERVED_TEXT = CHAT_RESERVED.join(', ')

function addressedTo(row: Pick<SessionChatMessage, 'toKeys'>, key: string): boolean {
  return row.toKeys.includes(key) || row.toKeys.includes(CHAT_EVERYONE)
}

function toView(row: SessionChatMessage): ChatMessageView {
  return { id: row.id, at: row.at, from: row.fromName, to: row.toNames, topic: row.topic, text: row.body, via: row.via }
}

/** Messages addressed to `key` or to everyone. */
function forKey(key: string): Prisma.SessionChatMessageWhereInput {
  return { OR: [{ toKeys: { has: key } }, { toKeys: { has: CHAT_EVERYONE } }] }
}

@Injectable()
export class ChatService {
  /** Wakes the readers that are waiting (one process: the app runs on a single machine). */
  private readonly events = new EventEmitter()

  constructor(private readonly prisma: PrismaService) {
    this.events.setMaxListeners(100)
  }

  /**
   * `relay`: written by the bridge (`chat:relay`), which may use the PC's names and does not check recipients (the PC
   * chat already did); `ref` makes a retry return the message already copied.
   */
  async write(input: {
    from: string
    to: string | readonly string[]
    topic: string
    text: string
    via: string
    tokenId: number | null
    allowNew?: boolean | undefined
    relay?: boolean
    ref?: string | undefined
  }): Promise<{ message: ChatMessageView; unknownRecipients: string[]; duplicate: boolean }> {
    const relay = input.relay ?? false
    const fromKey = this.participantKey(input.from, relay)
    const to = parseRecipients(input.to)
    if (to.length === 0) throw new BadRequestException('Indicá a quién va el mensaje (o «todos»).')
    if (relay && input.ref) {
      const copied = await this.prisma.sessionChatMessage.findUnique({ where: { relayRef: input.ref } })
      if (copied) return { message: toView(copied), unknownRecipients: [], duplicate: true }
    }
    const unknownRecipients = await this.unknown(to)
    if (unknownRecipients.length > 0 && !input.allowNew && !relay) {
      throw new BadRequestException({
        code: 'unknown_recipient',
        message: `Nadie usó todavía el chat como ${unknownRecipients.map((name) => `«${name}»`).join(', ')}: revisá el nombre (o mandalo con allowNew).`,
        details: { unknownRecipients },
      })
    }
    const data: Prisma.SessionChatMessageCreateInput = {
      fromName: input.from.trim(),
      fromKey,
      toNames: to,
      toKeys: to.map(chatKey),
      topic: input.topic.trim(),
      body: input.text.trim(),
      tokenId: input.tokenId,
      via: input.via,
      relayRef: relay ? (input.ref ?? null) : null,
    }
    let row: SessionChatMessage
    try {
      row = await this.prisma.$transaction(async (tx) => {
        // One insert at a time: the id comes after the lock and the commit releases it, so ids commit in order.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${WRITE_LOCK}::bigint)`
        return tx.sessionChatMessage.create({ data })
      })
    } catch (error) {
      // The same `ref` sent twice at once: the second one finds the first.
      if (input.ref && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const copied = await this.prisma.sessionChatMessage.findUniqueOrThrow({ where: { relayRef: input.ref } })
        return { message: toView(copied), unknownRecipients: [], duplicate: true }
      }
      throw error
    }
    this.events.emit('message', row)
    await this.prisma.sessionChatMessage.deleteMany({
      where: { at: { lt: new Date(Date.now() - RETENTION_DAYS * DAY_MS) } },
    })
    return { message: toView(row), unknownRecipients, duplicate: false }
  }

  /**
   * What is new for `as` (scope «all»: everything the others wrote; «mine»: only what is addressed to it), marked read
   * only if the client is still there (`signal`). `all`: the history, nothing marked.
   */
  async read(input: {
    as: string
    scope?: 'all' | 'mine' | undefined
    waitSeconds?: number | undefined
    all?: boolean | undefined
    limit?: number | undefined
    signal?: AbortSignal | undefined
  }): Promise<ChatReadView> {
    const key = this.participantKey(input.as, false)
    const limit = input.limit ?? DEFAULT_LIMIT
    const mine = input.scope === 'mine'
    const inScope: Prisma.SessionChatMessageWhereInput = mine ? { OR: [forKey(key), { fromKey: key }] } : {}
    const unseen: Prisma.SessionChatMessageWhereInput = {
      AND: [{ NOT: { fromKey: key } }, mine ? forKey(key) : {}, { seen: { none: { participant: key } } }],
    }
    let messages: SessionChatMessage[]
    if (input.all) {
      messages = (
        await this.prisma.sessionChatMessage.findMany({ where: inScope, orderBy: { id: 'desc' }, take: limit })
      ).reverse()
    } else {
      const wait = Math.min(input.waitSeconds ?? 0, CHAT_MAX_WAIT_SECONDS)
      // Listening before the first look, so a message written in between is not missed until the timeout.
      const next = wait > 0 ? this.nextFor(key, wait * 1000, input.signal, mine) : null
      const look = () => this.prisma.sessionChatMessage.findMany({ where: unseen, orderBy: { id: 'asc' }, take: limit })
      messages = await look()
      if (messages.length === 0 && next) {
        await next.arrived
        messages = await look()
      }
      next?.cancel()
      // Marked read only if the client is still there to get them: a cut wait leaves them new.
      if (messages.length > 0 && !input.signal?.aborted) {
        await this.prisma.sessionChatSeen.createMany({
          data: messages.map((message) => ({ participant: key, messageId: message.id })),
          skipDuplicates: true,
        })
      }
    }
    const [unreadLeft, participants] = await Promise.all([
      this.prisma.sessionChatMessage.count({ where: unseen }),
      this.participants(),
    ])
    return {
      as: input.as.trim(),
      messages: messages.map((row) => ({ ...toView(row), forYou: addressedTo(row, key) })),
      unreadLeft,
      participants,
    }
  }

  /** The bridge's view: every message after `after`, in id order, without touching anyone's reads. */
  async feed(input: { after?: number | undefined; limit?: number | undefined }): Promise<ChatFeedView> {
    const limit = input.limit ?? 100
    const rows = await this.prisma.sessionChatMessage.findMany({
      where: { id: { gt: input.after ?? 0 } },
      orderBy: { id: 'asc' },
      take: limit + 1,
    })
    return {
      messages: rows.slice(0, limit).map((row) => ({ ...toView(row), ref: row.relayRef })),
      more: rows.length > limit,
    }
  }

  /** The PC's names only through the bridge; «todos» is not a participant. */
  private participantKey(name: string, relay: boolean): string {
    const key = chatKey(name)
    if (key === '' || key === CHAT_EVERYONE) {
      throw new BadRequestException(`«${name}» no sirve como nombre de una sesión del chat.`)
    }
    if (!relay && isReservedChatName(name)) {
      throw new ForbiddenException(
        `«${name.trim()}» es una sesión de la PC (${RESERVED_TEXT}): sus mensajes llegan por el puente. Usá el nombre de esta sesión («Nube-2», «Nube-Mejoras»…).`,
      )
    }
    return key
  }

  /** Recipients nobody has used: neither as a sender nor as a reader (the PC's names always exist). */
  private async unknown(to: readonly string[]): Promise<string[]> {
    const keys = to.map(chatKey).filter((key) => key !== CHAT_EVERYONE && !isReservedChatName(key))
    if (keys.length === 0) return []
    const [senders, readers] = await Promise.all([
      this.prisma.sessionChatMessage.findMany({
        where: { fromKey: { in: keys } },
        distinct: ['fromKey'],
        select: { fromKey: true },
      }),
      this.prisma.sessionChatSeen.findMany({
        where: { participant: { in: keys } },
        distinct: ['participant'],
        select: { participant: true },
      }),
    ])
    const known = new Set([...senders.map((row) => row.fromKey), ...readers.map((row) => row.participant)])
    return to.filter((name) => {
      const key = chatKey(name)
      return keys.includes(key) && !known.has(key)
    })
  }

  /** Everyone who wrote in the last week, the most recent first. */
  private async participants(): Promise<string[]> {
    const since = new Date(Date.now() - PARTICIPANTS_DAYS * DAY_MS)
    const rows = await this.prisma.$queryRaw<{ from_name: string; id: number }[]>`
      SELECT DISTINCT ON (from_key) from_name, id
      FROM session_chat_messages
      WHERE at >= ${since}
      ORDER BY from_key, id DESC`
    return rows.sort((a, b) => b.id - a.id).map((row) => row.from_name)
  }

  /**
   * `arrived` resolves when someone else writes (with `mine`, only a message addressed to `key`), after `ms`, or when
   * the client goes away; `cancel` stops listening.
   */
  private nextFor(
    key: string,
    ms: number,
    signal: AbortSignal | undefined,
    mine: boolean,
  ): { arrived: Promise<void>; cancel: () => void } {
    let done = () => {}
    const arrived = new Promise<void>((resolve) => {
      const onMessage = (row: SessionChatMessage) => {
        if (row.fromKey !== key && (!mine || addressedTo(row, key))) done()
      }
      const timer = setTimeout(() => done(), ms)
      const onAbort = () => done()
      done = () => {
        clearTimeout(timer)
        this.events.off('message', onMessage)
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }
      this.events.on('message', onMessage)
      if (signal?.aborted) done()
      else signal?.addEventListener('abort', onAbort)
    })
    return { arrived, cancel: () => done() }
  }
}
