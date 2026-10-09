/**
 * Expected packs to get every missing card of a deck from one pack (coupon collector with unequal chances,
 * docs/fase0/sobres.md §4). Exact by inclusion–exclusion when every card is missing once and there are at most
 * 12 of them; otherwise a seeded Monte Carlo of the same pack model, reported with its 95 % interval.
 *
 * H-012 (Fase 37): every pack opened also gives pack points of its expansion; a missing card whose print that points
 * pay for is bought as soon as they reach its cost (a ◊◊◊◊ costs 500 points: 100 packs at most, not «until it comes
 * out»). With points the estimate is always simulated.
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
  /** Points (of this pack's expansion) its cheapest print costs; null or absent: not payable with them. */
  pointsCost?: number | null
}

/** Pack points while opening one pack: the balance saved and what each pack adds. */
export interface PackPoints {
  saved: number
  perPack: number
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

/** The draw tables of one pack for the cards still missing: the base of every simulation. */
export interface PreparedPack {
  missing: readonly MissingInPack[]
  structure: PackStructure
  regular: { upTo: number; group: number }[][]
  rare: { upTo: number; group: number }[]
  baby: { upTo: number; group: number }[]
}

export function preparePack(missing: readonly MissingInPack[], structure: PackStructure): PreparedPack {
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
  return {
    missing,
    structure,
    regular: Array.from({ length: positions }, (_, at) => slot((chance) => chance.perPosition[at] ?? 0)),
    rare: slot((chance) => chance.rare),
    baby: slot((chance) => chance.baby),
  }
}

/** One run: packs opened until every missing copy came out or was bought with the points (capped). */
export function packsNeededOnce(prepared: PreparedPack, random: () => number, points?: PackPoints): number {
  const { missing, structure, regular, rare, baby } = prepared
  const positions = structure.cardsPerPack
  const draw = (entries: { upTo: number; group: number }[], have: number[]) => {
    const u = random()
    const hit = entries.find((entry) => u < entry.upTo)
    if (hit) have[hit.group] = (have[hit.group] ?? 0) + 1
  }
  const have = missing.map(() => 0)
  let balance = points?.saved ?? 0
  // The cheapest missing copy the balance pays for, again and again.
  const buy = () => {
    if (!points) return
    for (;;) {
      let pick = -1
      missing.forEach((item, at) => {
        const cost = item.pointsCost
        if (cost == null || cost <= 0 || (have[at] ?? 0) >= item.copies || cost > balance) return
        if (pick === -1 || cost < (missing[pick]?.pointsCost ?? Number.POSITIVE_INFINITY)) pick = at
      })
      if (pick === -1) return
      balance -= missing[pick]?.pointsCost ?? 0
      have[pick] = (have[pick] ?? 0) + 1
    }
  }
  buy()
  let packs = 0
  while (packs < SIMULATION_PACK_CAP && missing.some((item, at) => (have[at] ?? 0) < item.copies)) {
    packs += 1
    if (points) {
      balance += points.perPack
    }
    const kind = random()
    if (positions === 5 && kind < PACK_MIX.rare) {
      for (let i = 0; i < 5; i += 1) draw(rare, have)
      continue
    }
    for (const entries of regular) draw(entries, have)
    if (structure.containsBabies && positions === 5 && kind >= PACK_MIX.rare + PACK_MIX.regularWithBabies) {
      draw(baby, have)
    }
    buy()
  }
  return packs
}

function simulate(
  missing: readonly MissingInPack[],
  structure: PackStructure,
  seed: number,
  points?: PackPoints,
): CompletionEstimate {
  const random = seededRandom(seed)
  const prepared = preparePack(missing, structure)
  const results: number[] = []
  for (let run = 0; run < SIMULATION_RUNS; run += 1) results.push(packsNeededOnce(prepared, random, points))
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
  points?: PackPoints,
): CompletionEstimate | null {
  const wanted = missing.filter((item) => item.copies > 0)
  if (wanted.length === 0) return { expectedPacks: 0, method: 'exact', ci95: null }
  if (wanted.some((item) => combineChances(item.chances, structure).probability <= 0)) return null
  const payable = points !== undefined && wanted.some((item) => item.pointsCost != null && item.pointsCost > 0)
  if (!payable && wanted.length <= EXACT_COMPLETION_MAX_CARDS && wanted.every((item) => item.copies === 1)) {
    return { expectedPacks: exact(wanted, structure), method: 'exact', ci95: null }
  }
  return simulate(wanted, structure, seed, payable ? points : undefined)
}

/** Packs of a plan (several packs opened one after the other): mean, median and the 80th percentile. */
export interface PlanPacks {
  mean: number
  p50: number
  p80: number
}

const PLAN_RUNS = 600

/**
 * A completion plan: each group of missing cards from its own pack, opened one pack after the other. Simulated as a
 * whole (seeded) so the median and the «mala suerte» percentile are of the total, not sums of averages.
 */
export function planPacks(
  groups: readonly { missing: readonly MissingInPack[]; structure: PackStructure; points?: PackPoints }[],
  seed = 1,
): PlanPacks {
  const prepared = groups
    .map((group) => ({ ...group, missing: group.missing.filter((item) => item.copies > 0) }))
    .filter((group) => group.missing.length > 0)
    .map((group) => ({ pack: preparePack(group.missing, group.structure), points: group.points }))
  if (prepared.length === 0) return { mean: 0, p50: 0, p80: 0 }
  const random = seededRandom(seed)
  const totals: number[] = []
  for (let run = 0; run < PLAN_RUNS; run += 1) {
    totals.push(prepared.reduce((sum, group) => sum + packsNeededOnce(group.pack, random, group.points), 0))
  }
  totals.sort((a, b) => a - b)
  const at = (q: number) => totals[Math.min(totals.length - 1, Math.floor(q * totals.length))] ?? 0
  return { mean: totals.reduce((sum, value) => sum + value, 0) / totals.length, p50: at(0.5), p80: at(0.8) }
}

/** Free packs a day in the game (one every 12 hours). */
export const DEFAULT_PACKS_PER_DAY = 2
/** Pack hourglasses per pack (one hour each, 12 hours a pack). */
export const HOURGLASSES_PER_PACK = 12

/** Days to open `packs` at `packsPerDay`, after spending the hourglasses saved. */
export function daysForPacks(packs: number, packsPerDay: number, hourglasses = 0): number {
  const fromHourglasses = Math.floor(Math.max(0, hourglasses) / HOURGLASSES_PER_PACK)
  const left = Math.max(0, packs - fromHourglasses)
  return packsPerDay <= 0 ? Number.POSITIVE_INFINITY : Math.ceil(left / packsPerDay)
}
