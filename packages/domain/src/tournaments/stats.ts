/**
 * Tournament records (BRIEF M5, DECISIONES 0.10): `WR = W / (W + L + T)` with Wilson 95 % over games, the number of
 * lists next to it and «orientativo» under 30 lists; the era mean (not 50 %) is the baseline. Only tournament data
 * goes in here: own matches and simulations never mix with it (PLAN I9).
 */
import type { CardId } from '../catalog/types.js'
import { addRecords, EMPTY_RECORD, type GameRecord, type WinRate, winRate } from '../stats/rates.js'
import type { DatasetEntry, ListCard, TournamentDataset } from './dataset.js'
import type { ArchetypeRef } from './limitless.js'

export interface RecordRow {
  lists: number
  record: GameRecord
  rate: WinRate<'tournament'> | null
  /** Share of the era's lists (0–100). */
  share: number
}

function summarize(entries: readonly DatasetEntry[], totalLists: number): RecordRow {
  let record: GameRecord = { ...EMPTY_RECORD }
  for (const entry of entries) record = addRecords(record, entry.record)
  return {
    lists: entries.length,
    record,
    rate: winRate('tournament', record, entries.length, 'lists'),
    share: totalLists === 0 ? 0 : (entries.length / totalLists) * 100,
  }
}

/** The era mean: every list of the era together (ΣW / Σ(W+L+T)). */
export function eraMean(dataset: TournamentDataset): RecordRow {
  return summarize(dataset.entries, dataset.entries.length)
}

function groupBy<K>(entries: readonly DatasetEntry[], key: (entry: DatasetEntry) => K): Map<K, DatasetEntry[]> {
  const groups = new Map<K, DatasetEntry[]>()
  for (const entry of entries) {
    const k = key(entry)
    const bucket = groups.get(k)
    if (bucket) bucket.push(entry)
    else groups.set(k, [entry])
  }
  return groups
}

function byListsThenRate(a: RecordRow, b: RecordRow): number {
  return b.lists - a.lists || (b.rate?.value ?? 0) - (a.rate?.value ?? 0)
}

export interface ArchetypeRow extends RecordRow {
  /** Null = lists Limitless did not assign to any archetype. */
  archetype: ArchetypeRef | null
}

export function archetypeRows(dataset: TournamentDataset): ArchetypeRow[] {
  const total = dataset.entries.length
  return [...groupBy(dataset.entries, (entry) => entry.archetypeId)]
    .map(([id, entries]) => ({
      archetype: id === null ? null : (dataset.archetypes.get(id) ?? { id, name: id, icons: [] }),
      ...summarize(entries, total),
    }))
    .sort(byListsThenRate)
}

export type ListKeyKind = 'group' | 'name'

export interface ListRow extends RecordRow {
  key: string
  kind: ListKeyKind
  /** Most frequent archetype of the list's entries. */
  archetypeId: string | null
  /** The list itself (from its most recent entry). */
  cards: ListCard[]
  groups: ReadonlyMap<CardId, number>
  /** The other key of the same list (by name when grouping by functional card, and the other way around). */
  otherKey: string | null
}

