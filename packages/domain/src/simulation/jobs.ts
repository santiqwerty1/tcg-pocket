/**
 * Simulation jobs (PLAN §3.7, BRIEF M7): what is queued, split into chunks the worker plays one at a time.
 * - matrix: every deck of side A against every deck of side B; when both sides are the same set, unordered pairs
 *   (40 decks → 780 pairings; the engine draws who starts), optionally both orders.
 * - compare: variants (or revisions) of a deck against a group of rivals, one row per variant.
 * - optimize: fill the open slots of a deck with candidate cards, against a group of rivals (one chunk).
 * - explore: the Laboratorio's automatic search (T-008, lab/explore.ts): rounds of variants against the meta bank,
 *   queued by the API one round at a time.
 * - consistency: how soon one deck has its key attacker ready, in goldfish games (Fase 8, simulation/consistency.ts).
 * A pairing with many games is split so a chunk stays short (heartbeats, resuming after the PC is turned off).
 */

export const SIMULATION_KINDS = ['matrix', 'compare', 'optimize', 'explore', 'consistency'] as const
export type SimulationKind = (typeof SIMULATION_KINDS)[number]
/** What POST /api/simulations queues: explore jobs start from the Laboratorio. */
export const QUEUEABLE_SIMULATION_KINDS = ['matrix', 'compare', 'optimize'] as const

/** Bots of deckgym that can play unattended, with what they are. */
export const BOT_LABEL_ES: Record<string, string> = {
  r: 'al azar',
  w: 'al azar ponderado',
  aa: 'adjunta y ataca',
  et: 'termina el turno',
  v: 'función de valor',
  er: 'evoluciona primero',
  m: 'MCTS (100 iteraciones)',
  e1: 'expectiminimax, profundidad 1',
  e2: 'expectiminimax, profundidad 2',
  e3: 'expectiminimax, profundidad 3',
  e4: 'expectiminimax, profundidad 4',
  // H-018: the same search with a clock that sees evolutions and variable damage (engine/src/fair_bot.rs).
  f1: 'expectiminimax corregido, profundidad 1',
  f2: 'expectiminimax corregido, profundidad 2',
  f3: 'expectiminimax corregido, profundidad 3',
  f4: 'expectiminimax corregido, profundidad 4',
  // T-021: the same search on a copy with the rival's hand and deck hidden, with the clock of real damage (docs/BOTS.md).
  g1: 'expectiminimax sin trampa, profundidad 1',
  g2: 'expectiminimax sin trampa, profundidad 2',
  g3: 'expectiminimax sin trampa, profundidad 3',
  g4: 'expectiminimax sin trampa, profundidad 4',
}

/**
 * `r`, `e2`… (deckgym's codes without the human and external players), `f1`–`f9` (H-018: engine-cli's own
 * expectiminimax that sees evolutions) and `g1`–`g9` (T-021: the one that does not see the rival's hand or deck):
 * the one list every schema checks against.
 */
export const BOT_CODE_PATTERN = /^(r|w|aa|et|v|er|m|e[1-9]|f[1-9]|g[1-9])$/

/**
 * D-029 (Santi, 23/10/2026): the bot by default wherever one is not chosen — Jugar, Simulación, Calibración, the
 * Laboratorio and its score in «¿Cuál llevo hoy?», consistency and the MCP tools. g2 since 23/10: against the
 * tournaments it calibrated about like e3 (151 of 232 compatible pairs, 12,2 points of mean difference, ρ 0,38;
 * e2 129 of 233, 14,1 and 0,30) at about 3 times e2's cost, and without the e bots' blind spots (H-055).
 */
export const DEFAULT_BOT = 'g2'

/** Both sides with the bot by default (the Laboratorio, simulations_enqueue). */
export const DEFAULT_PLAYERS: readonly [string, string] = [DEFAULT_BOT, DEFAULT_BOT]

/**
 * The bot by default until 23/10/2026 (D-029). Only for what was stored then without saying its bot (a fallback when
 * a stored job or response lacks it): a new job never takes it unasked.
 */
