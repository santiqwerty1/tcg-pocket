/**
 * Probability of pulling wanted cards from a pack: a literal port of `pullRateForCardSubset` of the tracker's
 * `stats.ts` @ 3ab58f1 (GPL-3.0, docs/LICENCIAS.md), with two models:
 *
 * - `tracker`: reproduces the tracker, bugs included, so the numbers match its Overview page (PLAN §7 Fase 4 b).
 *   Bug 1: the denominator of a rarity always excludes babies, even in sets whose packs have no baby slot, so the
 *   mass of a rarity adds up to 107–125 % in B1…B4b. Bug 2: wanted cards are prefiltered by the pack's expansion
 *   before matching, so reprints of a functional card from another expansion never count (Hoopa ex in B4b: 0 %).
 * - `corrected` (default, DECISIONES 4.1): babies leave the denominator only when the set has a baby slot, and no
 *   prefilter by expansion.
 *
 * Shared approximations (docs/fase0/sobres.md §1.7): positions independent, duplicates allowed within a pack, rare
 * pack uniform per eligible card, Deluxe packs without rare pack.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardEdition, CardId, PackStructure, Rarity } from '../catalog/types.js'
import { BABY_SLOT, PACK_MIX, positionTable, RARE_PACK_RARITIES } from './rates.js'

export type PackModel = 'corrected' | 'tracker'
export const PACK_MODELS: readonly PackModel[] = ['corrected', 'tracker']

/** Chances of one edition per pack draw. */
export interface EditionChances {
  cardId: CardId
  /** Probability of this edition at each regular position (1-based index − 1). */
  perPosition: number[]
  /** Probability per draw of a rare pack (5-card sets; 5 draws per rare pack). */
  rare: number
  /** Probability in the sixth slot of a 6-card pack (sets with babies). */
  baby: number
}

/** A pack with what the model needs: its cards and the rarity counts used as denominators. */
export interface PackProfile {
  packId: string
  expansionId: string
  structure: PackStructure
  cards: CardEdition[]
  /** Cards per rarity: all, without babies, only babies. */
  count: Map<Rarity, { all: number; nonBaby: number; baby: number }>
  rareEligible: number
}

/** Profile of a pack, or null when its expansion has no pack structure (promos) or it is a set-wide pseudo pack. */
export function packProfile(packId: string, index: CatalogIndex): PackProfile | null {
  const pack = index.packById(packId)
  if (!pack) return null
  const expansion = index.expansionById(pack.expansionId)
  const structure = expansion?.packStructure
  if (!expansion || !structure) return null
  // «everypack» of a multi-pack set is not a pack you open: its cards are already in every named pack.
  if (pack.name === 'everypack' && expansion.packIds.length > 1) return null
  const cards = pack.cardIds.map((cardId) => index.cardById(cardId)).filter((card): card is CardEdition => !!card)
  const count = new Map<Rarity, { all: number; nonBaby: number; baby: number }>()
  let rareEligible = 0
  for (const card of cards) {
    const entry = count.get(card.rarity) ?? { all: 0, nonBaby: 0, baby: 0 }
    entry.all += 1
    if (card.baby) entry.baby += 1
    else entry.nonBaby += 1
    count.set(card.rarity, entry)
    if (RARE_PACK_RARITIES.has(card.rarity)) rareEligible += 1
  }
  return { packId, expansionId: pack.expansionId, structure, cards, count, rareEligible }
}

/** Chances of one edition of the pack (tracker loop body of `pullRateForCardSubset`). */
export function editionChances(card: CardEdition, profile: PackProfile, model: PackModel): EditionChances {
  const { structure } = profile
  const chances: EditionChances = {
    cardId: card.id,
    perPosition: Array.from({ length: structure.cardsPerPack }, () => 0),
    rare: 0,
    baby: 0,
  }
  // Promos never come out of packs.
  if (card.rarity === 'P') return chances
  const counts = profile.count.get(card.rarity) ?? { all: 0, nonBaby: 0, baby: 0 }
  if (card.baby && card.rarity !== 'Crown Rare' && structure.containsBabies) {
    chances.baby = (BABY_SLOT[card.rarity] ?? 0) / 100 / counts.baby
    return chances
  }
  // Crown Rare babies and the rest use the regular tables; the denominator is where bug 1 lives.
  const excludeBabies = model === 'tracker' || structure.containsBabies
  const k = card.rarity === 'Crown Rare' || !excludeBabies ? counts.all : counts.nonBaby
  if (k === 0) return chances
  for (let position = 1; position <= structure.cardsPerPack; position += 1) {
    chances.perPosition[position - 1] = (positionTable(structure, position)[card.rarity] ?? 0) / 100 / k
  }
  if (structure.cardsPerPack === 5 && RARE_PACK_RARITIES.has(card.rarity) && profile.rareEligible > 0) {
    chances.rare = 1 / profile.rareEligible
  }
  return chances
}

