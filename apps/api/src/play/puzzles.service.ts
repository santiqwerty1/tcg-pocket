/**
 * Situaciones para resolver (Fase 24): the moments of the owner's finished games with the coach where the coach saw
 * a much better move (a «Peor» or an «Error grave»), read from each game's replay — engine-cli play records the
 * coach's score of every option next to each of the owner's decisions. The owner plays the moment again and the answer
 * is graded like in the game; the attempts are kept so the failed ones come back and the solved ones go last.
 */
import { gunzipSync } from 'node:zlib'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  type CoachVerdict,
  gradeAnswer,
  type PuzzleSourceStep,
  type PuzzleSpot,
  puzzleRank,
  puzzleSpots,
} from '@tcg/domain'
import type { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { LiveGamesService } from './live-games.service.js'

/** Games read for situations (the newest first). */
const MAX_GAMES = 60

interface ReplayStep extends PuzzleSourceStep {
  state: Prisma.JsonValue
  options: { text: string; action: Prisma.JsonValue }[]
}

interface GameSpots {
  steps: ReplayStep[]
  spots: PuzzleSpot[]
}

export interface PuzzleItemView {
  id: string
  gameId: number
  step: number
  ply: number
  turn: number
  options: number
  /** What it cost in the game. */
  verdict: CoachVerdict
  gap: number
  human: string
  rival: string
  finishedAt: Date | null
  attempts: number
  solved: boolean
  lastVerdict: CoachVerdict | null
  lastAt: Date | null
}

export interface PuzzleListView {
  items: PuzzleItemView[]
  counts: { total: number; pending: number; solved: number }
  /** Finished games with the coach (situations only come from those). */
  coachGames: number
}

export interface PuzzleView {
  id: string
  gameId: number
  ply: number
  turn: number
  state: Prisma.JsonValue
  actions: { i: number; text: string; action: Prisma.JsonValue }[]
  human: string
  rival: string
  names: Record<string, string>
  cards: Record<string, { id: string; name: string }>
  cardIds: Record<string, string>
  attempts: number
  solved: boolean
}

export interface PuzzleAnswerView {
  answer: number
  verdict: CoachVerdict
  gap: number
  rank: number
  best: number
  solved: boolean
  scores: number[]
  /** What the owner did in the game. */
  original: { chosen: number; verdict: CoachVerdict; gap: number }
  attempts: number
  /** The next situation to practice (null when none is left). */
  next: string | null
}

const ID = /^(\d{1,9})-(\d{1,6})$/

@Injectable()
export class PuzzlesService {
  private readonly cache = new Map<string, GameSpots>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly games: LiveGamesService,
  ) {}

  /** A game's replay, its situations, cached until the game changes (an undo reopens a finished game). */
  private spotsOf(game: { id: number; finishedAt: Date | null; replayGz: Uint8Array | null }): GameSpots {
    const key = `${game.id}:${game.finishedAt?.getTime() ?? 0}`
    const cached = this.cache.get(key)
    if (cached) return cached
    let steps: ReplayStep[] = []
    try {
      const replay = JSON.parse(gunzipSync(game.replayGz ?? new Uint8Array()).toString('utf8')) as { steps?: unknown }
      steps = Array.isArray(replay.steps) ? (replay.steps as ReplayStep[]) : []
    } catch {
      steps = []
    }
    const value = { steps, spots: puzzleSpots(steps) }
    this.cache.set(key, value)
    return value
  }

  private coachGames() {
    return this.prisma.liveGame.findMany({
      where: { coach: true, status: 'done', replayGz: { not: null } },
      orderBy: { id: 'desc' },
      take: MAX_GAMES,
      select: { id: true, humanLabel: true, rivalLabel: true, finishedAt: true, replayGz: true },
    })
  }

  async list(): Promise<PuzzleListView> {
    const [games, attempts] = await Promise.all([this.coachGames(), this.prisma.puzzleAttempt.findMany()])
    const progress = new Map(attempts.map((row) => [`${row.gameId}-${row.step}`, row]))
    const items: PuzzleItemView[] = []
    for (const game of games) {
      for (const spot of this.spotsOf(game).spots) {
        const id = `${game.id}-${spot.step}`
        const row = progress.get(id)
        items.push({
          id,
          gameId: game.id,
          step: spot.step,
          ply: spot.ply,
          turn: spot.turn,
          options: spot.options,
          verdict: spot.verdict,
          gap: spot.gap,
          human: game.humanLabel,
          rival: game.rivalLabel,
          finishedAt: game.finishedAt,
          attempts: row?.attempts ?? 0,
          solved: row?.solved ?? false,
          lastVerdict: (row?.lastVerdict as CoachVerdict | null | undefined) ?? null,
          lastAt: row?.lastAt ?? null,
        })
      }
    }
    // Never tried (newest game first, in game order), then failed (longest ago first), then solved.
    const rank = (item: PuzzleItemView) => puzzleRank(item)
    items.sort((a, b) => {
      const byRank = rank(a) - rank(b)
      if (byRank !== 0) return byRank
      if (rank(a) === 0) return b.gameId - a.gameId || a.step - b.step
      return (a.lastAt?.getTime() ?? 0) - (b.lastAt?.getTime() ?? 0)
    })
    const solved = items.filter((item) => item.solved).length
    return {
      items,
      counts: { total: items.length, pending: items.length - solved, solved },
      coachGames: games.length,
    }
  }

  private async find(rawId: string): Promise<{ gameId: number; spot: PuzzleSpot; step: ReplayStep }> {
    const match = ID.exec(rawId)
    if (!match) throw new BadRequestException({ code: 'validation', message: 'Situación inválida.' })
    const gameId = Number(match[1])
    const stepIndex = Number(match[2])
    const game = await this.prisma.liveGame.findFirst({
      where: { id: gameId, coach: true, status: 'done', replayGz: { not: null } },
      select: { id: true, finishedAt: true, replayGz: true },
    })
    const spots = game ? this.spotsOf(game) : null
    const spot = spots?.spots.find((item) => item.step === stepIndex)
    const step = spots?.steps[stepIndex]
    if (!spot || !step) throw new NotFoundException(`Situación ${rawId} no encontrada.`)
    return { gameId, spot, step }
  }

  async get(rawId: string): Promise<PuzzleView> {
    const { gameId, spot, step } = await this.find(rawId)
    const [game, progress] = await Promise.all([
      this.games.get(String(gameId)),
      this.prisma.puzzleAttempt.findUnique({ where: { gameId_step: { gameId, step: spot.step } } }),
    ])
    return {
      id: rawId,
      gameId,
      ply: spot.ply,
      turn: step.turn,
      state: step.state,
      actions: step.options.map((option, i) => ({ i, text: option.text, action: option.action })),
      human: game.human.label,
      rival: game.rival.label,
      names: game.names,
      cards: game.cards,
      cardIds: game.cardIds,
      attempts: progress?.attempts ?? 0,
      solved: progress?.solved ?? false,
    }
  }

  async answer(rawId: string, input: { i: number }): Promise<PuzzleAnswerView> {
    const { gameId, spot, step } = await this.find(rawId)
    const scores = [...(step.scores ?? [])]
    if (!Number.isInteger(input.i) || input.i < 0 || input.i >= scores.length) {
      throw new BadRequestException({ code: 'validation', message: 'Esa opción no existe.' })
    }
    const grade = gradeAnswer(scores, input.i)
    const now = new Date()
    const row = await this.prisma.puzzleAttempt.upsert({
      where: { gameId_step: { gameId, step: spot.step } },
      create: { gameId, step: spot.step, attempts: 1, solved: grade.solved, lastVerdict: grade.verdict, lastAt: now },
      update: { attempts: { increment: 1 }, solved: grade.solved, lastVerdict: grade.verdict, lastAt: now },
    })
    const next = (await this.list()).items.find((item) => item.id !== rawId && !item.solved)?.id ?? null
    return {
      answer: input.i,
      verdict: grade.verdict,
      gap: grade.gap,
      rank: grade.rank,
      best: grade.best,
      solved: grade.solved,
      scores: scores.map((score) => Math.round(score * 10) / 10),
      original: { chosen: spot.chosen, verdict: spot.verdict, gap: spot.gap },
      attempts: row.attempts,
      next,
    }
  }
}