export const LEGACY_DEFAULT_BOT = 'e2'

/** The f bots (H-018), for the queue's filter: only engines with the «fairBots» feature play them (capabilities.ts). */
export const FAIR_BOT_CODES = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9'] as const

/** H-051: the bot that ends its turn; only engines with the «etBot» feature play it (capabilities.ts). */
export const ET_BOT_CODE = 'et'

/** The g bots (T-021), for the queue's filter: only engines with the g of this version play them (capabilities.ts). */
export const G_BOT_CODES = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9'] as const

/**
 * D-025: the bots a worker with `allowSlowBots: false` (Android, by default) never takes, for the queue's filter and the
 * worker_idle alert. The g bots are all slow: their clock asks the engine for each attack's damage (g2 about 3 times
 * e2, T-021; g1 was never measured, and the list keeps it).
 */
export const SLOW_BOT_CODES = [
  'm',
  ...['e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9'],
  ...['f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9'],
  ...G_BOT_CODES,
] as const

export function usesFairBot(players: readonly string[]): boolean {
  return players.some((code) => (FAIR_BOT_CODES as readonly string[]).includes(code))
}

export function isBotCode(code: string): boolean {
  return BOT_CODE_PATTERN.test(code)
}

export function botLabel(code: string): string {
  return BOT_LABEL_ES[code] ?? code
}

export interface Pairing {
  /** Snapshot ids. */
  a: number
  b: number
}

/** Every A × B pairing; with the same set on both sides, unordered pairs (and both orders when `bothOrders`). */
export function matrixPairings(sideA: readonly number[], sideB: readonly number[], bothOrders = false): Pairing[] {
  const a = [...new Set(sideA)]
  // No rivals: side A against itself.
  const b = sideB.length === 0 ? a : [...new Set(sideB)]
  const same = a.length === b.length && a.every((id) => b.includes(id))
  const pairings: Pairing[] = []
  if (same) {
    for (let i = 0; i < a.length; i++) {
      for (let j = i + 1; j < a.length; j++) {
        pairings.push({ a: a[i] as number, b: a[j] as number })
        if (bothOrders) pairings.push({ a: a[j] as number, b: a[i] as number })
      }
    }
    return pairings
  }
  for (const x of a) for (const y of b) if (x !== y) pairings.push({ a: x, b: y })
  return pairings
}

/** Every variant against every rival (a variant that is also a rival is not played against itself). */
export function comparePairings(variants: readonly number[], rivals: readonly number[]): Pairing[] {
  const pairings: Pairing[] = []
  for (const a of new Set(variants)) for (const b of new Set(rivals)) if (a !== b) pairings.push({ a, b })
  return pairings
}

/**
 * Replays kept per pairing when the request does not say: one in a matrix (a 40-deck matrix is 780 pairings, ~6 MB
 * with one each; two each filled 61 MB of the database for matrix #4) and two in a comparison.
 */
export function defaultReplaySample(kind: SimulationKind): number {
  return kind === 'matrix' ? 1 : 2
}

/** Games per chunk at most: a chunk of e2 bots takes about a minute on two threads. */
export const MAX_GAMES_PER_CHUNK = 1000

export interface ChunkPlan {
  idx: number
  a: number
  b: number
  games: number
  /** Index of the first game of the pairing this chunk plays (0 unless a pairing is split). */
  firstGame: number
}

/** Chunks of a list of pairings with `games` games each. */
export function planChunks(
  pairings: readonly Pairing[],
  games: number,
  maxPerChunk = MAX_GAMES_PER_CHUNK,
): ChunkPlan[] {
  const chunks: ChunkPlan[] = []
  for (const pairing of pairings) {
    for (let first = 0; first < games; first += maxPerChunk) {
      chunks.push({
        idx: chunks.length,
        a: pairing.a,
        b: pairing.b,
        games: Math.min(maxPerChunk, games - first),
        firstGame: first,
      })
    }
  }
  return chunks
}