export interface PullOutcome {
  /** P(at least one of the cards in one pack), 0–1. */
  probability: number
  /** Expected number of those cards in one pack (copies). */
  expected: number
}

/** Combines the chances of a set of editions into one pack (tracker aggregation, disjoint mix of pack kinds). */
export function combineChances(chances: readonly EditionChances[], structure: PackStructure): PullOutcome {
  const perPosition = Array.from({ length: structure.cardsPerPack }, () => 0)
  let rare = 0
  let baby = 0
  for (const card of chances) {
    card.perPosition.forEach((value, at) => {
      perPosition[at] = (perPosition[at] ?? 0) + value
    })
    rare += card.rare
    baby += card.baby
  }
  const none = perPosition.reduce((product, value) => product * (1 - value), 1)
  const regular = perPosition.reduce((sum, value) => sum + value, 0)
  if (structure.cardsPerPack === 4) return { probability: 1 - none, expected: regular }
  const rarePack = PACK_MIX.rare * (1 - (1 - rare) ** 5)
  const rareExpected = PACK_MIX.rare * 5 * rare
  if (!structure.containsBabies) {
    return {
      probability: PACK_MIX.regular * (1 - none) + rarePack,
      expected: PACK_MIX.regular * regular + rareExpected,
    }
  }
  return {
    probability: PACK_MIX.regularWithBabies * (1 - none) + rarePack + PACK_MIX.sixCards * (1 - none * (1 - baby)),
    expected: PACK_MIX.regularWithBabies * regular + rareExpected + PACK_MIX.sixCards * (regular + baby),
  }
}

/**
 * Editions of the pack that count for a wanted list, as the tracker matches them. `byGroup` (the tracker's
 * deckbuilding mode) matches any edition of the same functional card. The tracker model prefilters the wanted
 * list by the pack's expansion (bug 2).
 */
export function matchWanted(
  profile: PackProfile,
  wanted: readonly CardEdition[],
  options: { model: PackModel; byGroup: boolean },
): CardEdition[] {
  const considered =
    options.model === 'tracker' ? wanted.filter((card) => card.expansionId === profile.expansionId) : wanted
  if (options.byGroup) {
    if (options.model === 'tracker') {
      const ids = new Set(considered.map((card) => card.internalId))
      return profile.cards.filter((card) => card.alternateVersionsRaw.some((id) => ids.has(id)))
    }
    const groups = new Set(considered.map((card) => card.functionalGroupId))
    return profile.cards.filter((card) => groups.has(card.functionalGroupId))
  }
  const ids = new Set(considered.map((card) => card.internalId))
  return profile.cards.filter((card) => ids.has(card.internalId))
}

/** P(≥1) and E[copies] of a wanted list from one pack. */
export function pullRate(
  profile: PackProfile,
  wanted: readonly CardEdition[],
  options: { model: PackModel; byGroup: boolean },
): PullOutcome & { matched: CardEdition[] } {
  const matched = matchWanted(profile, wanted, options)
  const chances = matched.map((card) => editionChances(card, profile, options.model))
  return { ...combineChances(chances, profile.structure), matched }
}

/** Packs to open for probability `q` of at least one hit: ⌈ln(1 − q) / ln(1 − p)⌉; null when p is 0. */
export function packsForConfidence(probability: number, q: number): number | null {
  if (probability <= 0) return null
  if (probability >= 1) return 1
  return Math.ceil(Math.log(1 - q) / Math.log(1 - probability))
}
