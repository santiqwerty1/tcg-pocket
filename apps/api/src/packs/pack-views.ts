/** Response shapes of the packs API (docs/API.md «Sobres»). Probabilities in percent (0–100). */
import type { CollectionGoal, ModelDifferenceReason, PackModel, Rarity } from '@tcg/domain'

export interface PackView {
  /** "<expansionId>/<name>", e.g. "B4b/deluxepackmega". */
  id: string
  expansionId: string
  expansionNameEs: string
  name: string
  nameEs: string
  available: boolean
  cardsPerPack: 4 | 5
  cardCount: number
  containsShinies: boolean
  containsBabies: boolean
  /** The tracker's Overview lists it (A4b/B4b: no). */
  inTrackerOverview: boolean
}

export interface RarityRuleView {
  rarity: string
  points: number | null
  verified: boolean
  tradeable: boolean
}

export interface PackRef {
  packId: string
  nameEs: string
  expansionId: string
  expansionNameEs: string
}

export interface PackRowView extends PackRef {
  available: boolean
  cardsPerPack: 4 | 5
  wanted: number
  probability: number
  expected: number
  expectedValue: number
  packsFor50: number | null
  packsFor90: number | null
  decks: { probability: number; expected: number } | null
  collection: { probability: number; expected: number } | null
  otherModel: { model: PackModel; probability: number; reasons: ModelDifferenceReason[] }
}

export interface MissingCardView {
  groupId: string
  nameEs: string
  missing: number
  weight: number
  decks: { deckId: string; name: string; priority: number; need: number }[]
  cheapest: { cardId: string; rarity: string; points: number; verified: boolean; tradeable: boolean } | null
  bestPack: (PackRef & { probability: number; packsPerCopy: number }) | null
  pointsInPacks: number | null
  advice: 'buy' | 'open' | null
}

export interface DeckCompletionView {
  deckId: string
  name: string
  priority: number
  missingCopies: number
  notInPacks: string[]
  /** Packs covering the most missing copies (`covered`), then the fewest expected packs to get them. */
  bestPacks: (PackRef & {
    covered: number
    expectedPacks: number
    method: 'exact' | 'simulation'
    ci95: [number, number] | null
  })[]
}

export interface RecommendationView {
  model: PackModel
  alpha: number
  collection: CollectionGoal | null
  onlyAvailable: boolean
  goals: { decks: { id: string; name: string; priority: number }[] }
  rows: PackRowView[]
  missing: MissingCardView[]
  decks: DeckCompletionView[]
  /** What the numbers assume (shown under the table). */
  assumptions: string[]
}

export type { Rarity }