/**
 * What each depth of the expectiminimax bots costs against e2, measured with the same bank, engine and machine for
 * every bot (Calibracion-2026-10-12.md, «Velocidad»: the PC's worker on 16 threads, deckgym 33ff2a5, the 18-list
 * bank of B4a; 373,2 games per second with e1, 70,1 with e2, 15,4 with e3 and 6,3 with e4). e3 at 4,6 times e2 is also
 * what D-029 weighed; it was 1,6 here until 23/10/2026, which made an e3 plan look three times shorter than it is.
 */
export const DEPTH_COST_VS_E2: Readonly<Record<number, number>> = { 1: 0.19, 2: 1, 3: 4.6, 4: 11 }

/**
 * Depths 5 to 9 were never measured: each one more costs the last measured step (e3 to e4, about 2,5 times, the same
 * report). A guess, so a deeper search never looks cheaper than e4.
 */
const UNMEASURED_DEPTH_STEP = 2.5

/** MCTS (100 iterations) against e2, the same report: 0,46 games per second against 70,1. */
const MCTS_COST_VS_E2 = 150

/**
 * f<N> (H-018) against e<N> at the same depth: 1,0–2,0 measured (09/10: 20–100 % slower depending on the decks; the
 * calibration report: twice e2 on the PC with f2, 1,3 times on the second worker, as fast as e3 with f3).
 */
const FAIR_COST_VS_E = 1.3

/**
 * g<N> (T-021) against e<N> at the same depth: its clock asks the engine for each attack's damage. Measured only at
 * depth 2, in the bots' league (docs/BOTS.md, same 10 pairings, 4 threads): 333–345 ms per game against e2's 111–112
 * with the engine at 0b510d1, 312 against 96 at c87bad0 (3,25 times). The wall time of the calibrations is no
 * measure of it: the 86 (g2, 22/10) and the 82 (e2, 19/10) ran on the PC while it was in use, with the regulator
 * (worker 0.3.9) giving way, and the Laboratorio's jobs go first in the queue.
 */
const G_COST_VS_E = 3

/** Seconds of engine time per game and side with e2 (see `estimateSeconds`). */
const E2_SECONDS = 0.05

/** A bot's cost per game against e2's (1): for the estimates and for the texts that compare bots. */
export function botCostVsE2(code: string): number {
  if (code === 'r' || code === 'w' || code === 'aa' || code === 'et' || code === 'er') return 0.0015 / E2_SECONDS
  if (code === 'v') return 0.004 / E2_SECONDS
  if (code === 'm') return MCTS_COST_VS_E2
  const [, kind, digit] = /^([efg])([1-9])$/.exec(code) ?? []
  if (digit === undefined) return 1
  const depth = Number(digit)
  const measured = DEPTH_COST_VS_E2[depth]
  const cost = measured ?? (DEPTH_COST_VS_E2[4] as number) * UNMEASURED_DEPTH_STEP ** (depth - 4)
  return cost * (kind === 'f' ? FAIR_COST_VS_E : kind === 'g' ? G_COST_VS_E : 1)
}

/**
 * Rough wall time on the owner's PC (DECISIONES 6.15 and 9.1): 10.000 r,r in 14 s on two threads ⇒ ~1,4 ms per
 * game. e2: the 40-deck matrix on 8 threads took 52 min of engine time at fb792eb, 37 % of it in the pairings
 * against one deck whose search exploded; deckgym 33ff2a5 caps that search (8–10 times faster there), which puts
 * the matrix near 35 min ⇒ 50 ms per side, game and thread. Every other bot is e2 times `botCostVsE2`. A guide for
 * the confirmation screen, not a promise: some pairings take much longer than others.
 */
export function estimateSeconds(totalGames: number, players: readonly [string, string], cores: number): number {
  const perGame = Math.max(botCostVsE2(players[0]), botCostVsE2(players[1])) * E2_SECONDS * 2
  return (totalGames * perGame) / Math.max(1, cores)
}
