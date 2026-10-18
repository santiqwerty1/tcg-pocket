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
 *
 * Rooms (Santi, 13/10/2026): each message is in one (`CHAT_ROOMS`), and each participant is in some, its main one
 * first. Whoever writes, every recipient and whoever reads must be in the message's room. Without a room, an MCP call
 * goes to the caller's main room (an open cloud session keeps the tools it started with); the bridge always says it.
 */
import { EventEmitter } from 'node:events'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  CHAT_DEFAULT_ROOM,
  CHAT_EVERYONE,
  CHAT_MAX_WAIT_SECONDS,
  CHAT_OWNER,
  CHAT_READ_BUDGET,
  CHAT_ROOMS,
  type ChatChannel,
  type ChatRoom,
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
  room: ChatRoom
}

export interface ChatReadView {
  as: string
  room: ChatRoom
  /** `forYou`: addressed to the reader (or to «todos»). */
  messages: (ChatMessageView & { forYou: boolean })[]
  /** What is still new for the reader in the same scope after this read. */
  unreadLeft: number
  /**
   * What is new for the reader in its other rooms (only those with something): a session in two rooms reads one at
   * a time, and an open one cannot say `sala` (review of #88).
   */
  otherRooms: Partial<Record<ChatRoom, number>>
  /** The names in the room's list of participants. */
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
  /** Its rooms, the main one first. */
  rooms: ChatRoom[]
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
/**
 * How long a write waits for the lock: an import of the move (`chat-import`, D-030) holds it for a few seconds. Under
 * the transaction's 15 s, so past it the answer is a 503 with `Retry-After` (the bridges retry it), never Prisma's
 * P2028 as a 500 (review of #123).
 */
export const WRITE_LOCK_WAIT_MS = 10_000
const WRITE_TIMEOUT_MS = 15_000
const OWNER_KEY = chatKey(CHAT_OWNER)
/** The largest message id (`SERIAL`). */
const MAX_ID = 2_147_483_647

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

/** A participant's rooms, the main one first: Santi is in all of them; a row with none (or unknown ones) is in «tcg». */
export function roomsOf(row: Pick<SessionChatParticipant, 'channel' | 'rooms'>): ChatRoom[] {
  if (row.channel === 'owner') return [...CHAT_ROOMS]
  const rooms = row.rooms.filter((room): room is ChatRoom => (CHAT_ROOMS as readonly string[]).includes(room))
  return rooms.length > 0 ? rooms : [CHAT_DEFAULT_ROOM]
}

function inRoom(row: Pick<SessionChatParticipant, 'channel' | 'rooms'>, room: ChatRoom): boolean {
  return roomsOf(row).includes(room)
}

/**
 * Where a participant starts reading a room: after the last message when it joined that room later (`room_since`),
 * or when it was added to the list (`since_id`). What came before counts as read.
 */
export function sinceIn(row: Pick<SessionChatParticipant, 'sinceId' | 'roomSince'>, room: ChatRoom): number {
  const map = row.roomSince
  const joined =
    map && typeof map === 'object' && !Array.isArray(map) ? (map as Record<string, unknown>)[room] : undefined
  // Only an id that fits the column: anything else (a hand edit) reads from `since_id` instead of failing the read.
  return Number.isInteger(joined) && (joined as number) >= 0 && (joined as number) <= MAX_ID
    ? Math.max(row.sinceId, joined as number)
    : row.sinceId
}

/** `room_since` as an object, whatever was there (a hand edit could leave an array or null): what `||` adds to. */
const ROOM_SINCE = Prisma.sql`(CASE WHEN jsonb_typeof("room_since") = 'object' THEN "room_since" ELSE '{}'::jsonb END)`

/** Where a call without a room goes: the participant's main room. */
function mainRoom(row: Pick<SessionChatParticipant, 'channel' | 'rooms'>): ChatRoom {
  return roomsOf(row)[0] ?? CHAT_DEFAULT_ROOM
}

function roomOf(row: Pick<SessionChatMessage, 'room'>): ChatRoom {
  return (CHAT_ROOMS as readonly string[]).includes(row.room) ? (row.room as ChatRoom) : CHAT_DEFAULT_ROOM
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
  return {
    id: row.id,
    at: row.at,
    from: row.fromName,
    to: row.toNames,
    topic: row.topic,
    text: row.body,
    via: row.via,
    room: roomOf(row),
  }
}

function participantView(row: SessionChatParticipant): ChatParticipantView {
  return { name: row.name, channel: row.channel, rooms: roomsOf(row), createdAt: row.createdAt }
}

/** Messages addressed to `key` or to everyone. */
function forKey(key: string): Prisma.SessionChatMessageWhereInput {
  return { OR: [{ toKeys: { has: key } }, { toKeys: { has: CHAT_EVERYONE } }] }
}

@Injectable()
export class ChatService {
  /** Wakes the readers that are waiting (one process: the app runs on a single machine). */
  private readonly events = new EventEmitter()

