/**
 * Pack recommendation (BRIEF M4, PLAN §3.4): for every pack with a pack structure, P(≥1 wanted card), expected
 * wanted cards, expected value weighted by the goals, packs for 50 % / 90 %; for every missing card of the target
 * decks, its cheapest print in pack points, whether it can be traded and the best pack to open; for every target
 * deck, the expected packs to complete it from its best packs. Both models side by side, with the reason when they
 * differ (DECISIONES 4.1).
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardEdition, CardId, Rarity } from '../catalog/types.js'
import { type CompletionEstimate, expectedPacksToComplete, type MissingInPack } from './completion.js'
import { type CollectionGoal, collectionWanted, type DeckGoal, deckDeficits, type GroupDeficit } from './goals.js'
import {
  combineChances,
  editionChances,
  matchWanted,
  type PackModel,
  type PackProfile,
  packProfile,
  packsForConfidence,
} from './pullRate.js'

export interface RarityRule {
  /** Pack points to buy one copy; null = cannot be bought (promos). */
  points: number | null
  /** Confirmed in the game by the owner. */
  verified: boolean
  tradeable: boolean
}

/** Tracker craftingCost plus ✵/✵✵ from community sources, unverified (PLAN §3.4, B9). */
export const DEFAULT_RARITY_RULES: Readonly<Record<Rarity, RarityRule>> = {
  '◊': { points: 35, verified: false, tradeable: true },
  '◊◊': { points: 70, verified: false, tradeable: true },
  '◊◊◊': { points: 150, verified: false, tradeable: true },
  '◊◊◊◊': { points: 500, verified: false, tradeable: true },
  '☆': { points: 400, verified: false, tradeable: true },
  '☆☆': { points: 1250, verified: false, tradeable: false },
  '☆☆☆': { points: 1500, verified: false, tradeable: false },
  '✵': { points: 1000, verified: false, tradeable: false },
  '✵✵': { points: 1350, verified: false, tradeable: false },
  'Crown Rare': { points: 2500, verified: false, tradeable: false },
  P: { points: null, verified: false, tradeable: false },
}

/** Pack points earned per pack opened (of that pack's expansion). */
export const PACK_POINTS_PER_PACK = 5

/** Packs off by default: the Deluxe ex (A4b) left the shop (PLAN B9); the owner switches them. */
export const PACKS_OFF_BY_DEFAULT: ReadonlySet<string> = new Set(['A4b/deluxepack'])

export interface RecommendInput {
  index: CatalogIndex
  decks: readonly DeckGoal[]
  collection: CollectionGoal | null
  /** 0…1: weight of the decks goal against the collection goal (only matters when both are set). */
  alpha: number
  playable: (groupId: CardId) => number
  owned: (stockCardId: CardId) => number
  available: (packId: string) => boolean
  model: PackModel
  /** Leave unavailable packs out of the table and of the advice. */
  onlyAvailable: boolean
  rarityRule: (rarity: Rarity) => RarityRule
}

export type ModelDifferenceReason = 'babies' | 'reprints'

export interface PackRow {
  packId: string
  expansionId: string
  available: boolean
  cardsPerPack: 4 | 5
  /** Editions of the pack that count for some goal. */
  wanted: number
  probability: number
  expected: number
  /**
   * Score 0…1 that ranks the table: α × (deck value / best pack's deck value) + (1 − α) × (collection value / best
   * pack's collection value), where a goal's value is Σ weight × expected copies (deck weight = priority × missing).
   */
  expectedValue: number
  packsFor50: number | null
  packsFor90: number | null
  decks: { probability: number; expected: number } | null
  collection: { probability: number; expected: number } | null
  otherModel: { model: PackModel; probability: number; reasons: ModelDifferenceReason[] }
}

export interface PrintCost {
  cardId: CardId
  rarity: Rarity
  points: number
  verified: boolean
  tradeable: boolean
}

export interface MissingCardRow {
  groupId: CardId
  nameEs: string
  missing: number
  weight: number
  decks: GroupDeficit['decks']
  cheapest: PrintCost | null
  bestPack: { packId: string; probability: number; packsPerCopy: number } | null
  /** Points of the cheapest print, in packs opened (5 points each). */
  pointsInPacks: number | null
  /** «buy» when the points cost fewer packs than the expected packs to pull it. */
  advice: 'buy' | 'open' | null
}

export interface DeckCompletion {
  deckId: string
  name: string
  priority: number
  /** Copies missing in total. */
  missingCopies: number
  /** Missing cards no available pack gives (promos, retired packs). */
  notInPacks: string[]
  /**
   * Packs that cover the most missing copies, then the fewest expected packs to get the ones they cover. A deck
   * usually mixes expansions, so one pack rarely covers everything: `covered` says how much of it this pack gives.
   */
  bestPacks: ({ packId: string; covered: number } & CompletionEstimate)[]
}

