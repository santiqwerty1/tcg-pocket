/**
 * The automatic search of the Laboratorio (T-008), as pure rules the API applies between rounds. Each round plays the
 * current best list (the incumbent) and K new variants of it against the meta bank, every list of the round with the
 * same seed per rival (common random numbers: a one-card change faces the same shuffles and coin flips, so the
 * comparison is sharper). The best variant of a round only passes a screen: its meta score beats the incumbent's by
 * more than `acceptZ` standard errors of the difference. Being the best of K noisy measures flatters it (H-010), so
 * before it replaces the incumbent a verification round plays the two again with fresh seeds, and the variant stays
 * only if it wins there by `verifyZ`. The incumbent's score leaves out the round where it was picked. After
 * `patience` rounds without a change, or `maxRounds`, the search stops and, when it found something, a confirmation
 * round plays the starting list and the one found with fresh seeds and more games; the search says it found a better
 * list only when the confirmation backs it. Bots play, not people: a lead is a hint to try, not a verdict.
 */
import { splitGames } from '../simulation/consistency.js'
import { chunkSeed } from '../simulation/seeds.js'
import { type MetaScore, type ScoreDifference, scoreBeats, scoreDifference } from './score.js'

export const EXPLORE_POOLS = ['collection', 'all'] as const
export type ExplorePool = (typeof EXPLORE_POOLS)[number]

export const EXPLORE_POOL_LABEL_ES: Record<ExplorePool, string> = {
  collection: 'cartas de la colección',
  all: 'todas las cartas que el motor juega',
}

export interface ExploreConfig {
  /** Games per rival and list in each search round. */
  gamesPerRival: number
  /** New variants per round. */
  variantsPerRound: number
  maxRounds: number
  /** Rounds in a row without a change before stopping. */
  patience: number
  /** Games per rival of the confirmation round (0: no confirmation). */
  confirmGames: number
  pool: ExplorePool
  /** How many standard errors of the difference the round's best variant has to win by to be verified. */
  acceptZ: number
  /** Games per rival of the verification round (0: accept on the screen alone, as before H-010). */
  verifyGames: number
  /** Standard errors it has to win by in the verification round (and the confirmation, to say «better»). */
  verifyZ: number
  /**
   * Fase 42: each rival's games follow its weight in the score, `games × rivals` per list and round in all (a rival of
   * 2 % no longer costs what one of 15 % does). Absent in searches from before it: the same games for every rival.
   */
  byWeight?: boolean
  /**
   * Fase 42 (R-012): when the confirmation backs the list found, it is played again with this bot (both sides) and
   * the search says «robusto» or «sensible al bot». null: not played. Absent in searches from before it.
   */
  confirmBot?: string | null
}

/** The «profunda» search Santi chose on 8/10/2026 (D-018): less noise, more changes tried, about an hour at most. */
export const DEFAULT_EXPLORE_CONFIG: ExploreConfig = {
  gamesPerRival: 60,
  variantsPerRound: 8,
  maxRounds: 12,
  patience: 3,
  confirmGames: 200,
  pool: 'collection',
  acceptZ: 1,
  verifyGames: 120,
  verifyZ: 1.645,
  byWeight: true,
  confirmBot: 'e3',
}

export const EXPLORE_LIMITS = {
  gamesPerRival: [10, 500],
  variantsPerRound: [1, 12],
  maxRounds: [1, 20],
  patience: [1, 10],
  confirmGames: [0, 1000],
  acceptZ: [0, 3],
  verifyGames: [0, 1000],
  verifyZ: [0, 3],
} as const satisfies Record<string, readonly [number, number]>

/** The config with every number inside its limits (counts rounded); what is missing takes the default. */
export function exploreConfig(input: Partial<ExploreConfig> = {}): ExploreConfig {
  const pick = (name: keyof typeof EXPLORE_LIMITS, integer = true): number => {
    const [min, max] = EXPLORE_LIMITS[name]
    const raw = input[name]
    if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_EXPLORE_CONFIG[name]
    return Math.min(max, Math.max(min, integer ? Math.round(raw) : raw))
  }
  return {
    gamesPerRival: pick('gamesPerRival'),
    variantsPerRound: pick('variantsPerRound'),
    maxRounds: pick('maxRounds'),
    patience: pick('patience'),
    confirmGames: pick('confirmGames'),
    pool: input.pool && EXPLORE_POOLS.includes(input.pool) ? input.pool : DEFAULT_EXPLORE_CONFIG.pool,
    acceptZ: pick('acceptZ', false),
    verifyGames: pick('verifyGames'),
    verifyZ: pick('verifyZ', false),
    byWeight: input.byWeight ?? true,
    confirmBot: input.confirmBot === undefined ? (DEFAULT_EXPLORE_CONFIG.confirmBot ?? null) : input.confirmBot,
  }
}

/**
 * Fase 42: `perRival × weights.length` games split by weight (largest remainders), each rival with at least `min`
 * (by default a quarter of the even share, and 10). The variance of a weighted score is Σ w² p(1 − p) / n: with n ∝ w
 * it is p(1 − p) / N, against R Σ w² p(1 − p) / N with the same games for all (the B4a bank: R Σ w² ≈ 1,6).
 */