function mostFrequent<T>(values: readonly T[]): T | null {
  const counts = new Map<T, number>()
  let best: T | null = null
  let bestCount = 0
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1
    counts.set(value, count)
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

/** Records per exact list. By functional card (default) or by name, as the brief asks. */
export function listRows(dataset: TournamentDataset, kind: ListKeyKind = 'group'): ListRow[] {
  const total = dataset.entries.length
  const keyOf = (entry: DatasetEntry) => (kind === 'group' ? entry.keyByGroup : entry.keyByName)
  const rows: ListRow[] = []
  for (const [key, entries] of groupBy(dataset.entries, keyOf)) {
    if (key === null) continue
    const latest = entries.reduce((a, b) => (b.date > a.date ? b : a))
    rows.push({
      key,
      kind,
      archetypeId: mostFrequent(entries.map((entry) => entry.archetypeId)),
      cards: latest.cards,
      groups: latest.groups,
      otherKey: kind === 'group' ? latest.keyByName : latest.keyByGroup,
      ...summarize(entries, total),
    })
  }
  return rows.sort(byListsThenRate)
}

/** Energies most of a list's entries declare (NOEX lists come without them). */
export function mostCommonEnergies(entries: readonly DatasetEntry[]): string[] {
  const counts = new Map<string, { energies: string[]; count: number }>()
  for (const entry of entries) {
    if (entry.energies.length === 0) continue
    const key = [...entry.energies].sort().join(',')
    const bucket = counts.get(key)
    if (bucket) bucket.count += 1
    else counts.set(key, { energies: entry.energies, count: 1 })
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.energies ?? []
}

/** Entries of one exact list. */
export function entriesOfList(dataset: TournamentDataset, key: string, kind: ListKeyKind = 'group'): DatasetEntry[] {
  return dataset.entries.filter((entry) => (kind === 'group' ? entry.keyByGroup : entry.keyByName) === key)
}

export function entriesOfArchetype(dataset: TournamentDataset, archetypeId: string | null): DatasetEntry[] {
  return dataset.entries.filter((entry) => entry.archetypeId === archetypeId)
}

/** Record of a set of entries (an archetype, a list, a filter), with its share of the era. */
export function recordOf(dataset: TournamentDataset, entries: readonly DatasetEntry[]): RecordRow {
  return summarize(entries, dataset.entries.length)
}

export interface WithWithout {
  groupId: CardId
  minCount: number
  /** Lists with at least `minCount` copies of the card. */
  with: RecordRow
  without: RecordRow
}

/**
 * «Cuánto rinde un arquetipo con y sin una carta dada» (BRIEF M5): splits the entries by `copies(card) >= minCount`.
 * Two separate rows with their own n and interval; the difference is never presented as one number.
 */
export function withWithout(
  dataset: TournamentDataset,
  entries: readonly DatasetEntry[],
  groupId: CardId,
  minCount = 1,
): WithWithout {
  const has = (entry: DatasetEntry) => (entry.groups.get(groupId) ?? 0) >= minCount
  return {
    groupId,
    minCount,
    with: summarize(entries.filter(has), dataset.entries.length),
    without: summarize(
      entries.filter((entry) => !has(entry)),
      dataset.entries.length,
    ),
  }
}

export interface CardUsage {
  groupId: CardId
  /** Lists (of the given entries) that play the card. */
  lists: number
  /** 0–100 of the given entries. */
  share: number
  /** Lists by copies played: index 1 = one copy, 2 = two copies. */
  byCopies: number[]
  averageCopies: number
}

/** Which cards an archetype plays and how many copies: the base of «con y sin». */
export function cardUsage(entries: readonly DatasetEntry[]): CardUsage[] {
  const usage = new Map<CardId, CardUsage>()
  for (const entry of entries) {
    for (const [groupId, copies] of entry.groups) {
      let row = usage.get(groupId)
      if (!row) {
        row = { groupId, lists: 0, share: 0, byCopies: [0, 0, 0], averageCopies: 0 }
        usage.set(groupId, row)
      }
      row.lists += 1
      row.byCopies[Math.min(copies, 2)] = (row.byCopies[Math.min(copies, 2)] ?? 0) + 1
      row.averageCopies += copies
    }
  }
  return [...usage.values()]
    .map((row) => ({
      ...row,
      share: entries.length === 0 ? 0 : (row.lists / entries.length) * 100,
      averageCopies: row.lists === 0 ? 0 : row.averageCopies / row.lists,
    }))
    .sort((a, b) => b.lists - a.lists || a.groupId.localeCompare(b.groupId))
}

/** The archetypes with at least `minLists` lists, for the opponent suggestions of the quick-entry sheet (M6). */
export function opponentArchetypes(dataset: TournamentDataset, minLists: number): ArchetypeRow[] {
  return archetypeRows(dataset).filter((row) => row.archetype !== null && row.lists >= minLists)
}
