/**
 * Builds a `Catalog` from the raw tracker files, the deckgym data and the pinned commits (PLAN §3.1, §4.1).
 * Pure: the caller reads the files; this module only parses, normalizes and derives.
 *
 * Catalog order = order of `cards.json` (A1 … B4b, then P-A, P-B). Identity = `card_id`.
 * - Stock unit: cards sharing `internal_id`; id = earliest card.
 * - Functional group: connected components of `alternate_versions`, expanded through `internal_id → [cards]`
 *   (450 internal ids map to 2–3 cards); id = earliest card; `displayCardId` = earliest card whose internal id is
 *   `alternate_versions[0]` (the tracker's deck-building id, including its 3 overrides).
 */

import { type EngineConflict, joinEngineData, trackerIdToEngineId } from './engine.js'
import { type Mission, parseMissions } from './missions.js'
import { cardNameEs, type NameTranslations } from './names.js'
import {
  buildSearchText,
  isDamageNoise,
  normalizeAbility,
  normalizeAttack,
  normalizeWeakness,
  prizePointsOf,
  rulesHashOf,
} from './normalize.js'
import {
  parseCraftingCostFromCardsDb,
  parseExpansionIds,
  parseExpansionsFromCardsDb,
  type TrackerExpansion,
} from './parseCardsDb.js'
import {
  parseEngineCards,
  parseLocaleTable,
  parseTrackerCards,
  parseTranslationTable,
  TRACKER_CARD_FIELDS,
  TRACKER_IGNORED_FIELDS,
  type TrackerCard,
} from './schemas.js'
import type {
  CardEdition,
  CardId,
  CardType,
  Catalog,
  Expansion,
  ExpansionId,
  FunctionalGroup,
  Pack,
  PackStructure,
  StockUnit,
} from './types.js'

export const TRACKER_RAW_BASE = 'https://raw.githubusercontent.com/marcelpanse/tcg-pocket-collection-tracker'
export const EVERY_PACK = 'everypack'

export interface BuildCatalogInput {
  /** Parsed `frontend/assets/cards.json`. */
  cardsJson: unknown
  /** Parsed `frontend/assets/{pokemon,trainers,tools}_translations.json`. */
  translations: { pokemon: unknown; trainers: unknown; tools: unknown }
  /** Source text of `frontend/src/lib/CardsDB.ts`. */
  cardsDbSource: string
  /** Source text of `frontend/src/types/index.ts` (cross-checks `expansionIds` against CardsDB). */
  typesIndexSource: string
  /** Parsed `frontend/public/locales/es-ES/common/sets.json` and `packs.json`. */
  esSets: unknown
  esPacks: unknown
  /** Optional `en-US` counterparts; without them `nameEn` falls back to the slug / pack name. */
  enSets?: unknown
  enPacks?: unknown
  /** Reduced deckgym entries (see `engineCardsFromDatabaseJson`). */
  engineCards: unknown
  trackerCommit: string
  engineRev: string
  /** `assets/themed-collections/<expansion>-missions.json`, parsed, by expansion id (Fase 8). Optional. */
  missions?: Record<string, unknown> | undefined
  /** `assets/image-locales.json` (card id → bitmask of image locales), parsed. Optional: without it, English images. */
  imageLocales?: unknown
}

export interface BuildCounts {
  cards: number
  expansions: number
  packs: number
  groups: number
  stockUnits: number
  /** Stock units with 2+ editions (linked reprints). */
  linkedStockUnits: number
  pokemon: number
  trainers: number
  ex: number
  fossils: number
  /** Attacks whose cost was the literal 'No Cost'. */
  noCostAttacks: number
  /** Attacks whose scraped damage was a leaked word (restored into the attack name). */
  damageNoiseAttacks: number
  /** Trainer effects that carried the 'Illustrated by' tail. */
  cleanedTrainerEffects: number
  /** Themed-collection missions kept (Fase 8). */
  missions: number
}

export interface BuildReport {
  trackerCommit: string
  engineRev: string
  counts: BuildCounts
  /** Cards whose Spanish name fell back to English. */
  nameFallbacks: CardId[]
  engineConflicts: EngineConflict[]
  engineMissing: CardId[]
  unmatchedEngineIds: string[]
  /** Group ids whose editions do not all share the same rules hash (should be empty). */
  groupsWithMixedRules: CardId[]
  /** Group ids whose editions do not all share the same English name (should be empty). */
  groupsWithMixedNames: CardId[]
  /** Human-readable anomalies that did not stop the build. */
  warnings: string[]
}

export interface BuildResult {
  catalog: Catalog
  report: BuildReport
}

