/**
 * Fase 44: what an archetype's lists play, card by card (T-014).
 *
 * - **Núcleo:** the cards ≥ 90 % of the lists play, and how many of the 20 slots they take; the rest are free.
 * - **Techs:** cards 10–90 % of the lists play, with the record of the lists that play them and of those that do not,
 *   and the difference between both (in points) with a bootstrap interval that resamples whole lists (the games of a
 *   list come together, H-011).
 * - **Copias:** cards some lists play once and others twice: two copies against one, the same way.
 *
 * A difference is «clara» when its p (from the bootstrap's standard error) passes Benjamini–Hochberg at 5 % over the
 * rows of its table: with 30
 * techs, one or two would look clear by chance alone. Players who play a card are not a random sample: a difference
 * says the lists that play it did better, not that the card is the reason.
 */
import type { CardId } from '../catalog/types.js'
import { seededRandom } from '../lab/mutate.js'
import { ORIENTATIVE_BELOW, recordGames } from '../stats/rates.js'
import { benjaminiHochberg, twoSidedP } from '../stats/tests.js'
import type { DatasetEntry, TournamentDataset } from './dataset.js'
import { cardUsage, type RecordRow, recordOf } from './stats.js'

/** Share (0–100) of the lists from which a card is part of the núcleo. */
export const CORE_MIN_SHARE = 90
/** Share (0–100) below which a card is too rare to compare. */
export const TECH_MIN_SHARE = 10
/** Lists on each side below which there is no difference to show. */
export const SPLIT_MIN_LISTS = 5
/** Bootstrap resamples. */
export const BOOTSTRAP_RESAMPLES = 1000
/** Default seed: the same lists give the same intervals. */
export const BOOTSTRAP_SEED = 44
/** Q of Benjamini–Hochberg for «clara». */
export const DIFFERENCE_Q = 0.05
const DECK_SIZE = 20

export interface RateDifference {
  /** First rate minus second, in points (0–100 scale). */
  value: number
  ci95: [number, number]
  /** Two-sided bootstrap p of «no difference». */
  p: number
  /** Passes Benjamini–Hochberg over its table. */
  clear: boolean
  /** The smaller side has fewer than 30 lists with games. */
  orientative: boolean
}

export interface CoreCard {
  groupId: CardId
  lists: number
  share: number
  averageCopies: number
  byCopies: number[]
}

export interface TechRow {
  groupId: CardId
  lists: number
  share: number
  averageCopies: number
  with: RecordRow
  without: RecordRow
  /** With minus without; null when a side has fewer than `SPLIT_MIN_LISTS` lists. */
  difference: RateDifference | null
}

export interface CopiesRow {
  groupId: CardId
  /** Lists that play the card (one or two copies). */
  lists: number
  share: number
  one: RecordRow
  two: RecordRow
  /** Two copies minus one; null when a side has fewer than `SPLIT_MIN_LISTS` lists. */
  difference: RateDifference | null
}

export interface ArchetypeCards {
  /** Lists counted: those whose every card maps to the catalog. */
  lists: number
  /** Lists left out because a card does not map to the catalog yet (a new set): they would undercount its cards. */
  incomplete: number
  resamples: number
  seed: number
  core: CoreCard[]
  /** Slots (of 20) the núcleo takes on average, and those left free. */
  coreSlots: number
  freeSlots: number
  techs: TechRow[]
  copies: CopiesRow[]
}

export interface ArchetypeCardsOptions {
  resamples?: number
  seed?: number
}

/** One comparison: which lists count on each side (indexes into the archetype's entries); `b` null = all the rest. */
interface Split {
  a: readonly number[]
  b: readonly number[] | null
}

const rateOf = (wins: number, games: number) => (games === 0 ? null : (wins / games) * 100)
const indexes = (entries: readonly DatasetEntry[]) => entries.map((_, i) => i)

function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN
  const position = (sorted.length - 1) * q
  const low = Math.floor(position)
  const high = Math.ceil(position)
  const lowValue = sorted[low] ?? 0
  const highValue = sorted[high] ?? lowValue
  return lowValue + (highValue - lowValue) * (position - low)
}

/**
 * Bootstrap of several differences over the same lists: each resample draws the lists once (with replacement) and
 * every split is measured on that draw, so the work is resamples × (lists + Σ split sizes).
 */
