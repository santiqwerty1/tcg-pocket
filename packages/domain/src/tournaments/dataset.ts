/**
 * The tournaments of one era and format, ready to aggregate (BRIEF M5, PLAN §3.5). Everything here is derived at
 * read time from what the sync stored (tournament facts and standings rows) plus the catalog and the owner's set table
 * and archetype aliases, so a catalog update or a fixed release date re-maps every list without touching the data.
 *
 * Exact list (BRIEF: «mismas 20 cartas por nombre, sin mirar la edición») has two keys: by name, as the brief asks
 * (Limitless's English names × count), and by functional card (tells Riolu A2-91 from Riolu B3-79; null while a card
 * does not map to the catalog). Energies never take part in either key.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardId } from '../catalog/types.js'
import type { LimitlessDecklist } from '../decks/limitless.js'
import { cardIdFromSetNumber } from '../decks/lineFormat.js'
import { addRecords, EMPTY_RECORD, type GameRecord, recordGames } from '../stats/rates.js'
import { eraConflict, eraOf, type SetRelease, type TournamentFormat } from './eras.js'
import type { ArchetypeRef, NormalizedEntry } from './limitless.js'

/** A tournament as the sync stored it (only the ones whose standings were downloaded and normalized). */
export interface StoredTournament {
  id: string
  name: string
  date: Date
  format: TournamentFormat
  players: number
}

export interface StoredEntry extends NormalizedEntry {
  tournamentId: string
}

export interface ListCard {
  set: string
  number: string
  /** Limitless's English name. */
  name: string
  count: number
  cardId: CardId | null
  groupId: CardId | null
}

export interface DatasetEntry {
  tournamentId: string
  /** Limitless player id (stable): links the list to the tournament's pairings (Fase 9). */
  playerId: string
  date: Date
  playerName: string
  placing: number | null
  record: GameRecord
  /** Canonical archetype id (after the owner's aliases); null = «Sin arquetipo». */
  archetypeId: string | null
  keyByName: string
  /** Null while a card of the list does not map to the catalog. */
  keyByGroup: string | null
  cards: ListCard[]
  /** Functional card → copies in the list (unmapped cards left out). */
  groups: ReadonlyMap<CardId, number>
  energies: string[]
}

export interface DatasetTournament extends StoredTournament {
  /** Set of a card newer than the tournament's day (or unknown to the table): pre-release event or missing set. */
  conflict: string | null
  lists: number
}

export interface UnknownCardRef {
  ref: string
  set: string
  number: string
  name: string
  occurrences: number
}

export interface TournamentDataset {
  era: string
  format: TournamentFormat
  minPlayers: number
  tournaments: DatasetTournament[]
  /** Only standings rows that carry a list: those are the «listas». */
  entries: DatasetEntry[]
  /** Rows without a list (they count for the tournament size, not for the statistics). */
  withoutList: number
  archetypes: ReadonlyMap<string, ArchetypeRef>
  unknownCards: UnknownCardRef[]
  /** ΣW, ΣL, ΣT over the lists: the era mean is ΣW / Σ(W+L+T) (46,7 % for B4a in the brief, not 50 %). */
  total: GameRecord
  /** H-006: tournaments left out because they play a set the era table does not know (a new era). */
  newSetTournaments: { id: string; name: string; date: Date; set: string }[]
}

export interface BuildDatasetInput {
  tournaments: readonly StoredTournament[]
  entries: readonly StoredEntry[]
  index: CatalogIndex
  sets: readonly SetRelease[]
  era: string
  format: TournamentFormat
  minPlayers: number
  /** Owner's merges: Limitless archetype id → the id it is shown as. */
  aliases?: ReadonlyMap<string, string>
}

/** cyrb53: a small, fast 53-bit string hash (public domain), as 14 hex digits. Pure TS, so it runs anywhere. */
export function hashKey(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0)
  return value.toString(16).padStart(14, '0')
}

/** Key of a multiset of (label, count): order and repeated lines do not matter. */
function multisetKey(items: Iterable<[string, number]>): string {
  const totals = new Map<string, number>()
  for (const [label, count] of items) totals.set(label, (totals.get(label) ?? 0) + count)
  const parts = [...totals]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([label, count]) => `${label}×${count}`)
  return hashKey(parts.join('|'))
}

/** Exact list by name (BRIEF): English names × count, case and spacing folded, editions ignored. */
export function listKeyByName(cards: Iterable<{ name: string; count: number }>): string {
  return multisetKey(
    [...cards].map(({ name, count }) => [name.normalize('NFC').replace(/\s+/gu, ' ').trim().toLowerCase(), count]),
  )
}

/** Exact list by functional card: group id × count. */
export function listKeyByGroup(groups: Iterable<[CardId, number]>): string {
  return multisetKey(groups)
}

/** Maps a Limitless decklist to the catalog: card id and functional group of every line (null when unknown). */
export function mapDecklist(decklist: LimitlessDecklist, index: CatalogIndex): ListCard[] {
  return [...decklist.pokemon, ...decklist.trainer].map((item) => {
    const number = String(item.number)
    const cardId = cardIdFromSetNumber(index, item.set, number)
    const card = cardId === null ? undefined : index.cardById(cardId)
    return {
      set: item.set,
      number,
      name: item.name,
      count: item.count,
      cardId: card?.id ?? null,
      groupId: card?.functionalGroupId ?? null,
    }
  })
}