export class CatalogBuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CatalogBuildError'
  }
}

function cardNumberOf(cardId: CardId, expansionId: ExpansionId): number {
  const prefix = `${expansionId}-`
  if (!cardId.startsWith(prefix))
    throw new CatalogBuildError(`Card ${cardId} does not belong to expansion ${expansionId}`)
  const number = Number.parseInt(cardId.slice(prefix.length), 10)
  if (!Number.isInteger(number) || number <= 0) throw new CatalogBuildError(`Card ${cardId}: invalid number`)
  return number
}

export type ImageLocale = 'en-US' | 'es-ES'

export function trackerImageUrl(trackerCommit: string, cardId: CardId, locale: ImageLocale = 'en-US'): string {
  return `${TRACKER_RAW_BASE}/${trackerCommit}/frontend/public/images/${locale}/${cardId}.webp`
}

/** Bit of es-ES in the tracker's image manifest (`[en-US, es-ES, fr-FR, de-DE, it-IT, pt-BR]`). */
const ES_IMAGE_BIT = 1 << 1

/** Fase 22: the Spanish image when the tracker has one (its manifest), else the English one. */
export function preferredImageLocale(imageLocales: unknown, cardId: CardId): ImageLocale {
  if (typeof imageLocales !== 'object' || imageLocales === null) return 'en-US'
  const mask = (imageLocales as Record<string, unknown>)[cardId]
  return typeof mask === 'number' && (mask & ES_IMAGE_BIT) !== 0 ? 'es-ES' : 'en-US'
}

/** Disjoint sets over card indexes; the root of every set is its smallest index (= earliest card). */
class EarliestRootUnionFind {
  private readonly parent: number[]
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i)
  }
  find(i: number): number {
    let root = i
    while (this.parent[root] !== root) root = this.parent[root] as number
    let current = i
    while (this.parent[current] !== root) {
      const next = this.parent[current] as number
      this.parent[current] = root
      current = next
    }
    return root
  }
  union(a: number, b: number): void {
    const rootA = this.find(a)
    const rootB = this.find(b)
    if (rootA === rootB) return
    if (rootA < rootB) this.parent[rootB] = rootA
    else this.parent[rootA] = rootB
  }
}

interface ParsedInput {
  cards: TrackerCard[]
  translations: NameTranslations
  expansions: TrackerExpansion[]
  expansionIds: ExpansionId[]
  esSets: Record<string, string>
  esPacks: Record<string, string>
  enSets: Record<string, string>
  enPacks: Record<string, string>
}

function parseInput(input: BuildCatalogInput): ParsedInput {
  return {
    cards: parseTrackerCards(input.cardsJson),
    translations: {
      pokemon: parseTranslationTable(input.translations.pokemon),
      trainers: parseTranslationTable(input.translations.trainers),
      tools: parseTranslationTable(input.translations.tools),
    },
    expansions: parseExpansionsFromCardsDb(input.cardsDbSource),
    expansionIds: parseExpansionIds(input.typesIndexSource),
    esSets: parseLocaleTable(input.esSets),
    esPacks: parseLocaleTable(input.esPacks),
    enSets: input.enSets === undefined ? {} : parseLocaleTable(input.enSets),
    enPacks: input.enPacks === undefined ? {} : parseLocaleTable(input.enPacks),
  }
}

const KNOWN_TRACKER_FIELDS: ReadonlySet<string> = new Set([...TRACKER_CARD_FIELDS, ...TRACKER_IGNORED_FIELDS])

/**
 * The `cards.json` fields the catalog neither reads nor ignores on purpose, with how many cards carry each: the schema
 * drops them silently, so the report names them («a field may carry a second type»). Run after the schema passed.
 */
