/**
 * Playing against a bot (PLAN §3.7, Fase 8): the owner starts a game in the PWA, the worker on the PC runs
 * `engine-cli play` and relays each decision; the owner answers from the phone. The game is fully determined by its
 * seed and the owner's choices, so it survives a worker restart: a new worker replays the choices and goes on. A game
 * runs only while the PC is on (like every simulation).
 */

import { randomInt } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { gunzipSync } from 'node:zlib'
import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common'
import {
  botLabel,
  type CoachReview,
  type CoachScores,
  type CoachSummary,
  coachContext,
  coachSummary,
  isBotCode,
  MAX_BASE_SEED,
  parseCoachScores,
  randomBaseSeed,
  reviewChoice,
  type SnapshotCard,
} from '@tcg/domain'
import { CatalogService } from '../catalog/catalog.service.js'
import { Prisma } from '../generated/prisma/client.js'
import { parseNumericId } from '../http/ids.js'
import { PresenceService } from '../notifications/presence.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { EngineStatusService, type SnapshotSource, SnapshotsService } from '../simulation/snapshots.service.js'

export const LIVE_LEASE_MS = 3 * 60 * 1000
const LONG_POLL_MS = 25_000
/** A game nobody touched for a week is given up (the engine process is released; D-019, decided 8/10/2026). */
const STALE_MS = 7 * 24 * 60 * 60 * 1000
const WORKER_ONLINE_MS = 2 * 60 * 1000
export const MAX_LIVE_REPLAY_BYTES = 8 * 1024 * 1024
/** Workers older than this do not pass `coach` to the engine nor its scores back (Fase 20). */
export const COACH_WORKER_VERSION = '0.2.2'

type GameRow = Prisma.LiveGameGetPayload<object>

export interface LiveDecision {
  ply: number
  turn: number
  state: Prisma.JsonValue
  actions: { i: number; text: string; action: Prisma.JsonValue }[]
  /** Modo entrenador: the engine's value of each option (never shown before the choice). */
  coach?: CoachScores | null
  /** The owner asked for the hint. */
  hinted?: boolean
}

/** The pending decision as the owner sees it: no scores, only the hint once asked for. */
export interface LiveDecisionView {
  ply: number
  turn: number
  state: Prisma.JsonValue
  actions: { i: number; text: string; action: Prisma.JsonValue }[]
  hintAvailable: boolean
  /** The coach's option, once the owner asked for it. */
  hint: number | null
}

export interface LiveGameView {
  id: number
  status: GameRow['status']
  bot: string
  botEs: string
  seed: string
  engineRev: string
  human: { snapshot: number; label: string; deckId: string | null }
  rival: { snapshot: number; label: string; deckId: string | null; listKey: string | null }
  decision: LiveDecisionView | null
  log: Prisma.JsonValue
  choices: number
  /** Modo entrenador (Fase 20). */
  coach: boolean
  coachReviews: CoachReview[]
  coachSummary: CoachSummary | null
  winner: 'you' | 'bot' | 'tie' | null
  turns: number | null
  finalState: Prisma.JsonValue | null
  replay: boolean
  /** Engine id («A1 001») → Spanish name; and the engine's English name, to translate its own texts. */
  names: Record<string, string>
  cards: Record<string, { id: string; name: string }>
  /** Fase 22: engine id → the catalog edition played (images and the card sheet). */
  cardIds: Record<string, string>
  /** Fase 22: both lists (the bot's list is known: it is a practice game). */
  decks: { human: { engineId: string; count: number }[]; rival: { engineId: string; count: number }[] }
  /** Fase 22: times the owner went back to an earlier decision. */
  undos: number
  workerOnline: boolean
  error: string | null
  createdAt: Date
  updatedAt: Date
  finishedAt: Date | null
}

export interface LiveGameSummaryView {
  id: number
  status: GameRow['status']
  coach: boolean
  botEs: string
  human: string
  rival: string
  winner: 'you' | 'bot' | 'tie' | null
  turns: number | null
  createdAt: Date
  finishedAt: Date | null
}

