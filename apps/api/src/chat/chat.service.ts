/**
 * Chat between the Claude sessions that work on the app's code (D-021). The main chat is a file on Santi's PC; this
 * is its bridge to the cloud sessions, which only reach the app through the MCP (`chat_read`, `chat_write`). The
 * coordinator's `chat.mjs` copies messages both ways through `/api/mcp/chat` with a `chat:relay` token. Not Santi's
 * data.
 *
 * Who takes part is a list (`session_chat_participants`): `from`, `to` and `as` must be one of its names exactly (only
 * the case does not matter), and each participant writes only from its channel. No variant of a name passes.
 *
 * What a cloud session has read is a set of message ids, not a watermark. The bridge keeps its own position (`after`
 * an id): inserts are serialized, so ids commit in order and nothing written later gets a smaller id.
 */
import { EventEmitter } from 'node:events'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  CHAT_EVERYONE,
  CHAT_MAX_WAIT_SECONDS,
  CHAT_OWNER,
  CHAT_READ_BUDGET,
  type ChatChannel,
  chatKey,
  parseRecipients,
} from '@tcg/domain'
import { PinoLogger } from 'nestjs-pino'
import { Prisma, type SessionChatMessage, type SessionChatParticipant } from '../generated/prisma/client.js'
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
  /** The names in the list of participants. */
  participants: string[]
}

export interface ChatFeedView {
  /** In id order; `relayed`: the bridge copied it from the PC (`ref`: its id there). */
  messages: (ChatMessageView & { relayed: boolean; ref: string | null })[]
  /** There are more after the last one: ask again with its id. */
  more: boolean
}

export interface ChatParticipantView {
  name: string
  channel: ChatChannel
  createdAt: Date
}

/** Who is writing: a cloud session through the MCP, or the bridge from the PC. */
export type ChatCaller = 'connector' | 'relay'

const DEFAULT_LIMIT = 30
/** Development chatter is kept three months (D-021). */
const RETENTION_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000
/** `pg_advisory_xact_lock` key that serializes the inserts (any constant no other lock uses). */
const WRITE_LOCK = 20_261_009
const OWNER_KEY = chatKey(CHAT_OWNER)

/** The participant channels each caller can write as. */
const WRITES_AS: Record<ChatCaller, readonly ChatChannel[]> = {
  connector: ['connector'],
  relay: ['relay', 'owner'],
}

const CHANNEL_RULE: Record<ChatChannel, string> = {
  owner: 'Santi escribe solo desde la app o por el puente de la PC',
  relay: 'es una sesión de la PC: escribe solo por el puente',
  connector: 'es una sesión en la nube: escribe solo por el conector MCP',
}

function addressedTo(row: Pick<SessionChatMessage, 'toKeys'>, key: string): boolean {
  return row.toKeys.includes(key) || row.toKeys.includes(CHAT_EVERYONE)
}

/**
 * The messages that fit in one read (`CHAT_READ_BUDGET`, at least one): the first ones, or with `newest` the last
 * ones (the history).
 */
function withinBudget(rows: SessionChatMessage[], newest: boolean): SessionChatMessage[] {
  const ordered = newest ? [...rows].reverse() : rows
  const kept: SessionChatMessage[] = []
  let used = 0
  for (const row of ordered) {
    used += row.body.length + row.topic.length
    if (kept.length > 0 && used > CHAT_READ_BUDGET) break
    kept.push(row)
  }
  return newest ? kept.reverse() : kept
}

function toView(row: SessionChatMessage): ChatMessageView {
  return { id: row.id, at: row.at, from: row.fromName, to: row.toNames, topic: row.topic, text: row.body, via: row.via }
}

function participantView(row: SessionChatParticipant): ChatParticipantView {
  return { name: row.name, channel: row.channel, createdAt: row.createdAt }
}

/** Messages addressed to `key` or to everyone. */
function forKey(key: string): Prisma.SessionChatMessageWhereInput {
  return { OR: [{ toKeys: { has: key } }, { toKeys: { has: CHAT_EVERYONE } }] }
}