/** Functional card → copies, for a list of mapped cards (unmapped lines left out). */
export function groupCounts(cards: readonly ListCard[]): Map<CardId, number> {
  const groups = new Map<CardId, number>()
  for (const card of cards) {
    if (card.groupId === null) continue
    groups.set(card.groupId, (groups.get(card.groupId) ?? 0) + card.count)
  }
  return groups
}

export function buildDataset(input: BuildDatasetInput): TournamentDataset {
  const { index, sets, era, format, minPlayers } = input
  const aliases = input.aliases ?? new Map<string, string>()
  const chosen = new Map(
    input.tournaments
      .filter((t) => t.format === format && t.players >= minPlayers && eraOf(t.date, sets) === era)
      .map((t) => [t.id, t]),
  )
  const entries: DatasetEntry[] = []
  const lists = new Map<string, number>()
  const setsSeen = new Map<string, Set<string>>()
  const archetypeNames = new Map<string, Map<string, { ref: ArchetypeRef; count: number }>>()
  const unknown = new Map<string, UnknownCardRef>()
  let withoutList = 0
  let total: GameRecord = { ...EMPTY_RECORD }

  // First pass: map every list and see which sets each tournament plays (unknown cards count for all of them: they
  // say the catalog lacks a set, whatever era the tournament ends up in).
  const prepared: { tournament: StoredTournament; entry: (typeof input.entries)[number]; cards: ListCard[] | null }[] =
    []
  for (const entry of input.entries) {
    const tournament = chosen.get(entry.tournamentId)
    if (!tournament) continue
    if (!entry.decklist) {
      prepared.push({ tournament, entry, cards: null })
      continue
    }
    const cards = mapDecklist(entry.decklist, index)
    const seen = setsSeen.get(tournament.id) ?? new Set<string>()
    setsSeen.set(tournament.id, seen)
    for (const card of cards) {
      seen.add(card.set)
      if (card.groupId !== null) continue
      const ref = `${card.set}-${card.number}`
      const known = unknown.get(ref)
      if (known) known.occurrences += 1
      else unknown.set(ref, { ref, set: card.set, number: card.number, name: card.name, occurrences: 1 })
    }
    prepared.push({ tournament, entry, cards })
  }

  // H-006: a tournament with a set the era table does not know (and that is not a Deluxe reprint pack) is playing a
  // new era: it stays out of this one until the set is in the table.
  const leftOut = new Map<string, string>()
  for (const [id, tournament] of chosen) {
    const code = eraConflict(tournament.date, setsSeen.get(id) ?? [], sets)
    if (code !== null && opensUnknownEra(code, sets, index)) leftOut.set(id, code)
  }

  for (const { tournament, entry, cards } of prepared) {
    if (leftOut.has(tournament.id)) continue
    if (!cards) {
      withoutList += 1
      continue
    }
    const groups = groupCounts(cards)
    const complete = cards.every((card) => card.groupId !== null)
    const archetypeId = entry.archetype ? (aliases.get(entry.archetype.id) ?? entry.archetype.id) : null
    if (entry.archetype && archetypeId !== null) {
      const names = archetypeNames.get(archetypeId) ?? new Map()
      archetypeNames.set(archetypeId, names)
      const named = names.get(entry.archetype.name)
      if (named) named.count += 1
      else names.set(entry.archetype.name, { ref: { ...entry.archetype, id: archetypeId }, count: 1 })
    }
    entries.push({
      tournamentId: tournament.id,
      playerId: entry.playerId,
      date: tournament.date,
      playerName: entry.playerName,
      placing: entry.placing,
      record: entry.record,
      archetypeId,
      keyByName: listKeyByName(cards),
      keyByGroup: complete ? listKeyByGroup(groups) : null,
      cards,
      groups,
      energies: entry.energies,
    })
    lists.set(tournament.id, (lists.get(tournament.id) ?? 0) + 1)
    total = addRecords(total, entry.record)
  }

  // The shown name of an archetype is its most used one (aliases merge several Limitless names into one).
  const archetypes = new Map<string, ArchetypeRef>()
  for (const [id, names] of archetypeNames) {
    const best = [...names.values()].sort((a, b) => b.count - a.count)[0]
    if (best) archetypes.set(id, best.ref)
  }

  const newSetTournaments = [...leftOut]
    .map(([id, set]) => {
      const tournament = chosen.get(id) as StoredTournament
      return { id, name: tournament.name, date: tournament.date, set }
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime())
  const tournaments = [...chosen.values()]
    .filter((t) => (lists.get(t.id) ?? 0) > 0)
    .map((t) => ({ ...t, conflict: eraConflict(t.date, setsSeen.get(t.id) ?? [], sets), lists: lists.get(t.id) ?? 0 }))
    .sort((a, b) => b.date.getTime() - a.date.getTime())

  return {
    era,
    format,
    minPlayers,
    tournaments,
    entries,
    withoutList,
    archetypes,
    unknownCards: [...unknown.values()].sort((a, b) => b.occurrences - a.occurrences || a.ref.localeCompare(b.ref)),
    total,
    newSetTournaments,
  }
}

/**
 * H-006: a set the era table does not know opens a new era, unless the catalog knows it as a Deluxe pack (4 cards of
 * reprints: B4b did not open an era). A set the table knows is a pre-release event, not a new era.
 */
export function opensUnknownEra(code: string, sets: readonly { code: string }[], index: CatalogIndex): boolean {
  if (sets.some((set) => set.code === code)) return false
  const expansion = index.expansionById(code)
  return !(expansion?.packStructure && expansion.packStructure.cardsPerPack === 4)
}

/** Games of a dataset: Σ(W+L+T) over its lists. */
export function datasetGames(dataset: TournamentDataset): number {
  return recordGames(dataset.total)
}