function bootstrapDifferences(
  entries: readonly DatasetEntry[],
  splits: readonly Split[],
  resamples: number,
  seed: number,
): ({ value: number; ci95: [number, number]; p: number; smaller: number } | null)[] {
  const wins = entries.map((entry) => entry.record.wins)
  const games = entries.map((entry) => recordGames(entry.record))
  const draws: number[][] = splits.map(() => [])
  const random = seededRandom(seed)
  const weight = new Array<number>(entries.length).fill(0)
  for (let round = 0; round < resamples; round += 1) {
    weight.fill(0)
    let totalWins = 0
    let totalGames = 0
    for (let i = 0; i < entries.length; i += 1) {
      const index = Math.floor(random() * entries.length)
      weight[index] = (weight[index] ?? 0) + 1
      totalWins += wins[index] ?? 0
      totalGames += games[index] ?? 0
    }
    splits.forEach((split, s) => {
      let winsA = 0
      let gamesA = 0
      for (const i of split.a) {
        const w = weight[i] ?? 0
        winsA += w * (wins[i] ?? 0)
        gamesA += w * (games[i] ?? 0)
      }
      let winsB = totalWins - winsA
      let gamesB = totalGames - gamesA
      if (split.b) {
        winsB = 0
        gamesB = 0
        for (const i of split.b) {
          const w = weight[i] ?? 0
          winsB += w * (wins[i] ?? 0)
          gamesB += w * (games[i] ?? 0)
        }
      }
      const a = rateOf(winsA, gamesA)
      const b = rateOf(winsB, gamesB)
      if (a !== null && b !== null) draws[s]?.push(a - b)
    })
  }
  const sum = (indexes: readonly number[], values: readonly number[]) =>
    indexes.reduce((total, i) => total + (values[i] ?? 0), 0)
  const allWins = sum(indexes(entries), wins)
  const allGames = sum(indexes(entries), games)
  const played = (selected: readonly number[]) => selected.filter((i) => (games[i] ?? 0) > 0).length
  const allPlayed = played(indexes(entries))
  return splits.map((split, s) => {
    const winsA = sum(split.a, wins)
    const gamesA = sum(split.a, games)
    const winsB = split.b ? sum(split.b, wins) : allWins - winsA
    const gamesB = split.b ? sum(split.b, games) : allGames - gamesA
    const rateA = rateOf(winsA, gamesA)
    const rateB = rateOf(winsB, gamesB)
    const sorted = [...(draws[s] ?? [])].sort((x, y) => x - y)
    // A side without games has no rate: nothing to compare (and no NaN interval).
    if (rateA === null || rateB === null || sorted.length === 0) return null
    const value = rateA - rateB
    // p from the bootstrap's standard error (normal): counting resamples past 0 cannot go under 2 / (B + 1) ≈ 0,002,
    // and with 26 rows or more Benjamini–Hochberg's first cut (0,05 / rows) would be out of reach (Codex on #17).
    const mean = sorted.reduce((total, d) => total + d, 0) / sorted.length
    const se = Math.sqrt(sorted.reduce((total, d) => total + (d - mean) ** 2, 0) / Math.max(1, sorted.length - 1))
    // No spread among the resamples (every list of a side with the same record) is not certainty: never «clara».
    const p = se > 0 ? twoSidedP(value / se) : 1
    // «Orientativo» by lists with games, like the cut of five (second review of #17): drops add no sample.
    const playedA = played(split.a)
    const smaller = Math.min(playedA, split.b ? played(split.b) : allPlayed - playedA)
    return { value, ci95: [percentile(sorted, 0.025), percentile(sorted, 0.975)], p, smaller }
  })
}

function withClear(
  results: readonly ({ value: number; ci95: [number, number]; p: number; smaller: number } | null)[],
): (RateDifference | null)[] {
  const present = results.filter((result) => result !== null)
  const clear = benjaminiHochberg(
    present.map((result) => result.p),
    DIFFERENCE_Q,
  )
  return results.map((result) =>
    result
      ? {
          value: result.value,
          ci95: result.ci95,
          p: result.p,
          // p (normal, from the bootstrap's SE) and the percentile interval can disagree near the edge: «clara» needs
          // both, so it never sits next to an interval that crosses 0 (Codex on #17).
          clear: (clear[present.indexOf(result)] ?? false) && (result.ci95[0] > 0 || result.ci95[1] < 0),
          orientative: result.smaller < ORIENTATIVE_BELOW,
        }
      : null,
  )
}

