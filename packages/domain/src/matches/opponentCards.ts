/**
 * Rival cards seen in a match (pedido de Santi del 14/10): when the rival does not look like any archetype (two
 * Greninja, Suicune ex and Indeedee ex, in B4a), the owner notes the cards seen — «2 Greninja» — and classifies the
 * match later. The cards suggest the era's archetypes that play them; the matches without a rival are grouped by
 * similar cards so a whole group can be given one name (an archetype's, or one of the owner's own).
 *
 * A card seen is the edition picked in the search, but any card of its name counts: the rival's Greninja can be any
 * printing or any Greninja. Names compare folded (case and accents do not matter).
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardId } from '../catalog/types.js'
import { DECK_SIZE } from '../decks/validate.js'
import type { DatasetEntry } from '../tournaments/dataset.js'
import type { ArchetypeRef } from '../tournaments/limitless.js'

export interface SeenCard {
  cardId: CardId
  /** Copies seen (1 or 2: a deck has at most two of a name). */
  count: number
}

/** Cards seen in one match, at most. */
export const OPPONENT_CARDS_MAX = 20
/** Two matches go in one group to classify when their names overlap this much (Jaccard). */
export const SEEN_GROUP_OVERLAP = 0.5

function fold(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** The English name of a card id (an edition or a functional card), folded; null when the catalog lacks it. */
function nameKey(cardId: CardId, index: CatalogIndex): string | null {
  const card = index.cardById(cardId) ?? index.cardById(index.groupById(cardId)?.displayCardId ?? cardId)
  return card ? fold(card.nameEn) : null
}

/**
 * The cards as stored: known cards only, one line per name (the copies added up, at most 2), in the order given. An
 * unknown id throws: the caller turns it into a 400.
 */
export function normalizeSeenCards(
  cards: readonly SeenCard[],
  index: CatalogIndex,
  /** Ids already stored in the match: one the catalog no longer has stays (an edit must not fail for it). */
  kept: ReadonlySet<CardId> = new Set(),
): SeenCard[] {
  const byName = new Map<string, SeenCard>()
  for (const card of cards) {
    const key = nameKey(card.cardId, index) ?? (kept.has(card.cardId) ? `#${card.cardId}` : null)
    if (key === null) throw new Error(`Carta desconocida: ${card.cardId}.`)
    const count = Math.max(1, Math.min(2, Math.round(card.count)))
    const found = byName.get(key)
    if (found) found.count = Math.min(2, found.count + count)
    else byName.set(key, { cardId: card.cardId, count })
  }
  const lines = [...byName.values()]
  // Codex on #114: a deck has 20 cards, so the copies seen cannot add up to more (the lines alone could reach 40).
  const copies = lines.reduce((sum, card) => sum + card.count, 0)
  if (copies > DECK_SIZE) throw new Error(`Son ${copies} cartas vistas y un mazo tiene ${DECK_SIZE}.`)
  return lines.slice(0, OPPONENT_CARDS_MAX)
}

/** The copies seen, added up (at most 20: a deck's size). */
export function seenCopies(cards: readonly { count: number }[]): number {
  return cards.reduce((sum, card) => sum + card.count, 0)
}

/** «2 Greninja, Suicune ex»: the cards seen as text. */
export function seenCardsTextEs(cards: readonly SeenCard[], index: CatalogIndex): string {
  return cards
    .map((card) => {
      const name = index.cardById(card.cardId)?.nameEs ?? card.cardId
      return card.count > 1 ? `${card.count} ${name}` : name
    })
    .join(', ')
}

export interface ArchetypeFit {
  archetypeId: string
  name: string
  /** Its lists among the era's (0–100). */
  share: number
  lists: number
  /** Its lists that have every card seen, with at least those copies (0–100 of its lists). */
  fits: number
  /** How many of its lists those are. */
  fitting: number
  /** Cards seen that its closest list has. */
  best: number
  seen: number
  kind: 'fits' | 'similar'
  text: string
}

const percentEs = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

/** Per dataset (its entries array): each list's copies by folded English name, computed once (self-review). */
const listNames = new WeakMap<readonly DatasetEntry[], Map<string, number>[]>()

function namesOfLists(entries: readonly DatasetEntry[], index: CatalogIndex): Map<string, number>[] {
  let names = listNames.get(entries)
  if (!names) {
    names = entries.map((entry) => {
      const copies = new Map<string, number>()
      for (const card of entry.cards) {
        const key = card.groupId ? (nameKey(card.groupId, index) ?? fold(card.name)) : fold(card.name)
        copies.set(key, (copies.get(key) ?? 0) + card.count)
      }
      return copies
    })
    listNames.set(entries, names)
  }
  return names
}

/**
 * The era's archetypes for the cards seen: first those with lists that have every card seen (by how many of their
 * lists do, then by their share of the era), then the ones whose closest list has most of them («parecido a X»).
 * None when no list has any of the cards.
 */
export function suggestArchetypesForCards(
  seen: readonly SeenCard[],
  entries: readonly DatasetEntry[],
  archetypes: ReadonlyMap<string, ArchetypeRef>,
  index: CatalogIndex,
  limit = 5,
): ArchetypeFit[] {
  const wanted = new Map<string, number>()
  // Codex on #114: a card the catalog no longer has (kept in a match) is never checked, so no list «has them all».
  let unknown = 0
  for (const card of seen) {
    const key = nameKey(card.cardId, index)
    if (key !== null) wanted.set(key, Math.max(wanted.get(key) ?? 0, card.count))
    else unknown += 1
  }
  if (wanted.size === 0) return []
  const seenCount = wanted.size + unknown
  const names = namesOfLists(entries, index)
  // Self-review: Limitless may give one name two ids (Mega Lucario ex Lucario: 33 lists and 1); they go together.
  const byArchetype = new Map<
    string,
    { archetypeId: string; name: string; lists: number; fits: number; best: number }
  >()
  let total = 0
  for (const [at, entry] of entries.entries()) {
    if (entry.archetypeId === null) continue
    total += 1
    const copies = names[at] as Map<string, number>
    let have = 0
    for (const [key, count] of wanted) if ((copies.get(key) ?? 0) >= count) have += 1
    const name = archetypes.get(entry.archetypeId)?.name ?? entry.archetypeId
    const row = byArchetype.get(fold(name)) ?? { archetypeId: entry.archetypeId, name, lists: 0, fits: 0, best: 0 }
    row.lists += 1
    if (have === wanted.size && unknown === 0) row.fits += 1
    row.best = Math.max(row.best, have)
    byArchetype.set(fold(name), row)
  }
  total = Math.max(1, total)
  return (
    [...byArchetype.values()]
      .filter((row) => row.best > 0)
      .map((row): ArchetypeFit => {
        const { archetypeId, name } = row
        const fits = (100 * row.fits) / row.lists
        const kind = row.fits > 0 ? 'fits' : 'similar'
        return {
          archetypeId,
          name,
          share: (100 * row.lists) / total,
          lists: row.lists,
          fits,
          fitting: row.fits,
          best: row.best,
          seen: seenCount,
          kind,
          text:
            kind === 'fits'
              ? `${row.fits === row.lists ? `${row.lists === 1 ? 'su lista tiene' : 'todas sus listas tienen'}` : `el ${percentEs.format(fits)}${'\u00a0'}% de sus listas tiene`} esas cartas (${row.lists} ${row.lists === 1 ? 'lista' : 'listas'})`
              : `parecido: su lista más cercana tiene ${row.best} de ${seenCount}`,
        }
      })
      // Self-review: by how many of its lists have the cards (an archetype of one list at 100 % went before one of 30 at
      // 77 %), then by its share of the era.
      .sort(
        (a, b) =>
          Number(b.kind === 'fits') - Number(a.kind === 'fits') ||
          (a.kind === 'fits' ? b.fitting - a.fitting : b.best - a.best) ||
          b.share - a.share ||
          a.name.localeCompare(b.name, 'es'),
      )
      .slice(0, limit)
  )
}

export interface SeenMatch {
  id: string
  playedAt: Date
  cards: readonly SeenCard[]
}

export interface SeenGroup {
  /** Newest first. */
  matchIds: string[]
  /** Every card seen in the group's matches, one per name, with the most copies seen in one match. */
  cards: SeenCard[]
  lastPlayedAt: Date
}

/**
 * Matches grouped by the cards seen, to classify them together: newest first, each one joins the first group whose
 * names overlap its own by `SEEN_GROUP_OVERLAP` or more (Jaccard), else starts one. Matches with no card seen are left
 * out.
 */
export function groupSeenMatches(matches: readonly SeenMatch[], index: CatalogIndex): SeenGroup[] {
  const groups: { names: Map<string, SeenCard>; group: SeenGroup }[] = []
  const sorted = [...matches].filter((match) => match.cards.length > 0)
  sorted.sort((a, b) => b.playedAt.getTime() - a.playedAt.getTime() || b.id.localeCompare(a.id))
  for (const match of sorted) {
    const names = new Map<string, SeenCard>()
    // Self-review: a card the catalog no longer has still counts, by its id (the match must not vanish from the list).
    for (const card of match.cards) names.set(nameKey(card.cardId, index) ?? `#${card.cardId}`, card)
    if (names.size === 0) continue
    const home = groups.find(({ names: theirs }) => {
      let shared = 0
      for (const key of names.keys()) if (theirs.has(key)) shared += 1
      return shared / (names.size + theirs.size - shared) >= SEEN_GROUP_OVERLAP
    })
    if (home) {
      home.group.matchIds.push(match.id)
      for (const [key, card] of names) {
        const known = home.names.get(key)
        if (!known || known.count < card.count) home.names.set(key, card)
      }
      home.group.cards = [...home.names.values()]
    } else {
      groups.push({
        names,
        group: { matchIds: [match.id], cards: [...names.values()], lastPlayedAt: match.playedAt },
      })
    }
  }
  return groups.map(({ group }) => group)
}
