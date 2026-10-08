/**
 * Tournament lists against the collection (BRIEF M5): which exact lists can be built today, which single card unlocks
 * the most lists, and where one of my decks sits in the tournament data. Copies are counted by functional card and are
 * not shared out between lists (each list is checked alone against the whole collection, BRIEF §2).
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardId } from '../catalog/types.js'
import type { DeckCardEntry } from '../decks/types.js'
import { addRecords, EMPTY_RECORD, type GameRecord, type WinRate, winRate } from '../stats/rates.js'
import { type DatasetEntry, listKeyByGroup, listKeyByName, type TournamentDataset } from './dataset.js'
import { type ListRow, listRows, type RecordRow, recordOf } from './stats.js'

export interface MissingCopies {
  groupId: CardId
  need: number
  have: number
}

export interface ListAgainstCollection {
  list: ListRow
  /** Empty when the list can be built with the collection. */
  missing: MissingCopies[]
  /** Copies missing in total. */
  missingCopies: number
}

/** Every exact list (by functional card) with what the collection lacks for it. */
export function listsAgainstCollection(
  dataset: TournamentDataset,
  playable: (groupId: CardId) => number,
): ListAgainstCollection[] {
  return listRows(dataset, 'group').map((list) => {
    const missing: MissingCopies[] = []
    for (const [groupId, need] of list.groups) {
      const have = playable(groupId)
      if (have < need) missing.push({ groupId, need, have })
    }
    return { list, missing, missingCopies: missing.reduce((sum, item) => sum + item.need - item.have, 0) }
  })
}

/** Lists I can build today, most played first. */
export function buildableLists(rows: readonly ListAgainstCollection[]): ListAgainstCollection[] {
  return rows.filter((row) => row.missing.length === 0)
}

export interface UnlockCard {
  groupId: CardId
  /** Exact lists that become buildable with this card alone. */
  lists: number
  /** Copies to add to unlock all of them (1 or 2). */
  copies: number
  /** Lists unlocked with a single copy. */
  listsWithOneCopy: number
  /** Combined record of the lists it unlocks (lists counted as their entries). */
  entries: number
  record: GameRecord
  rate: WinRate<'tournament'> | null
  /** The unlocked lists, most played first. */
  unlocked: ListAgainstCollection[]
}

/** «Qué carta sola destraba más listas»: lists missing exactly one functional card, grouped by that card. */
export function unlockCards(rows: readonly ListAgainstCollection[]): UnlockCard[] {
  const byCard = new Map<CardId, ListAgainstCollection[]>()
  for (const row of rows) {
    const [only, ...rest] = row.missing
    if (!only || rest.length > 0) continue
    const bucket = byCard.get(only.groupId)
    if (bucket) bucket.push(row)
    else byCard.set(only.groupId, [row])
  }
  return [...byCard]
    .map(([groupId, unlocked]) => {
      let record: GameRecord = { ...EMPTY_RECORD }
      let entries = 0
      for (const row of unlocked) {
        record = addRecords(record, row.list.record)
        entries += row.list.lists
      }
      const copies = Math.max(...unlocked.map((row) => row.missingCopies))
      return {
        groupId,
        lists: unlocked.length,
        copies,
        listsWithOneCopy: unlocked.filter((row) => row.missingCopies === 1).length,
        entries,
        record,
        rate: winRate('tournament', record, entries, 'lists'),
        unlocked: [...unlocked].sort((a, b) => b.list.lists - a.list.lists),
      }
    })
    .sort((a, b) => b.lists - a.lists || b.entries - a.entries || a.groupId.localeCompare(b.groupId))
}

export interface DeckInTournaments {
  keyByGroup: string
  keyByName: string
  /** The exact list by functional card, when someone played it. */
  exactByGroup: RecordRow | null
  /** The exact list by name (BRIEF); may include lists with another Riolu than mine. */
  exactByName: RecordRow | null
  /** Archetype guessed from the closest lists (fewest card changes), with how close they are. */
  guessed: { archetypeId: string | null; swaps: number; lists: number } | null
}

/** Card changes between two lists of 20: max(cards to add, cards to remove), by functional card. */
export function listSwaps(a: ReadonlyMap<CardId, number>, b: ReadonlyMap<CardId, number>): number {
  let add = 0
  let remove = 0
  for (const [groupId, count] of a) {
    const other = b.get(groupId) ?? 0
    if (count > other) remove += count - other
  }
  for (const [groupId, count] of b) {
    const own = a.get(groupId) ?? 0
    if (count > own) add += count - own
  }
  return Math.max(add, remove)
}

/** Lists farther than this many changes from a deck do not suggest its archetype. */
export const ARCHETYPE_GUESS_MAX_SWAPS = 6

/**
 * Where one of my decks sits: its exact list (both keys) and the archetype of the closest tournament lists. The
 * archetype guess weighs every list at the minimum distance; the owner can always set it by hand.
 */
