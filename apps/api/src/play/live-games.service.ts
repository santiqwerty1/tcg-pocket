/**
 * Playing against a bot (PLAN §3.7, Fase 8): the owner starts a game in the PWA, the worker on the PC runs
 * `engine-cli play` and relays each decision; the owner answers from the phone. The game is fully determined by its
 * seed and the owner's choices, so it survives a worker restart: a new worker replays the choices and goes on. A game
 * runs only while the PC is on (like every simulation).
 *
 * T-015: a game can also run in the owner's browser («browser»): the game's open page plays the engine compiled to
 * WebAssembly and sends each decision here, like a worker but with the session instead of a lease. The same seed is not
 * the same game there and on a PC (R-003), so such a game never goes to a worker, nor a worker's game to a browser.
 */

import { randomInt } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common'
import {
  botLabel,
  type CoachReview,
  type CoachScores,
  type CoachSummary,
  canPlayFairBots,
  coachContext,
  coachSummary,
  FAIR_BOT_CODES,
  isBotCode,
  MAX_BASE_SEED,
  parseCoachScores,
  randomBaseSeed,
  reviewChoice,
  type SnapshotCard,
} from '@tcg/domain'
import { CatalogService } from '../catalog/catalog.service.js'
import { Prisma } from '../generated/prisma/client.js'
import { gunzipJson } from '../http/gunzip.js'
import { parseNumericId } from '../http/ids.js'
import { PresenceService } from '../notifications/presence.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { EngineStatusService, type SnapshotSource, SnapshotsService } from '../simulation/snapshots.service.js'
import { versionAtLeast } from '../simulation/worker-version.js'

export const LIVE_LEASE_MS = 3 * 60 * 1000
const LONG_POLL_MS = 25_000
/** A game nobody touched for a week is given up (the engine process is released; D-019, decided 8/10/2026). */
const STALE_MS = 7 * 24 * 60 * 60 * 1000
const WORKER_ONLINE_MS = 2 * 60 * 1000
export const MAX_LIVE_REPLAY_BYTES = 8 * 1024 * 1024
/** Workers older than this do not pass `coach` to the engine nor its scores back (Fase 20). */
export const COACH_WORKER_VERSION = '0.2.2'

type GameRow = Prisma.LiveGameGetPayload<object>
export type LiveGameRunner = GameRow['runner']
/** States in which the engine still has to move or the owner to choose. */
const PLAYING: GameRow['status'][] = ['running', 'waiting']

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
  /** T-015: «worker» (a PC or the phone) or «browser» (the game's open page). */
  runner: LiveGameRunner
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
  runner: LiveGameRunner
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

/** T-015: what the engine of the page needs to run a «browser» game, and how the game stands. */
export interface BrowserLiveGame extends ClaimedLiveGame {
  status: GameRow['status']
  engineRev: string
  /** A finished game whose replay did not arrive: the page plays it again to the end to send it. */
  replayMissing: boolean
}

/** A page's answer from the server: the owner's choice, or why there is none («restart»: the choices changed). */
export interface BrowserStep {
  choice: number | null
  status: GameRow['status'] | 'restart'
}

/** `made` starts with `prefix`. */
function startsWith(made: number[], prefix: number[]): boolean {
  return prefix.length <= made.length && prefix.every((choice, i) => made[i] === choice)
}

