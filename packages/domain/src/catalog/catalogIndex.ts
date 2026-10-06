/**
 * In-memory lookups and search over a built `Catalog`. Built once per catalog version; cheap to query.
 */
import { foldText } from './normalize.js'
import type { CardEdition, CardId, Catalog, Expansion, ExpansionId, FunctionalGroup, Pack, StockUnit } from './types.js'

export type SearchLang = 'es' | 'en' | 'any'

export interface SearchOptions {
  /** Which names to match: Spanish, English or both (default 'any'). Ids and rules text always match. */
  lang?: SearchLang | undefined
  /** Maximum number of editions returned (default 100). */
  limit?: number | undefined
}

/**
 * How a hit matched, best first: exact id; exact name; the query is the leading whole word(s) of the name
 * ("mew" → "Mew ex"); plain prefix ("mew" → "Mewtwo"); a whole word inside the name; any substring; rules text.
 */
export type SearchMatch =
  | 'id'
  | 'name_exact'
  | 'name_prefix_word'
  | 'name_prefix'
  | 'name_word'
  | 'name_partial'
  | 'text'

export interface SearchHit {
  card: CardEdition
  score: number
  matchedOn: SearchMatch
}

export interface GroupSearchHit {
  group: FunctionalGroup
  score: number
  matchedOn: SearchMatch
  /** Matching editions of the group, best first. */
  cards: CardEdition[]
}

const SCORES: Record<SearchMatch, number> = {
  id: 100,
  name_exact: 90,
  name_prefix_word: 75,
  name_prefix: 70,
  name_word: 60,
  name_partial: 50,
  text: 20,
}

interface SearchEntry {
  card: CardEdition
  index: number
  groupOrder: number
  id: string
  engineId: string
  nameEn: string
  nameEs: string
}

const WORD_SEPARATORS = new Set([' ', '-', "'", ':'])

function nameMatch(name: string, query: string): SearchMatch | null {
  if (name === query) return 'name_exact'
  if (name.startsWith(query)) return WORD_SEPARATORS.has(name.charAt(query.length)) ? 'name_prefix_word' : 'name_prefix'
  const at = name.indexOf(query)
  if (at < 0) return null
  return WORD_SEPARATORS.has(name.charAt(at - 1)) ? 'name_word' : 'name_partial'
}

function better(a: SearchMatch | null, b: SearchMatch | null): SearchMatch | null {
  if (a === null) return b
  if (b === null) return a
  return SCORES[a] >= SCORES[b] ? a : b
}

export class CatalogIndex {
  readonly catalog: Catalog
  private readonly cards = new Map<CardId, CardEdition>()
  private readonly cardsByInternal = new Map<number, CardEdition[]>()
  private readonly cardsByEngine = new Map<string, CardEdition>()
  private readonly groups = new Map<CardId, FunctionalGroup>()
  private readonly groupsByName = new Map<string, FunctionalGroup[]>()
  private readonly stocks = new Map<CardId, StockUnit>()
  private readonly expansions = new Map<ExpansionId, Expansion>()
  private readonly packs = new Map<string, Pack>()
  private readonly cardsByExpansion = new Map<ExpansionId, CardEdition[]>()
  private readonly groupOrder = new Map<CardId, number>()
  private readonly entries: SearchEntry[]

  constructor(catalog: Catalog) {
    this.catalog = catalog
    for (const expansion of catalog.expansions) this.expansions.set(expansion.id, expansion)
    for (const pack of catalog.packs) this.packs.set(pack.id, pack)
    for (const stock of catalog.stockUnits) this.stocks.set(stock.id, stock)
    catalog.groups.forEach((group, order) => {
      this.groups.set(group.id, group)
      this.groupOrder.set(group.id, order)
      const list = this.groupsByName.get(group.nameEn)
      if (list) list.push(group)
      else this.groupsByName.set(group.nameEn, [group])
    })
    this.entries = catalog.cards.map((card, index) => {
      this.cards.set(card.id, card)
      this.cardsByEngine.set(card.engineId, card)
      const twins = this.cardsByInternal.get(card.internalId)
      if (twins) twins.push(card)
      else this.cardsByInternal.set(card.internalId, [card])
      const ofExpansion = this.cardsByExpansion.get(card.expansionId)
      if (ofExpansion) ofExpansion.push(card)
      else this.cardsByExpansion.set(card.expansionId, [card])
      return {
        card,
        index,
        groupOrder: this.groupOrder.get(card.functionalGroupId) ?? Number.MAX_SAFE_INTEGER,
        id: foldText(card.id),
        engineId: foldText(card.engineId),
        nameEn: foldText(card.nameEn),
        nameEs: foldText(card.nameEs),
      }
    })
  }

