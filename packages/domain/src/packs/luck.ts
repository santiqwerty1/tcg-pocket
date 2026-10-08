/**
 * Suerte de los sobres (Fase 17): what came into the collection between two CSV imports, by rarity, against what
 * packs give per card (the published rates of each expansion's pack structure). Approximate on purpose: the CSV says
 * what you own, not where it came from, so trades, Wonder Pick and rewards count too; promos are left out. Copies are
 * counted per version (internal id), so a reprint sharing its id is not counted twice.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { PackStructure, Rarity } from '../catalog/types.js'
import { type LuckCheck, luckCheck } from '../stats/luck.js'
import { positionTable } from './rates.js'

/** Rarities that count as «rare» here: art rares and above. */
export const RARE_TIER: ReadonlySet<Rarity> = new Set(['☆', '☆☆', '☆☆☆', '✵', '✵✵', 'Crown Rare'])

/** Share of a pack's cards (0–1) of each rarity, averaged over its positions (rare and 6-card packs aside). */
export function rarityShareOfPack(structure: PackStructure): Partial<Record<Rarity, number>> {
  const share: Partial<Record<Rarity, number>> = {}
  for (let position = 1; position <= structure.cardsPerPack; position++) {
    for (const [rarity, percent] of Object.entries(positionTable(structure, position)) as [Rarity, number][]) {
      share[rarity] = (share[rarity] ?? 0) + percent / 100 / structure.cardsPerPack
    }
  }
  return share
}

export interface PackLuckTier {
  /** Copies of the tier that came in. */
  observed: number
  /** Copies expected among the ones that came in (0–100 % of them, and the count). */
  expectedShare: number
  expected: number
  check: LuckCheck
}

export interface PackLuck {
  /** Copies that came in (promos left out). */
  gained: number
  byRarity: Partial<Record<Rarity, number>>
  /** ☆ and above. */
  rare: PackLuckTier
  /** ◊◊◊◊ (the ex). */
  ex: PackLuckTier
  /** Packs it would be if everything came from packs (cards per pack of each expansion). */
  packsEstimate: number
}

/**
 * Luck between two snapshots of the collection: copies per internal id before and after. Each gained copy is
 * expected at the rates of its own expansion's packs (the earliest edition of the version).
 */
export function packLuck(
  before: ReadonlyMap<number, number>,
  after: ReadonlyMap<number, number>,
  index: CatalogIndex,
): PackLuck {
  const byRarity: Partial<Record<Rarity, number>> = {}
  let gained = 0
  let expectedRare = 0
  let expectedEx = 0
  let packs = 0
  const shares = new Map<string, Partial<Record<Rarity, number>>>()
  for (const [internalId, count] of after) {
    const delta = count - (before.get(internalId) ?? 0)
    if (delta <= 0) continue
    const card = index.cardsByInternalId(internalId)[0]
    if (!card || card.rarity === 'P') continue
    const structure = index.expansionById(card.expansionId)?.packStructure
    if (!structure) continue
    let share = shares.get(card.expansionId)
    if (!share) {
      share = rarityShareOfPack(structure)
      shares.set(card.expansionId, share)
    }
    gained += delta
    byRarity[card.rarity] = (byRarity[card.rarity] ?? 0) + delta
    expectedRare += delta * [...RARE_TIER].reduce((sum, rarity) => sum + (share[rarity] ?? 0), 0)
    expectedEx += delta * (share['◊◊◊◊'] ?? 0)
    packs += delta / structure.cardsPerPack
  }
  const tier = (observed: number, expected: number): PackLuckTier => {
    const expectedShare = gained === 0 ? 0 : (expected / gained) * 100
    return {
      observed,
      expected,
      expectedShare,
      check: luckCheck({ wins: observed, losses: gained - observed, ties: 0 }, expectedShare),
    }
  }
  const rareObserved = [...RARE_TIER].reduce((sum, rarity) => sum + (byRarity[rarity] ?? 0), 0)
  return {
    gained,
    byRarity,
    rare: tier(rareObserved, expectedRare),
    ex: tier(byRarity['◊◊◊◊'] ?? 0, expectedEx),
    packsEstimate: packs,
  }
}
