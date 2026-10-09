/**
 * Modo entrenador (Fase 20): what the engine thought of each of the owner's choices in a game against a bot. The
 * engine scores every option (engine/src/coach.rs: each option played 12 times to the end of the owner's turn with
 * deckgym's baseline value function, where a prize point is worth 10.000 and a Pokémon ready to attack 500); here the
 * gap between the best option and the chosen one becomes a verdict. Thresholds calibrated on 731 alternatives of five
 * whole games of deckgym's example decks (8/10/2026): 31 % within 100, 43 % 100–1.000, 12 % 1.000–5.000, 14 % above.
 */

export const COACH_THRESHOLDS = {
  /** Below this the two options are as good as each other (hand size, a few HP). */
  close: 100,
  /** Below this, a small loss (a worse bench, a card less). */
  inaccuracy: 1000,
  /** Below this, a clear loss (an attacker not ready); from here on, half a prize point or more. */
  mistake: 5000,
} as const

export const COACH_VERDICTS = ['best', 'close', 'inaccuracy', 'mistake', 'blunder'] as const
export type CoachVerdict = (typeof COACH_VERDICTS)[number]

export const COACH_VERDICT_ES: Record<CoachVerdict, string> = {
  best: 'Como el entrenador',
  close: 'Casi igual',
  inaccuracy: 'Un poco peor',
  mistake: 'Peor',
  blunder: 'Error grave',
}

/** The engine's opinion of one decision, as `engine-cli play` sends it. */
export interface CoachScores {
  scores: number[]
  best: number
}

export interface CoachReview {
  ply: number
  turn: number
  options: number
  chosen: number
  best: number
  /** Engine texts of both options (the app translates them like the rest of the log). */
  chosenText: string
  bestText: string
  /** Value lost against the best option (≥ 0). */
  gap: number
  /** 1 = the best (ties count as the best). */
  rank: number
  verdict: CoachVerdict
  /** The owner asked for the hint before choosing. */
  hinted: boolean
  /** The engine's actions and the cards in play, so the app can name them like the rest of the log. */
  chosenAction?: unknown
  bestAction?: unknown
  ctx?: CoachContext | null
}

/** Card ids in play for both players and the stadium (like the `ctx` of the game's log). */
export interface CoachContext {
  in_play: (string | null)[][]
  stadium: string | null
}

/** The `ctx` of a decision's state (deckgym's ViewState). */
export function coachContext(state: unknown): CoachContext | null {
  if (typeof state !== 'object' || state === null) return null
  const { players, stadium } = state as { players?: unknown; stadium?: unknown }
  if (!Array.isArray(players)) return null
  return {
    in_play: players.map((player) => {
      const slots = (player as { in_play?: unknown } | null)?.in_play
      return Array.isArray(slots)
        ? slots.map((slot) => {
            const card = (slot as { card?: unknown } | null)?.card
            return typeof card === 'string' ? card : null
          })
        : []
    }),
    stadium: typeof stadium === 'string' ? stadium : null,
  }
}

export function coachVerdict(gap: number, sameAsBest: boolean): CoachVerdict {
  if (sameAsBest || gap <= 0) return 'best'
  if (gap < COACH_THRESHOLDS.close) return 'close'
  if (gap < COACH_THRESHOLDS.inaccuracy) return 'inaccuracy'
  if (gap < COACH_THRESHOLDS.mistake) return 'mistake'
  return 'blunder'
}

export function reviewChoice(input: {
  ply: number
  turn: number
  coach: CoachScores
  chosen: number
  texts: readonly string[]
  hinted?: boolean | undefined
  actions?: readonly unknown[] | undefined
  ctx?: CoachContext | null | undefined
}): CoachReview {
  const { scores } = input.coach
  const best = input.coach.best
  const chosenScore = scores[input.chosen] ?? Number.NEGATIVE_INFINITY
  const bestScore = scores[best] ?? chosenScore
  const gap = Math.max(0, bestScore - chosenScore)
  return {
    ply: input.ply,
    turn: input.turn,
    options: scores.length,
    chosen: input.chosen,
    best,
    chosenText: input.texts[input.chosen] ?? '',
    bestText: input.texts[best] ?? '',
    gap: Math.round(gap * 10) / 10,
    rank: 1 + scores.filter((score) => score > chosenScore).length,
    verdict: coachVerdict(gap, input.chosen === best),
    hinted: input.hinted ?? false,
    ...(input.actions ? { chosenAction: input.actions[input.chosen], bestAction: input.actions[best] } : {}),
    ...(input.ctx !== undefined ? { ctx: input.ctx } : {}),
  }
}

export interface CoachSummary {
  decisions: number
  counts: Record<CoachVerdict, number>
  /** Share (0–100) of choices as good as the coach's (best or close). */
  agreement: number
  hints: number
  /** Up to three costliest choices (mistakes and blunders), costliest first. */
  worst: CoachReview[]
}

export function coachSummary(reviews: readonly CoachReview[]): CoachSummary {
  const counts = Object.fromEntries(COACH_VERDICTS.map((verdict) => [verdict, 0])) as Record<CoachVerdict, number>
  for (const review of reviews) counts[review.verdict] += 1
  const decisions = reviews.length
  return {
    decisions,
    counts,
    agreement: decisions === 0 ? 0 : ((counts.best + counts.close) / decisions) * 100,
    hints: reviews.filter((review) => review.hinted).length,
    worst: reviews
      .filter((review) => review.verdict === 'mistake' || review.verdict === 'blunder')
      .sort((a, b) => b.gap - a.gap || a.ply - b.ply)
      .slice(0, 3),
  }
}

/** Parses the `coach` field of a decision (null when absent or malformed). */
export function parseCoachScores(value: unknown): CoachScores | null {
  if (typeof value !== 'object' || value === null) return null
  const { scores, best } = value as { scores?: unknown; best?: unknown }
  if (!Array.isArray(scores) || !scores.every((score) => typeof score === 'number' && Number.isFinite(score))) {
    return null
  }
  if (typeof best !== 'number' || !Number.isInteger(best) || best < 0 || best >= scores.length) return null
  return { scores: scores as number[], best }
}