  cardById(id: CardId): CardEdition | undefined {
    return this.cards.get(id)
  }

  /** Editions sharing a tracker internal id (1 edition, or 2–3 for linked reprints), in catalog order. */
  cardsByInternalId(internalId: number): CardEdition[] {
    return this.cardsByInternal.get(internalId) ?? []
  }

  cardByEngineId(engineId: string): CardEdition | undefined {
    return this.cardsByEngine.get(engineId)
  }

  groupById(id: CardId): FunctionalGroup | undefined {
    return this.groups.get(id)
  }

  groupOfCard(cardId: CardId): FunctionalGroup | undefined {
    const card = this.cards.get(cardId)
    return card ? this.groups.get(card.functionalGroupId) : undefined
  }

  /** Groups sharing an exact English name (555 names map to more than one group). */
  groupsByNameEn(nameEn: string): FunctionalGroup[] {
    return this.groupsByName.get(nameEn) ?? []
  }

  cardsOfGroup(groupId: CardId): CardEdition[] {
    const group = this.groups.get(groupId)
    return group ? group.cardIds.map((id) => this.cards.get(id) as CardEdition) : []
  }

  stockById(id: CardId): StockUnit | undefined {
    return this.stocks.get(id)
  }

  stockOfCard(cardId: CardId): StockUnit | undefined {
    const card = this.cards.get(cardId)
    return card ? this.stocks.get(card.stockCardId) : undefined
  }

  expansionById(id: ExpansionId): Expansion | undefined {
    return this.expansions.get(id)
  }

  cardsOfExpansion(id: ExpansionId): CardEdition[] {
    return this.cardsByExpansion.get(id) ?? []
  }

  packById(id: string): Pack | undefined {
    return this.packs.get(id)
  }

  packsOfExpansion(id: ExpansionId): Pack[] {
    const expansion = this.expansions.get(id)
    return expansion ? expansion.packIds.map((packId) => this.packs.get(packId) as Pack) : []
  }

  /**
   * Editions matching `query` by id, name (accent- and case-insensitive) or rules text, best match first.
   * Ties keep editions of the same functional group together, in catalog order.
   */
  search(query: string, options: SearchOptions = {}): SearchHit[] {
    const folded = foldText(query)
    if (folded === '') return []
    const lang = options.lang ?? 'any'
    const limit = options.limit ?? 100
    const hits: { entry: SearchEntry; match: SearchMatch }[] = []
    for (const entry of this.entries) {
      let match: SearchMatch | null = null
      if (entry.id === folded || entry.engineId === folded) match = 'id'
      else {
        if (lang !== 'en') match = better(match, nameMatch(entry.nameEs, folded))
        if (lang !== 'es') match = better(match, nameMatch(entry.nameEn, folded))
        if (match === null && entry.card.searchText.includes(folded)) match = 'text'
      }
      if (match !== null) hits.push({ entry, match })
    }
    hits.sort((a, b) => {
      const byScore = SCORES[b.match] - SCORES[a.match]
      if (byScore !== 0) return byScore
      const byGroup = a.entry.groupOrder - b.entry.groupOrder
      if (byGroup !== 0) return byGroup
      return a.entry.index - b.entry.index
    })
    return hits.slice(0, limit).map((hit) => ({ card: hit.entry.card, score: SCORES[hit.match], matchedOn: hit.match }))
  }

  /** `search` folded by functional group: one row per group with its matching editions. */
  searchGroups(query: string, options: SearchOptions = {}): GroupSearchHit[] {
    const hits = this.search(query, { lang: options.lang, limit: Number.MAX_SAFE_INTEGER })
    const byGroup = new Map<CardId, GroupSearchHit>()
    for (const hit of hits) {
      const existing = byGroup.get(hit.card.functionalGroupId)
      if (existing) {
        existing.cards.push(hit.card)
        continue
      }
      const group = this.groups.get(hit.card.functionalGroupId)
      if (!group) continue
      byGroup.set(group.id, { group, score: hit.score, matchedOn: hit.matchedOn, cards: [hit.card] })
    }
    const limit = options.limit ?? 100
    return [...byGroup.values()].slice(0, limit)
  }
}
