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
function swaps(a: ReadonlyMap<CardId, number>, b: ReadonlyMap<CardId, number>): number {
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
    const distance = swaps(groups, entry.groups)
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