@Injectable()
export class ChatService {
  /** Wakes the readers that are waiting (one process: the app runs on a single machine). */
  private readonly events = new EventEmitter()

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ChatService.name)
    this.events.setMaxListeners(100)
  }

  /**
   * `caller`: a cloud session (`connector`) writes only as a cloud participant; the bridge (`relay`) as Santi or a PC
   * session. `ref` (the bridge's id for the message, required by its route) makes a retry return the one already
   * copied.
   */
  async write(input: {
    from: string
    to: string | readonly string[]
    topic: string
    text: string
    via: string
    tokenId: number | null
    caller: ChatCaller
    ref?: string | undefined
  }): Promise<{ message: ChatMessageView; duplicate: boolean }> {
    // A retry of a message already copied returns it, even if the list changed since; another message under the
    // same ref is an error, never a silent loss.
    if (input.ref) {
      const copied = await this.prisma.sessionChatMessage.findUnique({ where: { relayRef: input.ref } })
      if (copied) {
        this.sameAsCopied(copied, input)
        return { message: toView(copied), duplicate: true }
      }
    }
    const list = await this.list()
    const sender = this.member(list, input.from)
    if (!WRITES_AS[input.caller].includes(sender.channel)) {
      throw new ForbiddenException({
        code: 'wrong_channel',
        message: `«${sender.name}» ${CHANNEL_RULE[sender.channel]}.`,
      })
    }
    const named = parseRecipients(input.to)
    if (named.length === 0) throw new BadRequestException('Indicá a quién va el mensaje (o «todos»).')
    const to = named[0] === CHAT_EVERYONE ? [CHAT_EVERYONE] : named.map((name) => this.member(list, name).name)
    const data: Prisma.SessionChatMessageCreateInput = {
      fromName: sender.name,
      fromKey: sender.key,
      toNames: to,
      toKeys: to.map(chatKey),
      topic: input.topic.trim(),
      body: input.text.trim(),
      tokenId: input.tokenId,
      via: input.via,
      relayRef: input.ref ?? null,
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
        this.sameAsCopied(copied, input)
        return { message: toView(copied), duplicate: true }
      }
      throw error
    }
    this.events.emit('message', row)
    await this.cleanUp()
    return { message: toView(row), duplicate: false }
  }

  /**
   * What is new for `as`, a cloud participant (scope «all»: everything the others wrote; «mine»: only what is addressed
   * to it), up to `CHAT_READ_BUDGET` characters, marked read last and only if the client is still there (`signal`).
   * `all`: the history, nothing marked.
   */
  async read(input: {
    as: string
    scope?: 'all' | 'mine' | undefined
    waitSeconds?: number | undefined
    all?: boolean | undefined
    limit?: number | undefined
    signal?: AbortSignal | undefined
  }): Promise<ChatReadView> {
    const list = await this.list()
    const reader = this.member(list, input.as)
    if (reader.channel !== 'connector') {
      throw new ForbiddenException({
        code: 'wrong_channel',
        message: `«${reader.name}» no lee el chat por acá: usá el nombre de esta sesión, nunca el de otra.`,
      })
    }
    const key = reader.key
    const limit = input.limit ?? DEFAULT_LIMIT
    const mine = input.scope === 'mine'
    const inScope: Prisma.SessionChatMessageWhereInput = mine ? { OR: [forKey(key), { fromKey: key }] } : {}
    // A participant added later starts after the message that was the last one then.
    const unseen: Prisma.SessionChatMessageWhereInput = {
      AND: [
        { id: { gt: reader.sinceId } },
        { NOT: { fromKey: key } },
        mine ? forKey(key) : {},
        { seen: { none: { participant: key } } },
      ],
    }
    let messages: SessionChatMessage[]
    if (input.all) {
      messages = withinBudget(
        (
          await this.prisma.sessionChatMessage.findMany({ where: inScope, orderBy: { id: 'desc' }, take: limit })
        ).reverse(),
        true,
      )
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
      // What does not fit stays new for the next read.
      messages = withinBudget(messages, false)
    }
    const marking = !input.all && messages.length > 0
    const unreadLeft = await this.prisma.sessionChatMessage.count({
      where: marking ? { AND: [unseen, { id: { notIn: messages.map((message) => message.id) } }] } : unseen,
    })
    // Marked read last, and only if the client is still there to get them: a cut wait, or a failure before this
    // point, leaves them new.
    if (marking && !input.signal?.aborted) {
      await this.prisma.sessionChatSeen.createMany({
        data: messages.map((message) => ({ participant: key, messageId: message.id })),
        skipDuplicates: true,
      })
    }
    return {
      as: reader.name,
      messages: messages.map((row) => ({ ...toView(row), forYou: addressedTo(row, key) })),
      unreadLeft,
      participants: list.map((participant) => participant.name),
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
      messages: rows
        .slice(0, limit)
        .map((row) => ({ ...toView(row), relayed: row.relayRef !== null, ref: row.relayRef })),
      more: rows.length > limit,
    }
  }

  async participants(): Promise<ChatParticipantView[]> {
    return (await this.list()).map(participantView)
  }

  /**
   * Santi's list (Más → Tokens de API): adds a participant or changes its channel (or how its name is written).
   * The bridge adds new ones only: a PC or cloud session, never one already in the list.
   */
  async saveParticipant(
    input: { name: string; channel: ChatChannel },
    by: 'owner' | 'relay',
  ): Promise<{ participant: ChatParticipantView; created: boolean }> {
    const name = input.name.trim()
    const key = chatKey(name)
    if (key === CHAT_EVERYONE) throw new BadRequestException(`«${CHAT_EVERYONE}» no es una sesión: llega a todas.`)
    // Santi is always there and always `owner`; nobody else is.
    if (key === OWNER_KEY) {
      throw new ForbiddenException({
        code: 'owner_fixed',
        message: `«${CHAT_OWNER}» está siempre en la lista y siempre escribe como Santi: no se cambia.`,
      })
    }
    if (input.channel === 'owner') {
      throw new BadRequestException({
        code: 'owner_fixed',
        message: `El canal de Santi es solo para «${CHAT_OWNER}».`,
      })
    }
    // A new participant starts after the last message: the history before it counts as read.
    const sinceId = (await this.prisma.sessionChatMessage.aggregate({ _max: { id: true } }))._max.id ?? 0
    if (by === 'relay') {
      // Create-only, in one statement: a name already there (or added at the same moment) is never changed.
      const inserted = await this.prisma.sessionChatParticipant.createMany({
        data: [{ key, name, channel: input.channel, sinceId }],
        skipDuplicates: true,
      })
      const row = await this.prisma.sessionChatParticipant.findUniqueOrThrow({ where: { key } })
      if (inserted.count === 0 && row.channel !== input.channel) {
        throw new ConflictException({
          code: 'participant_exists',
          message: `«${row.name}» ya está en la lista con otro canal: lo cambia Santi en la app.`,
        })
      }
      return { participant: participantView(row), created: inserted.count > 0 }
    }
    const current = await this.prisma.sessionChatParticipant.findUnique({ where: { key } })
    const row = await this.prisma.sessionChatParticipant.upsert({
      where: { key },
      create: { key, name, channel: input.channel, sinceId },
      update: { name, channel: input.channel },
    })
    return { participant: participantView(row), created: !current }
  }

  /** Santi takes a participant out; its messages stay. Santi himself stays. */
  async removeParticipant(name: string): Promise<void> {
    if (chatKey(name) === OWNER_KEY) {
      throw new ForbiddenException({ code: 'owner_fixed', message: `«${CHAT_OWNER}» no se quita de la lista.` })
    }
    const removed = await this.prisma.sessionChatParticipant.deleteMany({ where: { key: chatKey(name) } })
    if (removed.count === 0) throw new NotFoundException(`«${name}» no está en la lista de participantes.`)
  }

  /** The same ref with another sender, recipients, topic or text: `409`, so the bridge notices. */
  private sameAsCopied(
    copied: SessionChatMessage,
    input: { from: string; to: string | readonly string[]; topic: string; text: string },
  ): void {
    const keys = (names: readonly string[]) => [...names].map(chatKey).sort().join('\u0000')
    const same =
      copied.fromKey === chatKey(input.from) &&
      keys(copied.toKeys) === keys(parseRecipients(input.to)) &&
      copied.topic === input.topic.trim() &&
      copied.body === input.text.trim()
    if (!same) {
      throw new ConflictException({
        code: 'ref_conflict',
        message: `El ref «${copied.relayRef}» ya se usó para otro mensaje (#${copied.id}): no lo pisa.`,
        details: { id: copied.id },
      })
    }
  }

  /** The list, with Santi always there and always `owner` (even if its row was touched by hand). */
  private async list(): Promise<SessionChatParticipant[]> {
    const rows = await this.prisma.sessionChatParticipant.findMany({ orderBy: [{ channel: 'asc' }, { name: 'asc' }] })
    const owner = rows.find((row) => row.key === OWNER_KEY)
    const others = rows.filter((row) => row.key !== OWNER_KEY && row.channel !== 'owner')
    return [
      owner
        ? { ...owner, name: CHAT_OWNER, channel: 'owner' }
        : { key: OWNER_KEY, name: CHAT_OWNER, channel: 'owner', sinceId: 0, createdAt: new Date(0) },
      ...others,
    ]
  }

  /** The list's entry for a name: exactly that name, only the case does not matter. */
  private member(list: readonly SessionChatParticipant[], name: string): SessionChatParticipant {
    const key = chatKey(name)
    const found = list.find((participant) => participant.key === key)
    if (!found) {
      throw new BadRequestException({
        code: 'unknown_participant',
        message: `«${name.trim()}» no está en la lista de participantes del chat (${list.map((participant) => participant.name).join(', ')}). Una sesión nueva la suma Santi en Más → Tokens de API.`,
        details: { participants: list.map((participant) => participant.name) },
      })
    }
    return found
  }

  /**
   * After a message is in, what is past the retention goes. Best effort: the message is already sent, so a failure
   * here is logged, never answered (a retry would send it twice).
   */
  private async cleanUp(): Promise<void> {
    try {
      const before = new Date(Date.now() - RETENTION_DAYS * DAY_MS)
      await this.prisma.sessionChatMessage.deleteMany({ where: { at: { lt: before } } })
    } catch (error) {
      this.logger.warn({ err: error }, 'chat clean-up failed')
    }
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
