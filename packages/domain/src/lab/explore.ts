/**
 * The automatic search of the Laboratorio (T-008), as pure rules the API applies between rounds. Each round plays the
 * current best list (the incumbent) and K new variants of it against the meta bank, every list of the round with the
 * same seed per rival (common random numbers: a one-card change faces the same shuffles and coin flips, so the
 * comparison is sharper). The best variant replaces the incumbent only when its meta score beats the incumbent's
 * (every game the incumbent has played so far) by more than z standard errors of the difference. After `patience`
 * rounds without a change, or `maxRounds`, the search stops and, when it found something, a confirmation round plays
 * the starting list and the one found with fresh seeds and more games: the final numbers do not carry the luck that
 * picked the winner. Bots play, not people: a lead is a hint to try, not a verdict.
 */
import { chunkSeed } from '../simulation/seeds.js'
import { type MetaScore, scoreBeats } from './score.js'

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
  /** How many standard errors of the difference a variant has to win by. */
  acceptZ: number
}

export const DEFAULT_EXPLORE_CONFIG: ExploreConfig = {
  gamesPerRival: 40,
  variantsPerRound: 6,
  maxRounds: 8,
  patience: 3,
  confirmGames: 100,
  pool: 'collection',
  acceptZ: 1,
}

export const EXPLORE_LIMITS = {
  gamesPerRival: [10, 500],
  variantsPerRound: [1, 12],
  maxRounds: [1, 20],
  patience: [1, 10],
  confirmGames: [0, 1000],
  acceptZ: [0, 3],
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
  }
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

/** Games of a search: per round, and at most (every round plus the confirmation). */
export function exploreGames(config: ExploreConfig, rivals: number): { perRound: number; max: number } {
  const perRound = (config.variantsPerRound + 1) * rivals * config.gamesPerRival
  return { perRound, max: perRound * config.maxRounds + 2 * rivals * config.confirmGames }
}

export type ExploreStop = 'rounds' | 'patience' | 'no_variants'

export const EXPLORE_STOP_ES: Record<ExploreStop, string> = {
  rounds: 'llegó al máximo de rondas',
  patience: 'varias rondas seguidas sin mejorar',
  no_variants: 'no quedan variantes nuevas para probar',
}