export function unknownTrackerFields(cardsJson: unknown): string[] {
  if (!Array.isArray(cardsJson)) return []
  const counts = new Map<string, number>()
  for (const row of cardsJson) {
    if (!row || typeof row !== 'object') continue
    for (const key of Object.keys(row)) {
      if (!KNOWN_TRACKER_FIELDS.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `cards.json has a field the catalog does not read: '${key}' (${count} cards)`)
}

/**
 * H-008: the pack rates exist for packs of 4 and 5 cards. A new size keeps the expansion and its cards but leaves it
 * out of the pack math, with a warning, instead of failing the whole sync.
 */
function knownPackStructure(
  expansionId: string,
  structure: (Omit<PackStructure, 'cardsPerPack'> & { cardsPerPack: number }) | null,
  warnings: string[],
): PackStructure | null {
  if (!structure) return null
  if (structure.cardsPerPack === 4 || structure.cardsPerPack === 5) {
    return { ...structure, cardsPerPack: structure.cardsPerPack }
  }
  warnings.push(
    `Expansion ${expansionId}: packs of ${structure.cardsPerPack} cards have no known rates; left out of the pack math`,
  )
  return null
}

export function buildCatalogWithReport(input: BuildCatalogInput): BuildResult {
  if (!input.trackerCommit) throw new CatalogBuildError('trackerCommit is required')
  if (!input.engineRev) throw new CatalogBuildError('engineRev is required')
  const parsed = parseInput(input)
  const { cards, translations } = parsed
  const warnings: string[] = []
  const craftingCost = parseCraftingCostFromCardsDb(input.cardsDbSource)
  const engineJoin = joinEngineData(cards, parseEngineCards(input.engineCards))
  // C1: a field the catalog does not know may carry something it should read (a second type written apart, say).
  for (const warning of unknownTrackerFields(input.cardsJson)) warnings.push(warning)

  // --- Expansions in catalog order (first appearance in cards.json), then CardsDB-only ones. ---
  const trackerExpansionById = new Map(parsed.expansions.map((expansion) => [expansion.id, expansion]))
  const declaredIds = new Set(parsed.expansionIds)
  for (const id of trackerExpansionById.keys()) {
    if (!declaredIds.has(id)) warnings.push(`Expansion ${id} is in CardsDB.ts but not in expansionIds`)
  }
  for (const id of declaredIds) {
    if (!trackerExpansionById.has(id)) warnings.push(`Expansion ${id} is in expansionIds but not in CardsDB.ts`)
  }
  const expansionOrder: ExpansionId[] = []
  const seenExpansions = new Set<ExpansionId>()
  const cardIds = new Set<CardId>()
  for (const card of cards) {
    if (cardIds.has(card.card_id)) throw new CatalogBuildError(`Duplicate card id ${card.card_id}`)
    cardIds.add(card.card_id)
    if (!trackerExpansionById.has(card.expansion)) {
      throw new CatalogBuildError(`Card ${card.card_id}: expansion ${card.expansion} is not declared in CardsDB.ts`)
    }
    if (!seenExpansions.has(card.expansion)) {
      seenExpansions.add(card.expansion)
      expansionOrder.push(card.expansion)
    }
  }
  for (const expansion of parsed.expansions) {
    if (!seenExpansions.has(expansion.id)) {
      warnings.push(`Expansion ${expansion.id} has no cards in cards.json`)
      expansionOrder.push(expansion.id)
    }
  }

  // --- Stock units: cards sharing internal_id. ---
  const indexesByInternalId = new Map<number, number[]>()
  cards.forEach((card, index) => {
    const list = indexesByInternalId.get(card.internal_id)
    if (list) list.push(index)
    else indexesByInternalId.set(card.internal_id, [index])
  })

  // --- Functional groups: union-find over alternate_versions expanded through internal_id. ---
  const sets = new EarliestRootUnionFind(cards.length)
  cards.forEach((card, index) => {
    for (const twin of indexesByInternalId.get(card.internal_id) as number[]) sets.union(index, twin)
    for (const alternate of card.alternate_versions) {
      const members = indexesByInternalId.get(alternate)
      if (!members) {
        warnings.push(`Card ${card.card_id}: alternate_versions id ${alternate} is not in the catalog`)
        continue
      }
      for (const member of members) sets.union(index, member)
    }
  })
  const groupMembers = new Map<number, number[]>()
  cards.forEach((_, index) => {
    const root = sets.find(index)
    const list = groupMembers.get(root)
    if (list) list.push(index)
    else groupMembers.set(root, [index])
  })

  const stockCardIdByIndex: CardId[] = new Array(cards.length)
  for (const members of indexesByInternalId.values()) {
    const stockId = (cards[members[0] as number] as TrackerCard).card_id
    for (const member of members) stockCardIdByIndex[member] = stockId
  }
  const groupIdByIndex: CardId[] = new Array(cards.length)
  const displayIdByGroupId = new Map<CardId, CardId>()
  for (const [root, members] of groupMembers) {
    const rootCard = cards[root] as TrackerCard
    const groupId = rootCard.card_id
    const deckbuildingInternalId = rootCard.alternate_versions[0] as number
    let displayCardId: CardId | null = null
    for (const member of members) {
      const card = cards[member] as TrackerCard
      groupIdByIndex[member] = groupId
      if (card.alternate_versions[0] !== deckbuildingInternalId) {
        warnings.push(
          `Group ${groupId}: ${card.card_id} has a different alternate_versions[0] (${card.alternate_versions[0]})`,
        )
      }
      if (displayCardId === null && card.internal_id === deckbuildingInternalId) displayCardId = card.card_id
    }
    if (displayCardId === null) {
      warnings.push(`Group ${groupId}: alternate_versions[0] ${deckbuildingInternalId} is not an edition of the group`)
      displayCardId = groupId
    }
    displayIdByGroupId.set(groupId, displayCardId)
  }

  // --- Editions. ---
  const counts: BuildCounts = {
    cards: cards.length,
    expansions: 0,
    packs: 0,
    groups: groupMembers.size,
    stockUnits: indexesByInternalId.size,
    linkedStockUnits: 0,
    pokemon: 0,
    trainers: 0,
    ex: 0,
    fossils: 0,
    noCostAttacks: 0,
    damageNoiseAttacks: 0,
    cleanedTrainerEffects: 0,
    missions: 0,
  }
  const nameFallbacks: CardId[] = []
  const editions: CardEdition[] = cards.map((raw, index) => {
    const cardType: CardType = raw.card_type === 'trainer' ? 'trainer' : 'pokemon'
    for (const attack of raw.attacks) {
      if (attack.cost.includes('No Cost')) counts.noCostAttacks += 1
      if (attack.damage.trim() !== '0' && isDamageNoise(attack.damage)) counts.damageNoiseAttacks += 1
    }
    if (raw.ability && /Illustrated by/.test(raw.ability.effect)) counts.cleanedTrainerEffects += 1
    const attacks = raw.attacks.map(normalizeAttack)
    const ability = normalizeAbility(raw.ability)
    const weakness = normalizeWeakness(raw.weakness)
    const localized = cardNameEs(
      { name: raw.name, cardType, evolutionType: raw.evolution_type, ex: raw.ex },
      translations,
    )
    if (localized.source === 'fallback_en') nameFallbacks.push(raw.card_id)
    const engine = engineJoin.byCardId.get(raw.card_id) ?? {
      engineId: trackerIdToEngineId(raw.card_id),
      evolvesFrom: null,
      isFossil: false,
    }
    const groupId = groupIdByIndex[index] as CardId
    const edition: CardEdition = {
      id: raw.card_id,
      expansionId: raw.expansion,
      number: cardNumberOf(raw.card_id, raw.expansion),
      internalId: raw.internal_id,
      stockCardId: stockCardIdByIndex[index] as CardId,
      functionalGroupId: groupId,
      isDisplayEdition: displayIdByGroupId.get(groupId) === raw.card_id,
      nameEn: raw.name,
      nameEs: localized.nameEs,
      nameEsSource: localized.source,
      hp: raw.hp ?? null,
      energy: raw.energy,
      types: [...raw.types],
      cardType,
      evolutionType: raw.evolution_type,
      evolvesFrom: cardType === 'trainer' ? null : engine.evolvesFrom,
      isFossil: engine.isFossil,
      ex: raw.ex,
      prizePoints: prizePointsOf({ cardType, ex: raw.ex, nameEn: raw.name }),
      baby: raw.baby,
      rarity: raw.rarity,
      pack: raw.pack,
      artist: raw.artist,
      attacks,
      ability,
      weakness,
      retreat: raw.retreat ?? null,
      imageUrl: trackerImageUrl(
        input.trackerCommit,
        raw.card_id,
        preferredImageLocale(input.imageLocales, raw.card_id),
      ),
      engineId: engine.engineId,
      searchText: buildSearchText({
        id: raw.card_id,
        engineId: engine.engineId,
        nameEn: raw.name,
        nameEs: localized.nameEs,
        attacks,
        ability,
      }),
      alternateVersionsRaw: [...raw.alternate_versions],
    }
    if (cardType === 'trainer') counts.trainers += 1
    else counts.pokemon += 1
    if (edition.ex) counts.ex += 1
    if (edition.isFossil) counts.fossils += 1
    return edition
  })

  // --- Stock units and groups as entities. ---
  const stockUnits: StockUnit[] = []
  for (const [internalId, members] of indexesByInternalId) {
    const first = editions[members[0] as number] as CardEdition
    if (members.length > 1) counts.linkedStockUnits += 1
    stockUnits.push({
      id: first.id,
      internalId,
      functionalGroupId: first.functionalGroupId,
      cardIds: members.map((member) => (editions[member] as CardEdition).id),
    })
  }
  const groups: FunctionalGroup[] = []
  const groupsWithMixedRules: CardId[] = []
  const groupsWithMixedNames: CardId[] = []
  const rulesHashByIndex = editions.map((edition) => rulesHashOf(edition))
  for (const [root, members] of groupMembers) {
    const first = editions[root] as CardEdition
    const rulesHash = rulesHashByIndex[root] as string
    const stockCardIds: CardId[] = []
    const seenStock = new Set<CardId>()
    let mixedRules = false
    let mixedNames = false
    for (const member of members) {
      const edition = editions[member] as CardEdition
      if (rulesHashByIndex[member] !== rulesHash) mixedRules = true
      if (edition.nameEn !== first.nameEn) mixedNames = true
      if (!seenStock.has(edition.stockCardId)) {
        seenStock.add(edition.stockCardId)
        stockCardIds.push(edition.stockCardId)
      }
    }
    if (mixedRules) groupsWithMixedRules.push(first.id)
    if (mixedNames) groupsWithMixedNames.push(first.id)
    groups.push({
      id: first.id,
      displayCardId: displayIdByGroupId.get(first.id) as CardId,
      nameEn: first.nameEn,
      nameEs: first.nameEs,
      cardType: first.cardType,
      rulesHash,
      cardIds: members.map((member) => (editions[member] as CardEdition).id),
      stockCardIds,
    })
  }

  // --- Expansions and packs. ---
  const editionsByExpansion = new Map<ExpansionId, CardEdition[]>()
  for (const edition of editions) {
    const list = editionsByExpansion.get(edition.expansionId)
    if (list) list.push(edition)
    else editionsByExpansion.set(edition.expansionId, [edition])
  }
  const expansions: Expansion[] = []
  const packs: Pack[] = []
  expansionOrder.forEach((expansionId, sortOrder) => {
    const tracker = trackerExpansionById.get(expansionId) as TrackerExpansion
    const expansionCards = editionsByExpansion.get(expansionId) ?? []
    const nameEn = parsed.enSets[tracker.name] ?? tracker.name
    const declaredPacks = new Set(tracker.packs.map((pack) => pack.name))
    const undeclared = new Set<string>()
    for (const card of expansionCards) {
      if (card.pack !== EVERY_PACK && !declaredPacks.has(card.pack)) undeclared.add(card.pack)
    }
    for (const pack of undeclared) warnings.push(`Expansion ${expansionId}: cards reference undeclared pack '${pack}'`)
    const packIds: string[] = []
    for (const pack of tracker.packs) {
      const id = `${expansionId}/${pack.name}`
      packIds.push(id)
      packs.push({
        id,
        expansionId,
        name: pack.name,
        nameEs: parsed.esPacks[pack.name] ?? parsed.enPacks[pack.name] ?? pack.name,
        color: pack.color || null,
        cardIds: expansionCards
          .filter((card) => card.pack === pack.name || card.pack === EVERY_PACK)
          .map((card) => card.id),
      })
    }
    expansions.push({
      id: expansionId,
      trackerInternalId: tracker.internalId,
      slug: tracker.name,
      nameEn,
      nameEs: parsed.esSets[tracker.name] ?? nameEn,
      sortOrder,
      isPromo: tracker.promo,
      tradeable: tracker.tradeable,
      openableTracker: tracker.openable,
      packStructure: tracker.promo ? null : knownPackStructure(expansionId, tracker.packStructure, warnings),
      packIds,
    })
  })
  counts.expansions = expansions.length
  counts.packs = packs.length

  const knownCards = new Set(editions.map((card) => card.id))
  const missions: Mission[] = []
  for (const [expansionId, raw] of Object.entries(input.missions ?? {})) {
    const parsed = parseMissions(raw, (cardId) => knownCards.has(cardId))
    missions.push(...parsed.missions)
    for (const warning of parsed.warnings) warnings.push(`${expansionId} ${warning}`)
  }
  counts.missions = missions.length

  const catalog: Catalog = {
    trackerCommit: input.trackerCommit,
    engineRev: input.engineRev,
    expansions,
    packs,
    cards: editions,
    groups,
    stockUnits,
    craftingCost,
    missions,
  }
  const report: BuildReport = {
    trackerCommit: input.trackerCommit,
    engineRev: input.engineRev,
    counts,
    nameFallbacks,
    engineConflicts: engineJoin.conflicts,
    engineMissing: engineJoin.missingInEngine,
    unmatchedEngineIds: engineJoin.unmatchedEngineIds,
    groupsWithMixedRules,
    groupsWithMixedNames,
    warnings,
  }
  return { catalog, report }
}

export function buildCatalog(input: BuildCatalogInput): Catalog {
  return buildCatalogWithReport(input).catalog
}