  /** How long a write waits for the import's lock (`WRITE_LOCK_WAIT_MS`; the tests shorten it). */
  writeLockWaitMs = WRITE_LOCK_WAIT_MS

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
   * copied. `room`: the bridge always says it; without it, the sender's main room.
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
    room?: ChatRoom | undefined
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
    const sender = this.member(list, input.from, input.room)
    if (!WRITES_AS[input.caller].includes(sender.channel)) {
      throw new ForbiddenException({
        code: 'wrong_channel',
        message: `«${sender.name}» ${CHANNEL_RULE[sender.channel]}.`,
      })
    }
    const room = input.room ?? mainRoom(sender)
    this.mustBeIn(sender, room)
    const named = parseRecipients(input.to)
    if (named.length === 0) throw new BadRequestException('Indicá a quién va el mensaje (o «todos»).')
    // «todos» is everyone in the room; a named recipient has to be in it.
    const to = named[0] === CHAT_EVERYONE ? [CHAT_EVERYONE] : named.map((name) => this.inRoomMember(list, name, room))
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
      room,
    }
    let row: SessionChatMessage
    try {
      row = await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${this.writeLockWaitMs}ms`}, true)`
          // One insert at a time: the id comes after the lock and the commit releases it, so ids commit in order.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${WRITE_LOCK}::bigint)`
          return tx.sessionChatMessage.create({ data })
        },
        { timeout: WRITE_TIMEOUT_MS },
      )
    } catch (error) {
      if (isLockTimeout(error)) {
        throw new ServiceUnavailableException({
          code: 'chat_busy',
          message: 'El chat está ocupado con una importación: probá de nuevo en unos segundos.',
        })
      }
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
   * `all`: the history, nothing marked. Only one room: `room`, or the reader's main one.
   */
  async read(input: {
    as: string
    scope?: 'all' | 'mine' | undefined
    waitSeconds?: number | undefined
    all?: boolean | undefined
    limit?: number | undefined
    signal?: AbortSignal | undefined
    room?: ChatRoom | undefined
  }): Promise<ChatReadView> {
    const list = await this.list()
    const reader = this.member(list, input.as, input.room)
    if (reader.channel !== 'connector') {
      throw new ForbiddenException({
        code: 'wrong_channel',
        message: `«${reader.name}» no lee el chat por acá: usá el nombre de esta sesión, nunca el de otra.`,
      })
    }
    const room = input.room ?? mainRoom(reader)
    this.mustBeIn(reader, room)
    const key = reader.key
    const limit = input.limit ?? DEFAULT_LIMIT
    const mine = input.scope === 'mine'
    const inScope: Prisma.SessionChatMessageWhereInput = {
      AND: [{ room }, mine ? { OR: [forKey(key), { fromKey: key }] } : {}],
    }
    // A participant added later, or one that joined the room later, starts after the message that was the last one
    // then (review of #88: joining a room did not bring its whole history as new).
    const unseenIn = (where: ChatRoom): Prisma.SessionChatMessageWhereInput => ({
      AND: [
        { room: where },
        { id: { gt: sinceIn(reader, where) } },
        { NOT: { fromKey: key } },
        mine ? forKey(key) : {},
        { seen: { none: { participant: key } } },
      ],
    })
    const unseen = unseenIn(room)
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
      const next = wait > 0 ? this.nextFor(key, room, wait * 1000, input.signal, mine) : null
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
    const otherRooms: Partial<Record<ChatRoom, number>> = {}
    for (const other of roomsOf(reader).filter((item) => item !== room)) {
      const count = await this.prisma.sessionChatMessage.count({ where: unseenIn(other) })
      if (count > 0) otherRooms[other] = count
    }
    return {
      as: reader.name,
      room,
      messages: messages.map((row) => ({ ...toView(row), forYou: addressedTo(row, key) })),
      unreadLeft,
      otherRooms,
      participants: list.filter((participant) => inRoom(participant, room)).map((participant) => participant.name),
    }
  }

  /** The bridge's view of one room: every message after `after`, in id order, without touching anyone's reads. */
  async feed(input: {
    after?: number | undefined
    limit?: number | undefined
    room?: ChatRoom | undefined
  }): Promise<ChatFeedView> {
    const limit = input.limit ?? 100
    const rows = await this.prisma.sessionChatMessage.findMany({
      where: { room: input.room ?? CHAT_DEFAULT_ROOM, id: { gt: input.after ?? 0 } },
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

  /** The list, or with `room` only who is in that room. */
  async participants(room?: ChatRoom): Promise<ChatParticipantView[]> {
    return (await this.list()).filter((row) => room === undefined || inRoom(row, room)).map(participantView)
  }

  /**
   * Santi's list (Más → Tokens de API): adds a participant or changes its channel, its rooms (the main one first) or
   * how its name is written. The bridge adds new ones only, in `room`: a PC or cloud session, never one already in
   * the list with another channel; one already there with the same channel joins `room` (`created`).
   */
  async saveParticipant(
    input: { name: string; channel: ChatChannel; rooms?: readonly ChatRoom[] | undefined },
    by: 'owner' | 'relay',
    room: ChatRoom = CHAT_DEFAULT_ROOM,
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
        data: [{ key, name, channel: input.channel, sinceId, rooms: [room] }],
        skipDuplicates: true,
      })
      const row = await this.prisma.sessionChatParticipant.findUniqueOrThrow({ where: { key } })
      if (inserted.count === 0 && row.channel !== input.channel) {
        throw new ConflictException({
          code: 'participant_exists',
          message: `«${row.name}» ya está en la lista con otro canal: lo cambia Santi en la app.`,
        })
      }
      if (inserted.count > 0 || inRoom(row, room)) {
        return { participant: participantView(row), created: inserted.count > 0 }
      }
      // Already in the list with that channel, not in this room: it joins it, last (its main room stays), and reads it
      // from now on.
      const joined = await this.prisma.$executeRaw`
        UPDATE "session_chat_participants"
        SET "rooms" = array_append("rooms", ${room}),
          "room_since" = ${ROOM_SINCE} || jsonb_build_object(${room}::text, ${sinceId}::int)
        WHERE "key" = ${key} AND "channel" = ${input.channel}::"session_chat_channel" AND NOT (${room} = ANY("rooms"))`
      const now = await this.prisma.sessionChatParticipant.findUniqueOrThrow({ where: { key } })
      return { participant: participantView(now), created: joined > 0 }
    }
    const rooms = input.rooms ? [...new Set(input.rooms)] : null
    // One statement for one already in the list: the rooms it joins now (also one it left and comes back to) it reads
    // from now on, and a new order keeps where it was in each (SET sees the row as it was; review of #88).
    const changed = await this.prisma.$executeRaw`
      UPDATE "session_chat_participants" p
      SET "name" = ${name}, "channel" = ${input.channel}::"session_chat_channel",
        "rooms" = COALESCE(${rooms}::text[], p."rooms"),
        "room_since" = ${ROOM_SINCE} || COALESCE(
          (SELECT jsonb_object_agg(r, ${sinceId}::int) FROM unnest(COALESCE(${rooms}::text[], p."rooms")) AS r
           WHERE NOT (r = ANY(p."rooms"))),
          '{}'::jsonb)
      WHERE p."key" = ${key}`
    if (changed > 0) {
      const row = await this.prisma.sessionChatParticipant.findUniqueOrThrow({ where: { key } })
      return { participant: participantView(row), created: false }
    }
    // A new one: it starts after the last message in every room (`since_id`). Added at the same moment: an update.
    const current = await this.prisma.sessionChatParticipant.findUnique({ where: { key } })
    const row = await this.prisma.sessionChatParticipant.upsert({
      where: { key },
      create: { key, name, channel: input.channel, sinceId, rooms: rooms ?? [CHAT_DEFAULT_ROOM] },
      update: { name, channel: input.channel, ...(rooms ? { rooms } : {}) },
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
    input: { from: string; to: string | readonly string[]; topic: string; text: string; room?: ChatRoom | undefined },
  ): void {
    const keys = (names: readonly string[]) => [...names].map(chatKey).sort().join('\u0000')
    const same =
      (input.room === undefined || roomOf(copied) === input.room) &&
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
        ? { ...owner, name: CHAT_OWNER, channel: 'owner', rooms: [...CHAT_ROOMS] }
        : {
            key: OWNER_KEY,
            name: CHAT_OWNER,
            channel: 'owner',
            sinceId: 0,
            rooms: [...CHAT_ROOMS],
            roomSince: {},
            createdAt: new Date(0),
          },
      ...others,
    ]
  }

  /**
   * The list's entry for a name: exactly that name, only the case does not matter. Not there: the error names who is
   * in `room` (the default one without it), never the other rooms' participants.
   */
  private member(
    list: readonly SessionChatParticipant[],
    name: string,
    room: ChatRoom = CHAT_DEFAULT_ROOM,
  ): SessionChatParticipant {
    const key = chatKey(name)
    const found = list.find((participant) => participant.key === key)
    if (!found) {
      throw new BadRequestException({
        code: 'unknown_participant',
        message: `«${name.trim()}» no está en la lista de participantes del chat (en la sala «${room}»: ${this.namesIn(list, room)}). Una sesión nueva la suma Santi en Más → Tokens de API.`,
        details: { participants: list.filter((participant) => inRoom(participant, room)).map((row) => row.name) },
      })
    }
    return found
  }

  /** Whoever writes or reads has to be in the room. */
  private mustBeIn(participant: SessionChatParticipant, room: ChatRoom): void {
    if (inRoom(participant, room)) return
    // Not who is in that room: it is not this participant's.
    throw new ForbiddenException({
      code: 'not_in_room',
      message: `«${participant.name}» no está en la sala «${room}». Sus salas: ${roomsOf(participant)
        .map((name) => `«${name}»`)
        .join(', ')}; para otra, pasá «sala».`,
    })
  }

  /** A recipient: in the list, and in the room. */
  private inRoomMember(list: readonly SessionChatParticipant[], name: string, room: ChatRoom): string {
    const found = this.member(list, name, room)
    if (!inRoom(found, room)) {
      throw new BadRequestException({
        code: 'not_in_room',
        message: `«${found.name}» no está en la sala «${room}»: no le llega. En esa sala están: ${this.namesIn(list, room)}. Si es de otra sala tuya, pasá «sala».`,
        details: { participants: list.filter((row) => inRoom(row, room)).map((row) => row.name) },
      })
    }
    return found.name
  }

  private namesIn(list: readonly SessionChatParticipant[], room: ChatRoom): string {
    return list
      .filter((row) => inRoom(row, room))
      .map((row) => row.name)
      .join(', ')
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
    room: ChatRoom,
    ms: number,
    signal: AbortSignal | undefined,
    mine: boolean,
  ): { arrived: Promise<void>; cancel: () => void } {
    let done = () => {}
    const arrived = new Promise<void>((resolve) => {
      const onMessage = (row: SessionChatMessage) => {
        if (roomOf(row) === room && row.fromKey !== key && (!mine || addressedTo(row, key))) done()
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

/** Postgres' `lock_timeout` (55P03), wherever Prisma or the driver put its code. */
function isLockTimeout(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth++) {
    const { code, originalCode, meta, message, cause } = current as {
      code?: unknown
      originalCode?: unknown
      meta?: { code?: unknown; driverAdapterError?: unknown }
      message?: unknown
      cause?: unknown
    }
    if ([code, originalCode, meta?.code].includes('55P03')) return true
    if (typeof message === 'string' && /lock timeout/i.test(message)) return true
    current = cause ?? meta?.driverAdapterError
  }
  return false
}