function sameChoices(a: number[], b: number[]): boolean {
  return a.length === b.length && startsWith(a, b)
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

  /** Fase 33: the game changed (the owner's page gets it through `watch`, on every device). */
  private changed(id: number): void {
    this.events.emit(`game:${id}`)
  }

  /** Fase 33: calls `listener` whenever the game changes; returns the unsubscribe. */
  watch(id: number, listener: () => void): () => void {
    this.events.on(`game:${id}`, listener)
    return () => this.events.off(`game:${id}`, listener)
  }

  /** Fase 33: an open live page keeps the owner «looking» (no «te toca» push while it is open). */
  stillWatching(id: number): void {
    this.presence?.saw(`live:${id}`)
  }

  private wait(event: string, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, this.longPollMs)
      const events = this.events
      function done() {
        clearTimeout(timer)
        events.off(event, done)
        signal?.removeEventListener('abort', done)
        resolve()
      }
      this.events.once(event, done)
      signal?.addEventListener('abort', done, { once: true })
      if (signal?.aborted) done()
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
    /** T-015: «browser» to play it with this device's engine, which must be the server's (`engineRev`). */
    runner?: LiveGameRunner
    engineRev?: string
  }): Promise<LiveGameView> {
    const bot = input.bot ?? 'e2'
    if (!isBotCode(bot)) throw new BadRequestException({ code: 'validation', message: `Bot «${bot}» desconocido.` })
    const runner = input.runner ?? 'worker'
    if (runner === 'browser') this.requireBrowserEngine(input.engineRev)
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
        runner,
        // A browser game never waits for a worker: its page starts it as soon as it opens.
        status: runner === 'browser' ? 'running' : 'queued',
        choices: [],
        coach: input.coach ?? false,
      },
    })
    if (runner === 'worker') this.events.emit('queued')
    return this.view(game)
  }

  /** T-015: the engine of the page is the server's (the same deckgym revision as the workers'). */
  private requireBrowserEngine(engineRev: string | undefined): void {
    const current = this.engine.engineRev()
    if (engineRev === current) return
    throw new ConflictException({
      code: 'engine_mismatch',
      message: engineRev
        ? `El motor de este dispositivo (${engineRev.slice(0, 7)}) no es el del servidor (${current.slice(0, 7)}): recargá la app.`
        : 'Falta la versión del motor de este dispositivo.',
    })
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
      runner: game.runner,
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

  /** Fase 29: the game for Claude's review — without counting as the owner looking at it (notifications). */
  async peek(rawId: string): Promise<LiveGameView> {
    return this.view(await this.requireGame(rawId))
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
      runner: game.runner,
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
    this.changed(game.id)
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
    this.changed(game.id)
    return this.view(updated)
  }

  /**
   * Fase 22: back to the previous decision. The game is its seed and the owner's choices, so dropping the last choice
   * and queueing it again makes the worker rebuild it right up to that decision (the coach's reviews from there on go
   * too). Only while it is the owner's turn or once it ended: while the PC is moving, wait.
   */
  async undo(rawId: string): Promise<LiveGameView> {
    const game = await this.requireGame(rawId)
    const browser = game.runner === 'browser'
    if (game.status !== 'waiting' && game.status !== 'done') {
      throw new ConflictException({
        code: game.status === 'queued' || game.status === 'running' ? 'busy' : 'finished',
        message:
          game.status === 'queued' || game.status === 'running'
            ? browser
              ? 'El bot está pensando: esperá tu turno para deshacer.'
              : 'La PC está moviendo: esperá tu turno para deshacer.'
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
        // T-015: a browser game is rebuilt by its open page, never by a worker.
        status: browser ? 'running' : 'queued',
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
    // The worker (or the page) waiting on this game hears «restart»; any worker may take it again.
    this.events.emit(`choice:${game.id}`)
    if (!browser) this.events.emit('queued')
    this.changed(game.id)
    return this.view(updated)
  }

  /** Fase 22: the same decks and bot again; with `sameSeed`, the very same shuffle (another line from the start). */
  async rematch(
    rawId: string,
    input: { sameSeed?: boolean | undefined; engineRev?: string | undefined },
  ): Promise<LiveGameView> {
    const game = await this.requireGame(rawId)
    // T-015: a browser game's rematch is played in the browser too, with the engine the page has now.
    if (game.runner === 'browser') this.requireBrowserEngine(input.engineRev)
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
        runner: game.runner,
        status: game.runner === 'browser' ? 'running' : 'queued',
        choices: [],
        coach: game.coach,
      },
    })
    if (game.runner === 'worker') this.events.emit('queued')
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
    this.changed(game.id)
    return this.view(updated)
  }

  async replayRaw(rawId: string): Promise<unknown> {
    const game = await this.requireGame(rawId)
    if (!game.replayGz) throw new NotFoundException('La partida no tiene repetición (todavía no terminó).')
    return gunzipJson(game.replayGz)
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The owner's browser (T-015)
  //
  // Every open page of a «browser» game runs the same engine with the same seed and the same choices, so they all reach
  // the same decision: no lease is needed, the first page to send it sets it and the others change nothing. Each call
  // brings the choices the page played (`choices`): a page behind the owner gets the choice already made, and a page
  // whose choices are not the game's any more (an undo from another page) is told to rebuild («restart»).
  // ---------------------------------------------------------------------------------------------------------------

  private async requireBrowserGame(rawId: string | number): Promise<GameRow> {
    const game = await this.requireGame(rawId)
    if (game.runner !== 'browser') {
      throw new ConflictException({ code: 'not_browser', message: 'Esta partida la juega un worker, no el navegador.' })
    }
    return game
  }

  /** The decks, the seed and the owner's choices so far, for the engine of a page with the same engine revision. */
  async browserJob(rawId: string, engineRev: string): Promise<BrowserLiveGame> {
    const game = await this.requireBrowserGame(rawId)
    if (engineRev !== game.engineRev) {
      throw new ConflictException({
        code: 'engine_mismatch',
        message:
          game.engineRev === this.engine.engineRev()
            ? `Este dispositivo tiene otro motor (${engineRev.slice(0, 7)}): recargá la app para seguir la partida.`
            : `La partida empezó con un motor que la app ya no tiene (${game.engineRev.slice(0, 7)}): no se puede seguir.`,
      })
    }
    const snapshots = await this.prisma.deckSnapshot.findMany({
      where: { id: { in: [game.humanSnapshotId, game.botSnapshotId] } },
      select: { id: true, deckgymText: true },
    })
    const text = (snapshotId: number) => snapshots.find((row) => row.id === snapshotId)?.deckgymText ?? ''
    this.presence?.saw(`live:${game.id}`)
    return {
      id: game.id,
      deckHuman: text(game.humanSnapshotId),
      deckBot: text(game.botSnapshotId),
      bot: game.bot,
      seed: game.seed.toString(),
      choices: game.choices,
      coach: game.coach,
      status: game.status,
      engineRev: game.engineRev,
      replayMissing: game.status === 'done' && game.replayGz === null,
    }
  }

  /** The page's engine asks the owner at `ply`, after `choices` (`ply - 1` of them). */
  async browserDecision(
    rawId: string,
    input: { choices: number[] } & LiveDecision & { log: Prisma.InputJsonValue },
  ): Promise<BrowserStep> {
    if (input.choices.length !== input.ply - 1) {
      throw new BadRequestException({ code: 'validation', message: 'La decisión no corresponde a esas elecciones.' })
    }
    const game = await this.requireBrowserGame(rawId)
    if (!PLAYING.includes(game.status)) return { choice: null, status: game.status }
    if (!startsWith(game.choices, input.choices)) return { choice: null, status: 'restart' }
    const made = game.choices[input.ply - 1]
    if (made !== undefined) return { choice: made, status: game.status }
    const pending = game.decision as unknown as LiveDecision | null
    if (game.status === 'waiting' && pending?.ply === input.ply) return { choice: null, status: 'waiting' }
    const decision: LiveDecision = {
      ply: input.ply,
      turn: input.turn,
      state: input.state,
      actions: input.actions,
      coach: parseCoachScores(input.coach),
    }
    // Only while the game is still being played with these choices (not abandoned meanwhile, nor undone).
    const { count } = await this.prisma.liveGame.updateMany({
      where: { id: game.id, status: { in: PLAYING }, choices: { equals: game.choices } },
      data: { status: 'waiting', decision: decision as unknown as Prisma.InputJsonValue, log: input.log },
    })
    if (count === 0) return this.browserStepOf(game.id, input.choices, input.ply)
    this.changed(game.id)
    return { choice: null, status: 'waiting' }
  }

  private async browserStepOf(id: number, choices: number[], ply: number): Promise<BrowserStep> {
    const game = await this.requireBrowserGame(id)
    if (!startsWith(game.choices, choices)) return { choice: null, status: 'restart' }
    return { choice: game.choices[ply - 1] ?? null, status: game.status }
  }

  /** The owner's choice at `ply`, waiting up to 25 s (the page asks again until it comes). */
  async browserChoice(
    rawId: string,
    input: { choices: number[]; ply: number },
    signal?: AbortSignal,
  ): Promise<BrowserStep> {
    const id = (await this.requireBrowserGame(rawId)).id
    const first = await this.browserStepOf(id, input.choices, input.ply)
    if (first.choice !== null || !PLAYING.includes(first.status as GameRow['status'])) return first
    await this.wait(`choice:${id}`, signal)
    if (signal?.aborted) return first
    return this.browserStepOf(id, input.choices, input.ply)
  }

  /** The game ended on the page after `choices` (all the owner's). */
  async browserEnd(
    rawId: string,
    input: {
      choices: number[]
      winner: 'you' | 'bot' | 'tie'
      turns: number
      state: Prisma.InputJsonValue
      log: Prisma.InputJsonValue
    },
  ): Promise<{ ok: true; status: GameRow['status'] }> {
    const game = await this.requireBrowserGame(rawId)
    if (!sameChoices(game.choices, input.choices)) {
      throw new ConflictException({ code: 'stale_decision', message: 'La partida cambió: recargala.' })
    }
    if (!PLAYING.includes(game.status)) return { ok: true, status: game.status }
    const { count } = await this.prisma.liveGame.updateMany({
      where: { id: game.id, status: { in: PLAYING }, choices: { equals: game.choices } },
      data: {
        status: 'done',
        winner: input.winner,
        turns: input.turns,
        finalState: input.state,
        log: input.log,
        decision: Prisma.DbNull,
        finishedAt: new Date(),
      },
    })
    if (count > 0) this.changed(game.id)
    return { ok: true, status: count > 0 ? 'done' : (await this.requireGame(game.id)).status }
  }

  /** The engine of the page failed (a card it cannot play, a choice it rejects): the game fails as with a worker. */
  async browserFailure(rawId: string, input: { choices: number[]; error: string }): Promise<{ ok: true }> {
    const game = await this.requireBrowserGame(rawId)
    if (!PLAYING.includes(game.status) || !sameChoices(game.choices, input.choices)) return { ok: true }
    const { count } = await this.prisma.liveGame.updateMany({
      where: { id: game.id, status: { in: PLAYING }, choices: { equals: game.choices } },
      data: { status: 'failed', error: input.error.slice(0, 2000), finishedAt: new Date() },
    })
    if (count > 0) this.changed(game.id)
    return { ok: true }
  }

  /** The replay of the game the page finished after `choices`; the first one to arrive stays. */
  async browserReplay(rawId: string, choices: number[], body: Buffer): Promise<{ ok: true }> {
    const game = await this.requireBrowserGame(rawId)
    if (game.status !== 'done' || !sameChoices(game.choices, choices)) {
      throw new ConflictException({ code: 'stale_decision', message: 'Esa repetición ya no es de esta partida.' })
    }
    if (game.replayGz !== null) return { ok: true }
    this.checkReplay(body)
    const { count } = await this.prisma.liveGame.updateMany({
      where: { id: game.id, status: 'done', replayGz: null, choices: { equals: game.choices } },
      data: { replayGz: new Uint8Array(body) },
    })
    if (count > 0) this.changed(game.id)
    return { ok: true }
  }

  private checkReplay(body: Buffer): void {
    if (body.length > MAX_LIVE_REPLAY_BYTES) {
      throw new BadRequestException({ code: 'too_large', message: 'La repetición supera 8 MB comprimida.' })
    }
    try {
      gunzipJson(body)
    } catch {
      throw new BadRequestException({ code: 'invalid_replay', message: 'La repetición no es un JSON comprimido.' })
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Worker
  // ---------------------------------------------------------------------------------------------------------------

  private async tryClaim(
    workerId: string,
    engineRev: string,
    version: string,
    fairBots: boolean,
  ): Promise<ClaimedLiveGame | null> {
    // H-002: compared as numbers here, not as text in SQL.
    const coach = versionAtLeast(version, COACH_WORKER_VERSION)
    // H-018: a game against an f bot needs an engine that lists «fairBots».
    const fairBotCodes = [...FAIR_BOT_CODES]
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      UPDATE live_games SET status = CASE WHEN status = 'queued' THEN 'running'::"LiveGameStatus" ELSE status END,
        worker_id = ${workerId}, lease_until = now() + interval '3 minutes'
      WHERE id = (
        SELECT id FROM live_games
        WHERE engine_rev = ${engineRev}
          AND runner = 'worker'
          AND (coach = false OR ${coach}::boolean)
          AND (bot <> ALL(${fairBotCodes}::text[]) OR ${fairBots}::boolean)
          AND (status = 'queued' OR (status IN ('running', 'waiting') AND (lease_until IS NULL OR lease_until < now())))
        ORDER BY id
        FOR UPDATE SKIP LOCKED
        LIMIT 1)
      RETURNING id`
    const id = rows[0]?.id
    if (id === undefined) return null
    this.changed(id)
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
  async claim(
    input: {
      workerId: string
      engineRev: string
      version?: string | undefined
      engineFeatures?: string[] | undefined
    },
    signal?: AbortSignal,
  ): Promise<{ game: ClaimedLiveGame | null }> {
    if (signal?.aborted) return { game: null }
    const version = input.version ?? '0'
    const fairBots = canPlayFairBots(input)
    const take = async () => {
      const game = await this.tryClaim(input.workerId, input.engineRev, version, fairBots)
      // The socket may close during UPDATE RETURNING or the reads that build the answer.
      if (signal?.aborted) {
        if (game) await this.releaseLease(game.id, input.workerId)
        return null
      }
      return game
    }
    const now = await take()
    if (now) return { game: now }
    await this.wait('queued', signal)
    // A worker that disconnected while waiting must not take a game from the next worker.
    if (signal?.aborted) return { game: null }
    return { game: await take() }
  }

  private async releaseLease(id: number, workerId: string): Promise<void> {
    // Keep updated_at (last move) and never release a lease taken over by another worker.
    await this.prisma.$executeRaw`UPDATE live_games SET lease_until = NULL WHERE id = ${id} AND worker_id = ${workerId}`
    this.events.emit('queued')
    this.changed(id)
  }

  /** Graceful shutdown keeps the owner's choices, and wakes both claiming workers and open game pages. */
  async releaseWorker(workerId: string): Promise<number> {
    // RETURNING reports only rows still owned by this worker; keep updated_at (the owner's last move).
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      UPDATE live_games SET status = 'queued', worker_id = NULL, lease_until = NULL
      WHERE worker_id = ${workerId} AND status IN ('running', 'waiting')
      RETURNING id`
    if (rows.length) this.events.emit('queued')
    for (const row of rows) {
      this.events.emit(`choice:${row.id}`)
      this.changed(row.id)
    }
    return rows.length
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
    this.changed(id)
    return { choice: null, status: 'waiting' }
  }

  /** The owner's choice for decision `ply`, waiting up to 25 s; each call renews the lease. */
  async choice(
    id: number,
    input: { workerId: string; ply: number },
    signal?: AbortSignal,
  ): Promise<{ choice: number | null; status: string }> {
    const cancelled = async () => {
      await this.releaseLease(id, input.workerId)
      return { choice: null, status: 'restart' }
    }
    const read = async () => {
      if (signal?.aborted) return cancelled()
      const taken = await this.takenBack(id, input.workerId)
      if (taken) return taken
      const game = await this.requireLease(id, input.workerId)
      if (signal?.aborted) return cancelled()
      // H-013: renewing the lease is not a move, so it must not touch `updated_at` (the week without moves that
      // gives the game up is measured on it). Raw SQL: Prisma would stamp @updatedAt.
      await this.prisma.$executeRaw`UPDATE live_games SET lease_until = ${new Date(Date.now() + LIVE_LEASE_MS)}
          WHERE id = ${id} AND worker_id = ${input.workerId}`
      await this.prisma.workerNode.updateMany({ where: { id: input.workerId }, data: { lastSeenAt: new Date() } })
      if (signal?.aborted) return cancelled()
      return { choice: game.choices[input.ply - 1] ?? null, status: game.status }
    }
    const first = await read()
    if (first.choice !== null || !['running', 'waiting'].includes(first.status)) return first
    await this.wait(`choice:${id}`, signal)
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
    this.changed(id)
    return { ok: true }
  }

  async failure(id: number, input: { workerId: string; error: string }): Promise<{ ok: true }> {
    await this.requireLease(id, input.workerId)
    await this.prisma.liveGame.update({
      where: { id },
      data: { status: 'failed', error: input.error.slice(0, 2000), leaseUntil: null, finishedAt: new Date() },
    })
    this.changed(id)
    return { ok: true }
  }

  async saveReplay(id: number, workerId: string, body: Buffer): Promise<{ ok: true }> {
    await this.requireLease(id, workerId)
    this.checkReplay(body)
    await this.prisma.liveGame.update({ where: { id }, data: { replayGz: new Uint8Array(body) } })
    this.changed(id)
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
