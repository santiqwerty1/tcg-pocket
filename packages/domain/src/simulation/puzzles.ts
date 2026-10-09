/**
 * Situaciones para resolver (Fase 24): moments of the owner's own games against the bot where the coach saw a much
 * better move (a «Peor» or an «Error grave»: a gap of 1.000 or more), taken from the game's replay — the coach's
 * scores for every option of each of the owner's decisions are recorded in it. Each one is played again: the owner
 * picks a move and it is graded against the coach's scores, like in the game.
 */
import { COACH_THRESHOLDS, type CoachVerdict, coachVerdict } from './coach.js'

/** The bits of a replay step (deckgym's JSON) a situation needs. */
export interface PuzzleSourceStep {
  turn: number
  actor: number
  options: readonly unknown[]
  chosen: number
  scores?: readonly number[] | null
}

export interface PuzzleSpot {
  /** Index of the replay step. */
  step: number
  /** The owner's decision number in the game (1, 2…). */
  ply: number
  turn: number
  options: number
  chosen: number
  best: number
  gap: number
  verdict: CoachVerdict
}

function bestOf(scores: readonly number[]): number {
  let best = 0
  for (let i = 1; i < scores.length; i++) if ((scores[i] ?? -Infinity) > (scores[best] ?? -Infinity)) best = i
  return best
}

/** The owner's (seat 0) decisions the coach scored and that cost at least a «Peor». */
export function puzzleSpots(
  steps: readonly PuzzleSourceStep[],
  minGap: number = COACH_THRESHOLDS.inaccuracy,
): PuzzleSpot[] {
  const spots: PuzzleSpot[] = []
  let ply = 0
  steps.forEach((step, index) => {
    if (step.actor !== 0 || step.options.length < 2) return
    ply += 1
    const scores = step.scores
    if (!scores || scores.length !== step.options.length || scores.some((score) => !Number.isFinite(score))) return
    const best = bestOf(scores)
    const gap = (scores[best] ?? 0) - (scores[step.chosen] ?? 0)
    if (gap < minGap) return
    spots.push({
      step: index,
      ply,
      turn: step.turn,
      options: step.options.length,
      chosen: step.chosen,
      best,
      gap: Math.round(gap * 10) / 10,
      verdict: coachVerdict(gap, step.chosen === best),
    })
  })
  return spots
}

export interface PuzzleGrade {
  best: number
  gap: number
  /** 1 = as good as the best. */
  rank: number
  verdict: CoachVerdict
  /** «Como el entrenador» or «Casi igual». */
  solved: boolean
}

export function gradeAnswer(scores: readonly number[], answer: number): PuzzleGrade {
  const best = bestOf(scores)
  const mine = scores[answer] ?? Number.NEGATIVE_INFINITY
  const gap = Math.max(0, (scores[best] ?? mine) - mine)
  const verdict = coachVerdict(gap, answer === best)
  return {
    best,
    gap: Math.round(gap * 10) / 10,
    rank: 1 + scores.filter((score) => score > mine).length,
    verdict,
    solved: verdict === 'best' || verdict === 'close',
  }
}

export interface PuzzleProgress {
  attempts: number
  solved: boolean
  lastAt: Date | null
}

/**
 * The order to practice: never tried first (newest games first), then the ones failed (the longest ago first), and
 * the solved ones last.
 */
export function puzzleRank(progress: PuzzleProgress | undefined): number {
  if (!progress || progress.attempts === 0) return 0
  return progress.solved ? 2 : 1
}