export interface Recommendation {
  model: PackModel
  alpha: number
  rows: PackRow[]
  missing: MissingCardRow[]
  decks: DeckCompletion[]
}

function unique(cards: readonly CardEdition[]): CardEdition[] {
  const seen = new Map<CardId, CardEdition>()
  for (const card of cards) seen.set(card.id, card)
  return [...seen.values()]
}

function sameIds(a: readonly CardEdition[], b: readonly CardEdition[]): boolean {
  if (a.length !== b.length) return false
  const ids = new Set(a.map((card) => card.id))
  return b.every((card) => ids.has(card.id))
}

/** Cheapest print of a functional card that can be bought with pack points. */
export function cheapestPrint(
  index: CatalogIndex,
  groupId: CardId,
  rarityRule: (rarity: Rarity) => RarityRule,
): PrintCost | null {
  let best: PrintCost | null = null
  for (const card of index.cardsOfGroup(groupId)) {
    const rule = rarityRule(card.rarity)
    if (rule.points === null) continue
    if (best && best.points <= rule.points) continue
    best = {
      cardId: card.id,
      rarity: card.rarity,
      points: rule.points,
      verified: rule.verified,
      tradeable: rule.tradeable && (index.expansionById(card.expansionId)?.tradeable ?? false),
    }
  }
  return best
}