/** Núcleo, techs and copies of an archetype (its entries, from `entriesOfArchetype`). */
export function archetypeCards(
  dataset: TournamentDataset,
  allEntries: readonly DatasetEntry[],
  options: ArchetypeCardsOptions = {},
): ArchetypeCards {
  // A list with a card the catalog does not map keeps the card out of `groups`: it would count in the denominator
  // with one card missing (Codex on #17). `keyByGroup` is null exactly for those.
  const entries = allEntries.filter((entry) => entry.keyByGroup !== null)
  const resamples = options.resamples ?? BOOTSTRAP_RESAMPLES
  const seed = options.seed ?? BOOTSTRAP_SEED
  const usage = cardUsage(entries)
  const core = usage
    .filter((row) => row.share >= CORE_MIN_SHARE)
    .map((row) => ({
      groupId: row.groupId,
      lists: row.lists,
      share: row.share,
      averageCopies: row.averageCopies,
      byCopies: row.byCopies,
    }))
  const coreSlots = core.reduce((total, row) => total + row.averageCopies * (row.share / 100), 0)

  const all = indexes(entries)
  const copiesOf = (i: number, groupId: CardId) => entries[i]?.groups.get(groupId) ?? 0
  const pick = (selected: readonly number[]) => selected.map((i) => entries[i] as DatasetEntry)

  const techUsage = usage.filter((row) => row.share >= TECH_MIN_SHARE && row.share < CORE_MIN_SHARE)
  const techSplits = techUsage.map(
    (row): Split => ({
      a: all.filter((i) => copiesOf(i, row.groupId) >= 1),
      b: null,
    }),
  )
  const copiesUsage = usage.filter(
    (row) =>
      row.share >= TECH_MIN_SHARE &&
      (row.byCopies[1] ?? 0) >= SPLIT_MIN_LISTS &&
      (row.byCopies[2] ?? 0) >= SPLIT_MIN_LISTS,
  )
  const copiesSplits = copiesUsage.map(
    (row): Split => ({
      a: all.filter((i) => copiesOf(i, row.groupId) >= 2),
      b: all.filter((i) => copiesOf(i, row.groupId) === 1),
    }),
  )
  const other = (split: Split) => {
    if (split.b) return split.b
    const inA = new Set(split.a)
    return all.filter((i) => !inA.has(i))
  }

  // At least 5 lists *with games* on each side (a list can be 0-0-0: a drop before its first round).
  const playedLists = (selected: readonly number[]) =>
    selected.filter((i) => recordGames((entries[i] as DatasetEntry).record) > 0).length
  const comparable = (split: Split) =>
    playedLists(split.a) >= SPLIT_MIN_LISTS && playedLists(other(split)) >= SPLIT_MIN_LISTS
  const techComparable = techSplits.filter(comparable)
  const copiesComparable = copiesSplits.filter(comparable)
  const techDifferences = withClear(bootstrapDifferences(entries, techComparable, resamples, seed))
  const copiesDifferences = withClear(bootstrapDifferences(entries, copiesComparable, resamples, seed + 1))

  const techs = techUsage.map((row, i) => {
    const split = techSplits[i] as Split
    const at = techComparable.indexOf(split)
    return {
      groupId: row.groupId,
      lists: row.lists,
      share: row.share,
      averageCopies: row.averageCopies,
      with: recordOf(dataset, pick(split.a)),
      without: recordOf(dataset, pick(other(split))),
      difference: at === -1 ? null : (techDifferences[at] ?? null),
    }
  })
  const copies = copiesUsage.map((row, i) => {
    const split = copiesSplits[i] as Split
    return {
      groupId: row.groupId,
      lists: row.lists,
      share: row.share,
      two: recordOf(dataset, pick(split.a)),
      one: recordOf(dataset, pick(other(split))),
      difference: copiesDifferences[copiesComparable.indexOf(split)] ?? null,
    }
  })
  return {
    lists: entries.length,
    incomplete: allEntries.length - entries.length,
    resamples,
    seed,
    core,
    coreSlots,
    freeSlots: Math.max(0, DECK_SIZE - coreSlots),
    techs,
    copies,
  }
}

const points = (value: number) => {
  const rounded = Math.round(value * 10) / 10
  const text = Math.abs(rounded).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${text}`
}

/** «+5,2 puntos (IC −1,0 a +9,4)» and whether it is clear. */
export function formatRateDifferenceEs(difference: RateDifference | null): string {
  if (!difference) return 'sin datos suficientes de los dos lados'
  const [low, high] = difference.ci95
  const verdict = difference.clear ? 'clara' : 'puede ser azar'
  return `${points(difference.value)} puntos (IC ${points(low)} a ${points(high)}${difference.orientative ? ', orientativo' : ''}; ${verdict})`
}
