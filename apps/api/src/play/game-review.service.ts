/**
 * Claude analiza una partida (Fase 29): the owner's games against the bot, and one of them told for Claude — turn by
 * turn in Spanish, the board at the start of each turn and, with the coach, what it thought of each choice and the
 * costliest moments with their board. A game still going has no replay yet: only the coach's reviews so far.
 */
import { Injectable } from '@nestjs/common'
import {
  COACH_VERDICT_ES,
  type CoachReview,
  coachSummary,
  type GameReview,
  gameReview,
  isReviewReplay,
  ReplayNarrator,
  type ReviewReplay,
} from '@tcg/domain'
import { PrismaService } from '../prisma/prisma.service.js'
import { LiveGamesService, type LiveGameView } from './live-games.service.js'

const WINNER_ES = { you: 'ganaste vos', bot: 'ganó el bot', tie: 'empate' } as const
const STATUS_ES: Record<LiveGameView['status'], string> = {
  queued: 'esperando a la PC',
  running: 'en curso',
  waiting: 'te toca',
  done: 'terminada',
  failed: 'falló',
  abandoned: 'abandonada',
  engine_changed: 'terminada porque cambió el motor',
}

export interface GameListItemView {
  id: number
  status: string
  rival: string
  deck: string
  bot: string
  coach: boolean
  result: string | null
  turns: number | null
  finishedAt: Date | null
  /** Share of choices as good as the coach's (best or close), in games with the coach. */
  coachAgreement: number | null
}

export interface GameReviewView {
  id: number
  status: string
  deck: string
  rival: string
  bot: string
  result: string | null
  turns: number | null
  coach: {
    decisions: number
    agreement: number
    hints: number
    counts: Record<string, number>
  } | null
  /** Both lists with Spanish names («2 Torchic»). */
  lists: { you: string[]; bot: string[] }
  review: GameReview | null
  /** A game still going: the coach's reviews so far (no replay yet). */
  soFar: { ply: number; turn: number; verdict: string; gap: number; chosen: string; best: string | null }[] | null
  note: string
}

const UNITS =
  'El valor del entrenador es el del motor deckgym: 10.000 = un punto de premio, 500 = un Pokémon listo para atacar; «gap» es lo que se perdió contra su mejor opción (menos de 100: casi igual; 1.000 o más: peor; 5.000 o más: error grave). El entrenador juega cada opción 12 veces hasta el final de tu turno: ve el turno, no la partida entera.'

@Injectable()
export class GameReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly games: LiveGamesService,
  ) {}

  async list(limit = 15): Promise<GameListItemView[]> {
    const games = (await this.games.list(limit)).slice(0, limit)
    const coachLogs = new Map(
      (
        await this.prisma.liveGame.findMany({
          where: { id: { in: games.filter((game) => game.coach).map((game) => game.id) } },
          select: { id: true, coachLog: true },
        })
      ).map((row) => [row.id, coachSummary(row.coachLog as unknown as CoachReview[])]),
    )
    return games.map((game) => {
      const summary = coachLogs.get(game.id)
      return {
        id: game.id,
        status: STATUS_ES[game.status],
        rival: game.rival,
        deck: game.human,
        bot: game.botEs,
        coach: game.coach,
        result: game.winner ? WINNER_ES[game.winner] : null,
        turns: game.turns,
        finishedAt: game.finishedAt,
        coachAgreement: summary && summary.decisions > 0 ? Math.round(summary.agreement) : null,
      }
    })
  }

  async review(
    rawId: string,
    options: { fromTurn?: number | undefined; toTurn?: number | undefined; detail?: 'summary' | 'full' | undefined },
  ): Promise<GameReviewView> {
    const game = await this.games.peek(rawId)
    const name = (engineId: string) => game.names[engineId] ?? game.cards[engineId]?.name ?? engineId
    // Editions of the same card go together («2 Mega-Blaziken ex», not one line per edition).
    const list = (cards: { engineId: string; count: number }[]) => {
      const counts = new Map<string, number>()
      for (const card of cards) counts.set(name(card.engineId), (counts.get(name(card.engineId)) ?? 0) + card.count)
      return [...counts].map(([cardName, count]) => `${count} ${cardName}`)
    }
    const summary = game.coachSummary
    const base = {
      id: game.id,
      status: STATUS_ES[game.status],
      deck: game.human.label,
      rival: game.rival.label,
      bot: game.botEs,
      result: game.winner ? WINNER_ES[game.winner] : null,
      turns: game.turns,
      coach: summary
        ? {
            decisions: summary.decisions,
            agreement: Math.round(summary.agreement),
            hints: summary.hints,
            counts: Object.fromEntries(
              Object.entries(summary.counts).map(([verdict, count]) => [
                COACH_VERDICT_ES[verdict as keyof typeof COACH_VERDICT_ES],
                count,
              ]),
            ),
          }
        : null,
      lists: { you: list(game.decks.human), bot: list(game.decks.rival) },
    }
    if (game.replay) {
      const raw = await this.games.replayRaw(rawId)
      if (isReviewReplay(raw)) {
        return {
          ...base,
          review: gameReview(raw, { names: game.names, ...options }),
          soFar: null,
          note: `Tablero al empezar cada turno (la mano del bot incluida: en la partida no la veías). ${game.coach ? UNITS : 'Sin entrenador: no hay valoración de las jugadas.'}`,
        }
      }
    }
    // Still going (or no replay): the coach's reviews so far, with the engine's texts in Spanish.
    const narrator = new ReplayNarrator(
      { players: [], cards: game.cards, steps: [], final_state: null as never, outcome: null } as ReviewReplay,
      game.names,
    )
    return {
      ...base,
      review: null,
      soFar: game.coachReviews.map((review) => ({
        ply: review.ply,
        turn: review.turn,
        verdict: COACH_VERDICT_ES[review.verdict],
        gap: Math.round(review.gap),
        chosen: narrator.translateText(review.chosenText),
        best: review.best === review.chosen ? null : narrator.translateText(review.bestText),
      })),
      note: `La partida no terminó (${STATUS_ES[game.status]}): todavía no hay repetición. ${game.coach ? `Lo que dijo el entrenador hasta ahora. ${UNITS}` : 'Sin entrenador.'}`,
    }
  }
}