export function recommendPacks(input: RecommendInput): Recommendation {
  const { index, model } = input
  const deficits = deckDeficits(input.decks, index, input.playable)
  const deckWeight = new Map(deficits.map((deficit) => [deficit.groupId, deficit.weight]))
  const deckWanted = deficits.flatMap((deficit) =>
    deficit.listedCardIds.map((cardId) => index.cardById(cardId)).filter((card): card is CardEdition => !!card),
  )
  const colWanted = input.collection ? collectionWanted(index, input.owned, input.collection) : []
  const decksActive = deficits.length > 0
  const collectionActive = input.collection !== null
  const alpha = Math.min(1, Math.max(0, input.alpha))
  const deckFactor = decksActive ? (collectionActive ? alpha : 1) : 0
  const collectionFactor = collectionActive ? (decksActive ? 1 - alpha : 1) : 0

  const profiles = index.catalog.packs
    .map((pack) => packProfile(pack.id, index))
    .filter((profile): profile is PackProfile => profile !== null)

  const evaluate = (profile: PackProfile, which: PackModel) => {
    const byDecks = decksActive ? matchWanted(profile, deckWanted, { model: which, byGroup: true }) : []
    const byCollection = collectionActive ? matchWanted(profile, colWanted, { model: which, byGroup: false }) : []
    const all = unique([...byDecks, ...byCollection])
    const chances = new Map(all.map((card) => [card.id, editionChances(card, profile, which)]))
    const outcome = (cards: readonly CardEdition[]) =>
      combineChances(
        cards.map((card) => chances.get(card.id) as ReturnType<typeof editionChances>),
        profile.structure,
      )
    return { byDecks, byCollection, all, chances, outcome }
  }

  const rows: PackRow[] = []
  const rawValues = new Map<string, { deck: number; collection: number }>()
  for (const profile of profiles) {
    const available = input.available(profile.packId)
    if (input.onlyAvailable && !available) continue
    const current = evaluate(profile, model)
    const otherModel: PackModel = model === 'corrected' ? 'tracker' : 'corrected'
    const other = evaluate(profile, otherModel)
    // Raw value of each goal: Σ weight × expected copies (deck weight = priority × missing; collection = 1).
    let deckValue = 0
    for (const card of current.byDecks) {
      deckValue += (deckWeight.get(card.functionalGroupId) ?? 0) * current.outcome([card]).expected
    }
    let collectionValue = 0
    for (const card of current.byCollection) collectionValue += current.outcome([card]).expected
    rawValues.set(profile.packId, { deck: deckValue, collection: collectionValue })
    const total = current.outcome(current.all)
    const reasons: ModelDifferenceReason[] = []
    if (!sameIds(current.all, other.all)) reasons.push('reprints')
    const babyRarities = current.all.some(
      (card) => !profile.structure.containsBabies && (profile.count.get(card.rarity)?.baby ?? 0) > 0,
    )
    if (babyRarities) reasons.push('babies')
    rows.push({
      packId: profile.packId,
      expansionId: profile.expansionId,
      available,
      cardsPerPack: profile.structure.cardsPerPack,
      wanted: current.all.length,
      probability: total.probability,
      expected: total.expected,
      expectedValue: 0,
      packsFor50: packsForConfidence(total.probability, 0.5),
      packsFor90: packsForConfidence(total.probability, 0.9),
      decks: decksActive ? current.outcome(current.byDecks) : null,
      collection: collectionActive ? current.outcome(current.byCollection) : null,
      otherModel: { model: otherModel, probability: other.outcome(other.all).probability, reasons },
    })
  }
  // Each goal is scaled to its best pack before weighing with α, so α means what it says: a collection goal with
  // thousands of wanted editions does not drown a deck missing one card (DECISIONES 4.4).
  const maxDeck = Math.max(0, ...[...rawValues.values()].map((value) => value.deck))
  const maxCollection = Math.max(0, ...[...rawValues.values()].map((value) => value.collection))
  for (const row of rows) {
    const value = rawValues.get(row.packId) ?? { deck: 0, collection: 0 }
    row.expectedValue =
      (maxDeck > 0 ? (deckFactor * value.deck) / maxDeck : 0) +
      (maxCollection > 0 ? (collectionFactor * value.collection) / maxCollection : 0)
  }
  rows.sort(
    (a, b) =>
      b.expectedValue - a.expectedValue ||
      b.probability - a.probability ||
      a.packId.localeCompare(b.packId, 'en', { numeric: true }),
  )

  // Per missing card: cost to buy and the best pack to open (available packs only).
  const openable = profiles.filter((profile) => input.available(profile.packId))
  const groupChances = (profile: PackProfile, deficit: GroupDeficit) => {
    const listed = deficit.listedCardIds.map((cardId) => index.cardById(cardId)).filter((c): c is CardEdition => !!c)
    return matchWanted(profile, listed, { model, byGroup: true }).map((card) => editionChances(card, profile, model))
  }
  const missing: MissingCardRow[] = deficits.map((deficit) => {
    let bestPack: MissingCardRow['bestPack'] = null
    for (const profile of openable) {
      const probability = combineChances(groupChances(profile, deficit), profile.structure).probability
      if (probability > 0 && (!bestPack || probability > bestPack.probability)) {
        bestPack = { packId: profile.packId, probability, packsPerCopy: 1 / probability }
      }
    }
    const cheapest = cheapestPrint(index, deficit.groupId, input.rarityRule)
    const pointsInPacks = cheapest ? cheapest.points / PACK_POINTS_PER_PACK : null
    const advice =
      pointsInPacks === null
        ? bestPack
          ? 'open'
          : null
        : !bestPack || pointsInPacks <= bestPack.packsPerCopy
          ? 'buy'
          : 'open'
    return {
      groupId: deficit.groupId,
      nameEs: deficit.nameEs,
      missing: deficit.missing,
      weight: deficit.weight,
      decks: deficit.decks,
      cheapest,
      bestPack,
      pointsInPacks,
      advice,
    }
  })

  // Per target deck: expected packs to complete it from each available pack, best three.
  const decks: DeckCompletion[] = input.decks
    .filter((goal) => goal.priority > 0)
    .map((goal) => {
      const own = deckDeficits([goal], index, input.playable)
      const notInPacks = own
        .filter((deficit) =>
          openable.every(
            (profile) => combineChances(groupChances(profile, deficit), profile.structure).probability <= 0,
          ),
        )
        .map((deficit) => deficit.nameEs)
      const reachable = own.filter((deficit) => !notInPacks.includes(deficit.nameEs))
      const bestPacks: DeckCompletion['bestPacks'] = []
      if (reachable.length > 0) {
        for (const profile of openable) {
          // Only the missing cards this pack can give: the estimate is for those.
          const items: MissingInPack[] = reachable
            .map((deficit) => ({
              groupId: deficit.groupId,
              copies: deficit.missing,
              chances: groupChances(profile, deficit),
            }))
            .filter((item) => combineChances(item.chances, profile.structure).probability > 0)
          if (items.length === 0) continue
          const estimate = expectedPacksToComplete(items, profile.structure)
          if (!estimate) continue
          const covered = items.reduce((sum, item) => sum + item.copies, 0)
          bestPacks.push({ packId: profile.packId, covered, ...estimate })
        }
        bestPacks.sort((a, b) => b.covered - a.covered || a.expectedPacks - b.expectedPacks)
      }
      return {
        deckId: goal.deckId,
        name: goal.name,
        priority: goal.priority,
        missingCopies: own.reduce((sum, deficit) => sum + deficit.missing, 0),
        notInPacks,
        bestPacks: bestPacks.slice(0, 3),
      }
    })

  return { model, alpha, rows, missing, decks }
}