export function deckInTournaments(
  dataset: TournamentDataset,
  cards: readonly DeckCardEntry[],
  index: CatalogIndex,
): DeckInTournaments {
  const groups = new Map<CardId, number>()
  const names: { name: string; count: number }[] = []
  for (const entry of cards) {
    const card = index.cardById(entry.cardId)
    if (!card) continue
    groups.set(card.functionalGroupId, (groups.get(card.functionalGroupId) ?? 0) + entry.count)
    names.push({ name: card.nameEn, count: entry.count })
  }
  const keyByGroup = listKeyByGroup(groups)
  const keyByName = listKeyByName(names)
  const byGroup = dataset.entries.filter((entry) => entry.keyByGroup === keyByGroup)
  const byName = dataset.entries.filter((entry) => entry.keyByName === keyByName)

  let best = Number.POSITIVE_INFINITY
  let closest: DatasetEntry[] = []
  for (const entry of dataset.entries) {
    const distance = listSwaps(groups, entry.groups)
    if (distance < best) {
      best = distance
      closest = [entry]
    } else if (distance === best) closest.push(entry)
  }
  let guessed: DeckInTournaments['guessed'] = null
  if (closest.length > 0 && best <= ARCHETYPE_GUESS_MAX_SWAPS) {
    const counts = new Map<string | null, number>()
    for (const entry of closest) counts.set(entry.archetypeId, (counts.get(entry.archetypeId) ?? 0) + 1)
    const [archetypeId] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [null]
    guessed = { archetypeId: archetypeId ?? null, swaps: best, lists: closest.length }
  }
  return {
    keyByGroup,
    keyByName,
    exactByGroup: byGroup.length > 0 ? recordOf(dataset, byGroup) : null,
    exactByName: byName.length > 0 ? recordOf(dataset, byName) : null,
    guessed,
  }
}

/** A list has to be repeated this many times to be a deck's «versión de torneo» (when the archetype has one). */
export const TOURNAMENT_VERSION_MIN_LISTS = 5

export interface ListCardChange {
  groupId: CardId
  count: number
}

export interface TournamentVersion {
  /** The exact list aimed at. */
  list: ListRow
  /** Card changes from the deck to the list (by functional card). */
  swaps: number
  add: ListCardChange[]
  remove: ListCardChange[]
  /** What the collection lacks for the list. Empty: it can be built today. */
  missing: MissingCopies[]
  missingCopies: number
  /** Other lists of the archetype worth a look, best first (up to 3). */
  alternatives: ListRow[]
}

/** Lower end of the interval: a list that wins a lot over few games does not beat a solid one. */
function lowerBound(row: ListRow): number {
  return row.rate?.ci95[0] ?? -1
}

/**
 * The exact lists of one archetype, best target first: the ones played at least `TOURNAMENT_VERSION_MIN_LISTS` times
 * by the lower bound of their interval (more lists on ties); when none is repeated that often, the most played first.
 */
export function rankArchetypeLists(lists: readonly ListRow[]): ListRow[] {
  const repeated = lists.filter((row) => row.lists >= TOURNAMENT_VERSION_MIN_LISTS)
  return repeated.length > 0
    ? [...repeated].sort((a, b) => lowerBound(b) - lowerBound(a) || b.lists - a.lists || a.key.localeCompare(b.key))
    : [...lists].sort((a, b) => b.lists - a.lists || lowerBound(b) - lowerBound(a) || a.key.localeCompare(b.key))
}

/**
 * The «versión de torneo» of a deck: among the exact lists of its archetype played at least
 * `TOURNAMENT_VERSION_MIN_LISTS` times, the one with the best lower bound of its interval (more lists on ties); when
 * none is repeated that often, the most played one (a list played once that went 5-0 is luck, not a target). With the
 * cards that change from the deck and what the collection lacks for it. Null when the archetype has no list in the era.
 */
export function tournamentVersion(
  dataset: TournamentDataset,
  archetypeId: string | null,
  cards: readonly DeckCardEntry[],
  index: CatalogIndex,
  playable: (groupId: CardId) => number,
): TournamentVersion | null {
  const lists = listRows(dataset, 'group').filter((row) => row.archetypeId === archetypeId)
  if (lists.length === 0) return null
  const ranked = rankArchetypeLists(lists)
  const list = ranked[0] as ListRow
  const deck = new Map<CardId, number>()
  for (const entry of cards) {
    const groupId = index.cardById(entry.cardId)?.functionalGroupId
    if (groupId) deck.set(groupId, (deck.get(groupId) ?? 0) + entry.count)
  }
  const add: ListCardChange[] = []
  const remove: ListCardChange[] = []
  for (const [groupId, count] of list.groups) {
    const own = deck.get(groupId) ?? 0
    if (count > own) add.push({ groupId, count: count - own })
  }
  for (const [groupId, count] of deck) {
    const target = list.groups.get(groupId) ?? 0
    if (count > target) remove.push({ groupId, count: count - target })
  }
  const missing: MissingCopies[] = []
  for (const [groupId, need] of list.groups) {
    const have = playable(groupId)
    if (have < need) missing.push({ groupId, need, have })
  }
  return {
    list,
    swaps: listSwaps(deck, list.groups),
    add,
    remove,
    missing,
    missingCopies: missing.reduce((sum, item) => sum + item.need - item.have, 0),
    alternatives: ranked.slice(1, 4),
  }
}