export function gamesByWeight(
  perRival: number,
  weights: readonly number[],
  min = Math.max(10, Math.round(perRival / 4)),
): number[] {
  const total = perRival * weights.length
  if (weights.length === 0 || total <= 0) return weights.map(() => 0)
  const floor = Math.min(min, perRival)
  const extra = splitGames(total - floor * weights.length, weights)
  return extra.map((games) => games + floor)
}

/** The games of each rival in a round: by weight, or the same for all in a search from before fase 42. */
export function roundGames(config: ExploreConfig, games: number, weights: readonly number[]): number[] {
  return config.byWeight ? gamesByWeight(games, weights) : weights.map(() => games)
}

export type Robustness = 'robust' | 'bot_sensitive' | 'inconclusive'

/**
 * What the replay with the other bot says (R-012): «robusto» when it also backs the list found, «sensible al bot» when
 * it comes out worse, and «no alcanza» when it cannot tell (review of #49: with e3's games, about 37 % of real
 * improvements land there, and that is not the bot disagreeing).
 */
export function robustnessOf(replayed: ConfirmVerdict): Robustness {
  return replayed === 'better' ? 'robust' : replayed === 'worse' ? 'bot_sensitive' : 'inconclusive'
}

export function robustnessEs(robustness: Robustness, bot: string): string {
  if (robustness === 'robust') return `robusto: con ${bot} también sale mejor`
  if (robustness === 'bot_sensitive') {
    return `sensible al bot: con ${bot} sale peor, probala en el juego antes de cambiar el mazo`
  }
  return `con ${bot} no alcanza para decir: ni mejor ni peor con esas partidas`
}

/** Rounds are this far apart in seed space: rival j of round r plays with chunk seed `base + r × stride + j`. */
export const EXPLORE_SEED_STRIDE = 1000

/** Seed of every list of round `round` against rival `rival` (common random numbers). */
export function exploreSeed(baseSeed: number, round: number, rival: number): number {
  return chunkSeed(baseSeed, round * EXPLORE_SEED_STRIDE + rival)
}

export interface RoundCandidate {
  id: number
  score: MetaScore | null
  /** Every pairing against the bank finished (none failed). */
  complete: boolean
}

/** The variant that replaces the incumbent this round, or null. */
export function roundWinner(
  incumbent: MetaScore | null,
  candidates: readonly RoundCandidate[],
  z: number,
): number | null {
  const best = candidates
    .filter((candidate): candidate is RoundCandidate & { score: MetaScore } => candidate.complete && !!candidate.score)
    .sort((a, b) => b.score.value - a.score.value || a.id - b.id)[0]
  if (!best) return null
  if (!incumbent) return best.id
  return scoreBeats(best.score, incumbent, z) ? best.id : null
}

/** Games of a search: per round, and at most (every round verified, plus the confirmation). */
export function exploreGames(config: ExploreConfig, rivals: number): { perRound: number; max: number } {
  const perRound = (config.variantsPerRound + 1) * rivals * config.gamesPerRival
  const verify = 2 * rivals * config.verifyGames
  return { perRound, max: (perRound + verify) * config.maxRounds + 2 * rivals * config.confirmGames }
}

/** The verification round (H-010): the variant stays when, on fresh seeds, it beats the incumbent by `verifyZ`. */
export function verifyAccepts(variant: MetaScore | null, incumbent: MetaScore | null, z: number): boolean {
  return !!variant && !!incumbent && scoreBeats(variant, incumbent, z)
}

export type ConfirmVerdict = 'better' | 'unclear' | 'worse'

export const CONFIRM_VERDICT_ES: Record<ConfirmVerdict, string> = {
  better: 'la confirmación la sostiene',
  unclear: 'la confirmación no alcanza para decir que es mejor',
  worse: 'en la confirmación salió peor',
}

/**
 * What the confirmation says of the list found against the starting one (H-010): the difference of their scores on
 * the confirmation's fresh seeds, its 95 % interval, and «better» only past `z` standard errors. The errors are
 * combined as if independent; with common seeds that is conservative.
 */
export function confirmVerdict(
  found: MetaScore | null,
  base: MetaScore | null,
  z: number,
): { verdict: ConfirmVerdict; difference: ScoreDifference } | null {
  if (!found || !base) return null
  const difference = scoreDifference(found, base)
  const verdict =
    difference.value > z * difference.se ? 'better' : difference.value < -z * difference.se ? 'worse' : 'unclear'
  return { verdict, difference }
}

export type ExploreStop = 'rounds' | 'patience' | 'no_variants' | 'user'

export const EXPLORE_STOP_ES: Record<ExploreStop, string> = {
  rounds: 'llegó al máximo de rondas',
  patience: 'varias rondas seguidas sin mejorar',
  no_variants: 'no quedan variantes nuevas para probar',
  user: 'la frenaste',
}
