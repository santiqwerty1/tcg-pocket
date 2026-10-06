/**
 * Core catalog types. Vocabulary (docs/PLAN.md §3, §4.1):
 * - CardEdition: one concrete printed card, identified by its tracker `card_id` (e.g. "B4b-372").
 * - FunctionalGroup: same name + same rules text; the unit used for deck building and playable copies.
 *   Equals the tracker's `alternate_versions` group. Id = earliest card id of the group in catalog order.
 * - StockUnit: editions that share the tracker's `internal_id` and therefore share the owned quantity
 *   (A1-1 and A4b-1 are one stock unit). Id = earliest card id of the unit in catalog order.
 * Portions of the data model derive from marcelpanse/tcg-pocket-collection-tracker (GPL-3.0) @ 3ab58f1.
 */

/** Tracker card id, e.g. "A1-1", "B4b-372", "P-A-7". The identity of an edition. */
export type CardId = string
/** Expansion id, e.g. "A1", "A1a", "B4b", "P-A". */
export type ExpansionId = string

export const RARITIES = ['◊', '◊◊', '◊◊◊', '◊◊◊◊', '☆', '☆☆', '☆☆☆', '✵', '✵✵', 'Crown Rare', 'P'] as const
export type Rarity = (typeof RARITIES)[number]

export type CardType = 'pokemon' | 'trainer'
export type EvolutionType = 'basic' | 'stage1' | 'stage2' | 'supporter' | 'item' | 'tool' | 'stadium'

export const ENERGY_TYPES = [
  'grass',
  'fire',
  'water',
  'lightning',
  'psychic',
  'fighting',
  'darkness',
  'metal',
  'dragon',
  'colorless',
] as const
export type EnergyType = (typeof ENERGY_TYPES)[number]
/** Energies a deck can select in the Energy Zone (dragon and colorless are not selectable). */
export const SELECTABLE_ENERGIES = [
  'grass',
  'fire',
  'water',
  'lightning',
  'psychic',
  'fighting',
  'darkness',
  'metal',
] as const
export type SelectableEnergy = (typeof SELECTABLE_ENERGIES)[number]

export interface Attack {
  /** Energy cost; the tracker's literal 'No Cost' is normalized to []. */
  cost: EnergyType[]
  name: string
  /** Printed damage ("30", "30+", "50x") or null when the attack has no damage (tracker noise removed). */
  damage: string | null
  /** Effect text or null when the tracker says 'No effect'. */
  effect: string | null
}

export interface Ability {
  name: string
  effect: string
}

export type NameEsSource = 'tracker' | 'fallback_en' | 'override'

export interface CardEdition {
  id: CardId
  expansionId: ExpansionId
  number: number
  /** Tracker internal id. Versioned attribute, NOT identity; never decode it. */
  internalId: number
  /** Id of the stock unit this edition belongs to (card id of its earliest edition). */
  stockCardId: CardId
  /** Id of the functional group (card id of its earliest edition). */
  functionalGroupId: CardId
  /** True when this edition is the tracker's `alternate_versions[0]` (the deck-building representative). */
  isDisplayEdition: boolean
  nameEn: string
  nameEs: string
  nameEsSource: NameEsSource
  hp: number | null
  /** 'trainer' for trainer cards; otherwise the Pokémon's energy type. */
  energy: EnergyType | 'trainer'
  cardType: CardType
  evolutionType: EvolutionType
  /** English name of the pre-evolution (from deckgym database.json), null for basics and trainers. */
  evolvesFrom: string | null
  /** Trainer item played as a 40 HP basic Pokémon (deckgym trainer_card_type = Fossil). */
  isFossil: boolean
  ex: boolean
  /** Prize points given to the opponent when knocked out: 3 Mega ex, 2 ex, 1 otherwise (trainers: 0). */
  prizePoints: 0 | 1 | 2 | 3
  baby: boolean
  rarity: Rarity
  /** Tracker pack name ('everypack' or a named pack such as 'mewtwopack'). */
  pack: string
  artist: string
  attacks: Attack[]
  ability: Ability | null
  /** Weakness energy type, or null (trainers and 'none'). */
  weakness: EnergyType | null
  retreat: number | null
  /** Link to the tracker's image; images are never stored. */
  imageUrl: string
  /** deckgym id, e.g. "A1 001". */
  engineId: string
  /** Lower-cased searchable text: names, id and rules text. */
  searchText: string
  /** The tracker's `alternate_versions` as received (internal ids, tracker order). */
  alternateVersionsRaw: number[]
}

export interface FunctionalGroup {
  id: CardId
  /** Edition shown by default when building decks (tracker `alternate_versions[0]`). */
  displayCardId: CardId
  nameEn: string
  nameEs: string
  cardType: CardType
  /** Hash of the normalized rules text (must be identical for every edition of the group). */
  rulesHash: string
  cardIds: CardId[]
  stockCardIds: CardId[]
}

export interface StockUnit {
  id: CardId
  internalId: number
  functionalGroupId: CardId
  cardIds: CardId[]
}

export interface PackStructure {
  cardsPerPack: 4 | 5
  containsShinies: boolean
  containsBabies: boolean
  /** Scraper directive: same-rarity reprints of this set share internal ids. Not used in probabilities. */
  containsLinkedCards: boolean
}

export interface Expansion {
  id: ExpansionId
  trackerInternalId: number
  /** Tracker slug, e.g. 'geneticapex'. */
  slug: string
  nameEn: string
  nameEs: string
  /** Position in catalog order (A1 = 0 …, promos last). */
  sortOrder: number
  isPromo: boolean
  tradeable: boolean
  /** The tracker's `openable` flag, informative only (A4b/B4b are false there). */
  openableTracker: boolean
  packStructure: PackStructure | null
  packIds: string[]
}

export interface Pack {
  /** "<expansionId>/<name>", e.g. "A1/mewtwopack". */
  id: string
  expansionId: ExpansionId
  name: string
  nameEs: string
  color: string | null
  /** Card ids obtainable from this pack: cards with pack === name or pack === 'everypack'. */
  cardIds: CardId[]
}

/** Pack-point cost per rarity (tracker craftingCost). Missing rarities are absent. */
export type CraftingCost = Partial<Record<Rarity, number>>

export interface Catalog {
  /** Commit of marcelpanse/tcg-pocket-collection-tracker the data comes from. */
  trackerCommit: string
  /** Commit of bcollazo/deckgym-core the engine data comes from. */
  engineRev: string
  expansions: Expansion[]
  packs: Pack[]
  cards: CardEdition[]
  groups: FunctionalGroup[]
  stockUnits: StockUnit[]
  craftingCost: CraftingCost
}