export interface ClaimedLiveGame {
  id: number
  deckHuman: string
  deckBot: string
  bot: string
  seed: string
  /** Choices already made: replay them before asking for more. */
  choices: number[]
  /** Modo entrenador: the engine scores every option (workers 0.2.2+). */
  coach: boolean
}

@Injectable()
export class LiveGamesService {
  private readonly events = new EventEmitter()
  /** How long a worker's long-poll waits (tests shorten it). */
  longPollMs = LONG_POLL_MS

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly snapshots: SnapshotsService,
    private readonly engine: EngineStatusService,
    @Optional() private readonly presence?: PresenceService,
  ) {
    this.events.setMaxListeners(100)
  }

  private wait(event: string): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, this.longPollMs)
      const events = this.events
      function done() {
        clearTimeout(timer)
        events.off(event, done)
        resolve()
      }
      this.events.once(event, done)
      timer.unref?.()
    })
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Owner
  // ---------------------------------------------------------------------------------------------------------------

  async create(input: {
    human: SnapshotSource
    rival: SnapshotSource
    bot?: string
    seed?: number
    coach?: boolean
  }): Promise<LiveGameView> {
    const bot = input.bot ?? 'e2'
    if (!isBotCode(bot)) throw new BadRequestException({ code: 'validation', message: `Bot «${bot}» desconocido.` })
    const human = await this.snapshots.save(input.human)
    const rival = await this.snapshots.save(input.rival)
    for (const [who, snapshot] of [
      ['Tu mazo', human],
      ['El mazo del bot', rival],
    ] as const) {
      if (!snapshot.simulable) {
        throw new BadRequestException({
          code: 'not_simulable',
          message: `${who} no se puede jugar: ${snapshot.problems.map((problem) => problem.message).join('; ')}.`,
        })
      }
    }
    const seed = input.seed ?? randomBaseSeed(() => randomInt(0, 2 ** 32 - 1) >>> 0)
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > MAX_BASE_SEED) {
      throw new BadRequestException({ code: 'validation', message: 'Semilla: un entero de 0 a 2^52.' })
    }
    const game = await this.prisma.liveGame.create({
      data: {
        humanSnapshotId: human.id,
        botSnapshotId: rival.id,
        humanLabel: human.label,
        rivalLabel: rival.label,
        bot,
        seed: BigInt(seed),
        engineRev: this.engine.engineRev(),
        choices: [],
        coach: input.coach ?? false,
      },
    })
    this.events.emit('queued')
    return this.view(game)
  }

  /** Recent games; games nobody touched in a week are given up first. */
  async list(limit = 30): Promise<LiveGameSummaryView[]> {
    await this.prisma.liveGame.updateMany({
      where: { status: { in: ['queued', 'running', 'waiting'] }, updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
      data: { status: 'abandoned', finishedAt: new Date(), error: 'Sin movimientos en una semana.' },
    })
    const games = await this.prisma.liveGame.findMany({ orderBy: { id: 'desc' }, take: limit })
    const ids = [...new Set(games.flatMap((game) => [game.humanSnapshotId, game.botSnapshotId]))]
    const labels = new Map(
      (await this.prisma.deckSnapshot.findMany({ where: { id: { in: ids } }, select: { id: true, label: true } })).map(
        (row) => [row.id, row.label],
      ),
    )
    return games.map((game) => ({
      id: game.id,
      status: game.status,
      coach: game.coach,
      botEs: botLabel(game.bot),
      human: game.humanLabel || labels.get(game.humanSnapshotId) || `#${game.humanSnapshotId}`,
      rival: game.rivalLabel || labels.get(game.botSnapshotId) || `#${game.botSnapshotId}`,
      winner: game.winner as LiveGameView['winner'],
      turns: game.turns,
      createdAt: game.createdAt,
      finishedAt: game.finishedAt,
    }))
  }

  private async requireGame(rawId: string | number): Promise<GameRow> {
    const id = typeof rawId === 'number' ? rawId : parseNumericId(rawId, 'Partida')
    const game = await this.prisma.liveGame.findUnique({ where: { id } })
    if (!game) throw new NotFoundException(`Partida ${rawId} no encontrada.`)
    return game
  }

  async get(rawId: string): Promise<LiveGameView> {
    const game = await this.requireGame(rawId)
    this.presence?.saw(`live:${game.id}`)
    return this.view(game)
  }

  private async view(game: GameRow): Promise<LiveGameView> {
    const [snapshots, worker] = await Promise.all([
      this.prisma.deckSnapshot.findMany({ where: { id: { in: [game.humanSnapshotId, game.botSnapshotId] } } }),
      this.prisma.workerNode.findFirst({ orderBy: { lastSeenAt: 'desc' }, select: { lastSeenAt: true } }),
    ])
    const human = snapshots.find((row) => row.id === game.humanSnapshotId)
    const rival = snapshots.find((row) => row.id === game.botSnapshotId)
    const index = this.catalog.requireIndex()
    const names: Record<string, string> = {}
    const cards: Record<string, { id: string; name: string }> = {}
    const cardIds: Record<string, string> = {}
    for (const snapshot of snapshots) {
      for (const card of snapshot.cards as unknown as SnapshotCard[]) {
        const played = index.cardById(card.playedAs)
        names[card.engineId] = played?.nameEs ?? card.engineId
        cards[card.engineId] = { id: card.engineId, name: played?.nameEn ?? card.engineId }
        if (played) cardIds[card.engineId] = played.id
      }
    }
    const list = (snapshot: (typeof snapshots)[number] | undefined) =>
      ((snapshot?.cards ?? []) as unknown as SnapshotCard[]).map((card) => ({
        engineId: card.engineId,
        count: card.count,
      }))
    return {
      id: game.id,
      status: game.status,
      bot: game.bot,
      botEs: botLabel(game.bot),
      seed: game.seed.toString(),
      engineRev: game.engineRev,
      human: {
        snapshot: game.humanSnapshotId,
        label: game.humanLabel || human?.label || `#${game.humanSnapshotId}`,
        deckId: human?.deckId == null ? null : String(human.deckId),
      },
      rival: {
        snapshot: game.botSnapshotId,
        label: game.rivalLabel || rival?.label || `#${game.botSnapshotId}`,
        deckId: rival?.deckId == null ? null : String(rival.deckId),
        listKey: rival?.sourceType === 'tournament_list' ? rival.sourceId : null,
      },
      decision: game.status === 'waiting' ? decisionView(game.decision as unknown as LiveDecision | null) : null,
      log: game.log,
      choices: game.choices.length,
      coach: game.coach,
      coachReviews: game.coachLog as unknown as CoachReview[],
      coachSummary: game.coach ? coachSummary(game.coachLog as unknown as CoachReview[]) : null,
      winner: game.winner as LiveGameView['winner'],
      turns: game.turns,
      finalState: game.finalState,
      replay: game.replayGz !== null,
      names,
      cards,
      cardIds,
      decks: { human: list(human), rival: list(rival) },
      undos: game.undos,
      workerOnline: worker ? Date.now() - worker.lastSeenAt.getTime() < WORKER_ONLINE_MS : false,
      error: game.error,
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
      finishedAt: game.finishedAt,
    }
  }

  /** The owner's answer to the pending decision. */
  async choose(rawId: string, input: { ply: number; i: number }): Promise<LiveGameView> {
    const game = await this.requireGame(rawId)
    const decision = game.decision as unknown as LiveDecision | null
    if (game.status !== 'waiting' || !decision) {
      throw new ConflictException({ code: 'not_your_turn', message: 'No hay ninguna decisión pendiente.' })
    }
    if (input.ply !== decision.ply || game.choices.length !== decision.ply - 1) {
      throw new ConflictException({ code: 'stale_decision', message: 'Esa decisión ya pasó: recargá la partida.' })
    }
    if (!Number.isInteger(input.i) || input.i < 0 || input.i >= decision.actions.length) {
      throw new BadRequestException({ code: 'validation', message: 'Esa opción no existe.' })
    }
    const coach = parseCoachScores(decision.coach)
    const reviews = game.coachLog as unknown as CoachReview[]
    const review = coach
      ? reviewChoice({
          ply: decision.ply,
          turn: decision.turn,
          coach,
          chosen: input.i,
          texts: decision.actions.map((action) => action.text),
          hinted: decision.hinted,
          actions: decision.actions.map((action) => action.action),
          ctx: coachContext(decision.state),
        })
      : null
    const updated = await this.prisma.liveGame.update({
      where: { id: game.id },
      data: {
        choices: { push: input.i },
        status: 'running',
        decision: Prisma.DbNull,
        ...(review ? { coachLog: [...reviews, review] as unknown as Prisma.InputJsonValue } : {}),
      },
    })
    this.events.emit(`choice:${game.id}`)
    return this.view(updated)
  }

  /** Modo entrenador: the coach's option for the pending decision (the review remembers it was asked for). */
  async hint(rawId: string, input: { ply: number }): Promise<LiveGameView> {
    const game = await this.requireGame(rawId)
    const decision = game.decision as unknown as LiveDecision | null
    if (game.status !== 'waiting' || !decision || decision.ply !== input.ply) {
      throw new ConflictException({ code: 'stale_decision', message: 'Esa decisión ya pasó: recargá la partida.' })
    }
    if (!parseCoachScores(decision.coach)) {
      throw new ConflictException({ code: 'no_coach', message: 'Esta partida no tiene el modo entrenador.' })
    }
    const updated = await this.prisma.liveGame.update({
      where: { id: game.id },
      data: { decision: { ...decision, hinted: true } as unknown as Prisma.InputJsonValue },
    })
    return this.view(updated)
  }

  /**
   * Fase 22: back to the previous decision. The game is its seed and the owner's choices, so dropping the last choice
   * and queueing it again makes the worker rebuild it right up to that decision (the coach's reviews from there on go
   * too). Only while it is the owner's turn or once it ended: while the PC is moving, wait.
   */
  async undo(rawId: string): Promise<LiveGameView> {
    const game = await this.requireGame(rawId)
    if (game.status !== 'waiting' && game.status !== 'done') {
      throw new ConflictException({
        code: game.status === 'queued' || game.status === 'running' ? 'busy' : 'finished',
        message:
          game.status === 'queued' || game.status === 'running'
            ? 'La PC está moviendo: esperá tu turno para deshacer.'
            : 'Esta partida ya no se puede deshacer.',
      })
    }
    if (game.choices.length === 0) {
      throw new ConflictException({ code: 'nothing_to_undo', message: 'Todavía no elegiste nada.' })
    }
    const keep = game.choices.length - 1
    const reviews = (game.coachLog as unknown as CoachReview[]).filter((review) => review.ply <= keep)
    const updated = await this.prisma.liveGame.update({
      where: { id: game.id },
      data: {
        status: 'queued',
        choices: { set: game.choices.slice(0, keep) },
        coachLog: reviews as unknown as Prisma.InputJsonValue,
        undos: { increment: 1 },
        decision: Prisma.DbNull,
        workerId: null,
        leaseUntil: null,
        winner: null,
        turns: null,
        finalState: Prisma.DbNull,
        replayGz: null,
        finishedAt: null,
      },
    })
    // The worker waiting on this game hears «restart»; any worker may take it again.
    this.events.emit(`choice:${game.id}`)
    this.events.emit('queued')
    return this.view(updated)
  }

  /** Fase 22: the same decks and bot again; with `sameSeed`, the very same shuffle (another line from the start). */
  async rematch(rawId: string, input: { sameSeed?: boolean | undefined }): Promise<LiveGameView> {
    const game = await this.requireGame(rawId)
    const seed = input.sameSeed ? game.seed : BigInt(randomBaseSeed(() => randomInt(0, 2 ** 32 - 1) >>> 0))
    const created = await this.prisma.liveGame.create({
      data: {
        humanSnapshotId: game.humanSnapshotId,
        botSnapshotId: game.botSnapshotId,
        humanLabel: game.humanLabel,
        rivalLabel: game.rivalLabel,
        bot: game.bot,
        seed,
        engineRev: this.engine.engineRev(),
        choices: [],
        coach: game.coach,
      },
    })
    this.events.emit('queued')
    return this.view(created)
  }

  async abandon(rawId: string): Promise<LiveGameView> {
    const game = await this.requireGame(rawId)
    if (game.status === 'done' || game.status === 'abandoned' || game.status === 'failed') return this.view(game)
    const updated = await this.prisma.liveGame.update({
      where: { id: game.id },
      data: { status: 'abandoned', finishedAt: new Date(), decision: Prisma.DbNull, leaseUntil: null },
    })
    this.events.emit(`choice:${game.id}`)
    return this.view(updated)
  }

  async replayRaw(rawId: string): Promise<unknown> {
    const game = await this.requireGame(rawId)
    if (!game.replayGz) throw new NotFoundException('La partida no tiene repetición (todavía no terminó).')
    return JSON.parse(gunzipSync(game.replayGz).toString('utf8')) as unknown
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Worker
  // ---------------------------------------------------------------------------------------------------------------

  private async tryClaim(workerId: string, engineRev: string, version: string): Promise<ClaimedLiveGame | null> {
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      UPDATE live_games SET status = CASE WHEN status = 'queued' THEN 'running'::"LiveGameStatus" ELSE status END,
        worker_id = ${workerId}, lease_until = now() + interval '3 minutes'
      WHERE id = (
        SELECT id FROM live_games
        WHERE engine_rev = ${engineRev}
          AND (coach = false OR ${version} >= ${COACH_WORKER_VERSION})
          AND (status = 'queued' OR (status IN ('running', 'waiting') AND (lease_until IS NULL OR lease_until < now())))
        ORDER BY id
        FOR UPDATE SKIP LOCKED
        LIMIT 1)
      RETURNING id`
    const id = rows[0]?.id
    if (id === undefined) return null
    const game = await this.requireGame(id)
    const snapshots = await this.prisma.deckSnapshot.findMany({
      where: { id: { in: [game.humanSnapshotId, game.botSnapshotId] } },
      select: { id: true, deckgymText: true },
    })
    const text = (snapshotId: number) => snapshots.find((row) => row.id === snapshotId)?.deckgymText ?? ''
    return {
      id: game.id,
      deckHuman: text(game.humanSnapshotId),
      deckBot: text(game.botSnapshotId),
      bot: game.bot,
      seed: game.seed.toString(),
      choices: game.choices,
      coach: game.coach,
    }
  }

  /** A game for this worker (a new one, or one whose worker went away), waiting up to 25 s. */
  async claim(input: {
    workerId: string
    engineRev: string
    version?: string | undefined
  }): Promise<{ game: ClaimedLiveGame | null }> {
    const version = input.version ?? '0'
    const now = await this.tryClaim(input.workerId, input.engineRev, version)
    if (now) return { game: now }
    await this.wait('queued')
    return { game: await this.tryClaim(input.workerId, input.engineRev, version) }
  }

  /** Fase 22: the game went back to the queue (undo) while this worker had it: it must stop and claim again. */
  private async takenBack(id: number, workerId: string): Promise<{ choice: null; status: 'restart' } | null> {
    const game = await this.requireGame(id)
    return game.status === 'queued' && game.workerId !== workerId ? { choice: null, status: 'restart' } : null
  }

  private async requireLease(id: number, workerId: string): Promise<GameRow> {
    const game = await this.requireGame(id)
    if (game.workerId !== workerId) {
      throw new ConflictException({ code: 'not_leased', message: 'La partida la tiene otro worker.' })
    }
    return game
  }

  /**
   * The engine asks the owner. Returns the choice right away when the owner already made it (a resumed game, or an
   * answer given while the PC was off); otherwise the worker long-polls `choice`.
   */
  async decision(
    id: number,
    input: { workerId: string } & LiveDecision & { log: Prisma.InputJsonValue },
  ): Promise<{ choice: number | null; status: GameRow['status'] | 'restart' }> {
    const taken = await this.takenBack(id, input.workerId)
    if (taken) return taken
    const game = await this.requireLease(id, input.workerId)
    if (game.status === 'abandoned' || game.status === 'done' || game.status === 'failed') {
      return { choice: null, status: game.status }
    }
    const made = game.choices[input.ply - 1]
    if (made !== undefined) return { choice: made, status: game.status }
    const decision: LiveDecision = {
      ply: input.ply,
      turn: input.turn,
      state: input.state,
      actions: input.actions,
      coach: parseCoachScores(input.coach),
    }
    await this.prisma.liveGame.update({
      where: { id },
      data: {
        status: 'waiting',
        decision: decision as unknown as Prisma.InputJsonValue,
        log: input.log,
        leaseUntil: new Date(Date.now() + LIVE_LEASE_MS),
      },
    })
    return { choice: null, status: 'waiting' }
  }

  /** The owner's choice for decision `ply`, waiting up to 25 s; each call renews the lease. */
  async choice(
    id: number,
    input: { workerId: string; ply: number },
  ): Promise<{ choice: number | null; status: string }> {
    const read = async () => {
      const taken = await this.takenBack(id, input.workerId)
      if (taken) return taken
      const game = await this.requireLease(id, input.workerId)
      await this.prisma.liveGame.update({ where: { id }, data: { leaseUntil: new Date(Date.now() + LIVE_LEASE_MS) } })
      await this.prisma.workerNode.updateMany({ where: { id: input.workerId }, data: { lastSeenAt: new Date() } })
      return { choice: game.choices[input.ply - 1] ?? null, status: game.status }
    }
    const first = await read()
    if (first.choice !== null || !['running', 'waiting'].includes(first.status)) return first
    await this.wait(`choice:${id}`)
    return read()
  }

  async end(
    id: number,
    input: {
      workerId: string
      winner: 'you' | 'bot' | 'tie'
      turns: number
      state: Prisma.InputJsonValue
      log: Prisma.InputJsonValue
    },
  ): Promise<{ ok: true }> {
    await this.requireLease(id, input.workerId)
    await this.prisma.liveGame.update({
      where: { id },
      data: {
        status: 'done',
        winner: input.winner,
        turns: input.turns,
        finalState: input.state,
        log: input.log,
        decision: Prisma.DbNull,
        leaseUntil: null,
        finishedAt: new Date(),
      },
    })
    return { ok: true }
  }

  async failure(id: number, input: { workerId: string; error: string }): Promise<{ ok: true }> {
    await this.requireLease(id, input.workerId)
    await this.prisma.liveGame.update({
      where: { id },
      data: { status: 'failed', error: input.error.slice(0, 2000), leaseUntil: null, finishedAt: new Date() },
    })
    return { ok: true }
  }

  async saveReplay(id: number, workerId: string, body: Buffer): Promise<{ ok: true }> {
    await this.requireLease(id, workerId)
    if (body.length > MAX_LIVE_REPLAY_BYTES) {
      throw new BadRequestException({ code: 'too_large', message: 'La repetición supera 8 MB comprimida.' })
    }
    try {
      JSON.parse(gunzipSync(body).toString('utf8'))
    } catch {
      throw new BadRequestException({ code: 'invalid_replay', message: 'La repetición no es un JSON comprimido.' })
    }
    await this.prisma.liveGame.update({ where: { id }, data: { replayGz: new Uint8Array(body) } })
    return { ok: true }
  }
}

function decisionView(decision: LiveDecision | null): LiveDecisionView | null {
  if (!decision) return null
  const coach = parseCoachScores(decision.coach)
  return {
    ply: decision.ply,
    turn: decision.turn,
    state: decision.state,
    actions: decision.actions,
    hintAvailable: coach !== null,
    hint: coach && decision.hinted ? coach.best : null,
  }
}
