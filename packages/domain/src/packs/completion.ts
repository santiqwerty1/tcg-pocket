/**
 * Expected packs to get every missing card of a deck from one pack (coupon collector with unequal chances,
 * docs/fase0/sobres.md §4). Exact by inclusion–exclusion when every card is missing once and there are at most
 * 12 of them; otherwise a seeded Monte Carlo of the same pack model, reported with its 95 % interval.
 */
import type { PackStructure } from '../catalog/types.js'
import { combineChances, type EditionChances } from './pullRate.js'
import { PACK_MIX } from './rates.js'

export interface MissingInPack {
  /** Functional card. */
  groupId: string
  /** Copies still missing. */
  copies: number
  /** Chances of every edition of the card in this pack. */
  chances: EditionChances[]
}

export interface CompletionEstimate {
  expectedPacks: number
  method: 'exact' | 'simulation'
  /** 95 % interval of the mean (simulation only). */
  ci95: [number, number] | null
}

export const EXACT_COMPLETION_MAX_CARDS = 12
const SIMULATION_RUNS = 400
const SIMULATION_PACK_CAP = 20_000

/** mulberry32: small seeded PRNG so the estimate is the same every time for the same input. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function exact(missing: readonly MissingInPack[], structure: PackStructure): number {
  let expected = 0
  const total = 1 << missing.length
  for (let mask = 1; mask < total; mask += 1) {
    const chances: EditionChances[] = []
    let size = 0
    missing.forEach((item, at) => {
      if (mask & (1 << at)) {
        size += 1
        chances.push(...item.chances)
      }
    })
    const probability = combineChances(chances, structure).probability
    expected += (size % 2 === 1 ? 1 : -1) / probability
  }
  return expected
}

function simulate(missing: readonly MissingInPack[], structure: PackStructure, seed: number): CompletionEstimate {
  const random = seededRandom(seed)
  const positions = structure.cardsPerPack
  // Per slot: cumulative probabilities over the wanted editions, with the group each one fills.
  const slot = (pick: (chance: EditionChances) => number) => {
    const entries: { upTo: number; group: number }[] = []
    let upTo = 0
    missing.forEach((item, group) => {
      for (const chance of item.chances) {
        const value = pick(chance)
        if (value > 0) {
          upTo += value
          entries.push({ upTo, group })
        }
      }
    })
    return entries
  }
  const regular = Array.from({ length: positions }, (_, at) => slot((chance) => chance.perPosition[at] ?? 0))
  const rare = slot((chance) => chance.rare)
  const baby = slot((chance) => chance.baby)
  const draw = (entries: { upTo: number; group: number }[], have: number[]) => {
    const u = random()
    const hit = entries.find((entry) => u < entry.upTo)
    if (hit) have[hit.group] = (have[hit.group] ?? 0) + 1
  }
  const results: number[] = []
  for (let run = 0; run < SIMULATION_RUNS; run += 1) {
    const have = missing.map(() => 0)
    let packs = 0
    while (packs < SIMULATION_PACK_CAP && missing.some((item, at) => (have[at] ?? 0) < item.copies)) {
      packs += 1
      const kind = random()
      if (positions === 5 && kind < PACK_MIX.rare) {
        for (let i = 0; i < 5; i += 1) draw(rare, have)
        continue
      }
      for (const entries of regular) draw(entries, have)
      if (structure.containsBabies && positions === 5 && kind >= PACK_MIX.rare + PACK_MIX.regularWithBabies) {
        draw(baby, have)
      }
    }
    results.push(packs)
  }
  const mean = results.reduce((sum, value) => sum + value, 0) / results.length
  const variance = results.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (results.length - 1)
  const half = 1.959963984540054 * Math.sqrt(variance / results.length)
  return { expectedPacks: mean, method: 'simulation', ci95: [Math.max(0, mean - half), mean + half] }
}

/**
 * Expected packs of this pack to complete `missing`; null when some card cannot come out of it. `seed` makes the
 * simulation reproducible (same input, same number).
 */
export function expectedPacksToComplete(
  missing: readonly MissingInPack[],
  structure: PackStructure,
  seed = 1,
): CompletionEstimate | null {
  const wanted = missing.filter((item) => item.copies > 0)
  if (wanted.length === 0) return { expectedPacks: 0, method: 'exact', ci95: null }
  if (wanted.some((item) => combineChances(item.chances, structure).probability <= 0)) return null
  if (wanted.length <= EXACT_COMPLETION_MAX_CARDS && wanted.every((item) => item.copies === 1)) {
    return { expectedPacks: exact(wanted, structure), method: 'exact', ci95: null }
  }
  return simulate(wanted, structure, seed)
}
