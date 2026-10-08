/**
 * Meta semanal (Fase 11): what is being played more and less, this week against the week before. Two windows of
 * `days` days end at the newest tournament of the era (so stale data still compares two full weeks); each archetype's
 * share of the lists in each window and the change in points, with a two-proportion test so a swing of 2 lists out of
 * 30 is not sold as a trend. The same for cards (share of lists that play them). Lists only, no win rates mixed in.
 */
import type { CardId } from '../catalog/types.js'
import { addRecords, EMPTY_RECORD, type GameRecord, type WinRate, winRate } from '../stats/rates.js'
import type { DatasetEntry, TournamentDataset } from './dataset.js'
import { cardUsage } from './stats.js'

export const DEFAULT_TREND_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000
/** |z| of the two-proportion test from which a change counts as clear (95 %). */
const CLEAR_Z = 1.96

export interface TrendWindow {
  from: Date
  /** Exclusive. */
  to: Date
  tournaments: number
  lists: number
}

export interface ShareChange {
  /** Lists in the window and their share of the window's lists (0–100). */
  now: { lists: number; share: number }
  before: { lists: number; share: number }
  /** Points: now.share − before.share. */
  delta: number
  /** Two-proportion z: positive when it grew. */
  z: number
  /** |z| ≥ 1,96: the change is unlikely to be noise. */
  clear: boolean
}

export interface ArchetypeTrend extends ShareChange {
  archetypeId: string
  /** This week's record and rate of the archetype (tournament lists). */
  record: GameRecord
  rate: WinRate<'tournament'> | null
  /** Not played the week before and played now. */
  isNew: boolean
}

export interface CardTrend extends ShareChange {
  groupId: CardId
}

export interface MetaTrends {
  days: number
  now: TrendWindow
  before: TrendWindow
  archetypes: ArchetypeTrend[]
  cards: CardTrend[]
}

function change(nowLists: number, nowTotal: number, beforeLists: number, beforeTotal: number): ShareChange {
  const p1 = nowTotal === 0 ? 0 : nowLists / nowTotal
  const p0 = beforeTotal === 0 ? 0 : beforeLists / beforeTotal
  const pooled = nowTotal + beforeTotal === 0 ? 0 : (nowLists + beforeLists) / (nowTotal + beforeTotal)
  const se =
    nowTotal === 0 || beforeTotal === 0 ? 0 : Math.sqrt(pooled * (1 - pooled) * (1 / nowTotal + 1 / beforeTotal))
  const z = se === 0 ? 0 : (p1 - p0) / se
  return {
    now: { lists: nowLists, share: p1 * 100 },
    before: { lists: beforeLists, share: p0 * 100 },
    delta: (p1 - p0) * 100,
    z,
    clear: Math.abs(z) >= CLEAR_Z,
  }
}

function windowOf(
  entries: readonly DatasetEntry[],
  from: Date,
  to: Date,
): { entries: DatasetEntry[]; window: TrendWindow } {
  const inside = entries.filter((entry) => entry.date >= from && entry.date < to)
  return {
    entries: inside,
    window: { from, to, tournaments: new Set(inside.map((entry) => entry.tournamentId)).size, lists: inside.length },
  }
}

/**
 * This window against the one before. `minLists`: an archetype or card needs that many lists in one of the two
 * windows to be listed (the long tail of one-off lists is noise). Ordered by change, biggest first in each direction
 * is up to the caller; here: by delta, descending.
 */
export function metaTrends(dataset: TournamentDataset, options: { days?: number; minLists?: number } = {}): MetaTrends {
  const days = options.days ?? DEFAULT_TREND_DAYS
  const minLists = options.minLists ?? 5
  const newest = dataset.entries.reduce((max, entry) => Math.max(max, entry.date.getTime()), 0)
  // The window ends the day after the newest tournament, so that tournament falls inside it.
  const end = new Date(newest === 0 ? Date.now() : newest + DAY_MS)
  const middle = new Date(end.getTime() - days * DAY_MS)
  const start = new Date(middle.getTime() - days * DAY_MS)
  const now = windowOf(dataset.entries, middle, end)
  const before = windowOf(dataset.entries, start, middle)

  const count = (entries: readonly DatasetEntry[]) => {
    const lists = new Map<string, number>()
    const records = new Map<string, GameRecord>()
    for (const entry of entries) {
      if (entry.archetypeId === null) continue
      lists.set(entry.archetypeId, (lists.get(entry.archetypeId) ?? 0) + 1)
      records.set(entry.archetypeId, addRecords(records.get(entry.archetypeId) ?? EMPTY_RECORD, entry.record))
    }
    return { lists, records }
  }
  const nowCount = count(now.entries)
  const beforeCount = count(before.entries)
  const ids = new Set([...nowCount.lists.keys(), ...beforeCount.lists.keys()])
  const archetypes: ArchetypeTrend[] = []
  for (const id of ids) {
    const nowLists = nowCount.lists.get(id) ?? 0
    const beforeLists = beforeCount.lists.get(id) ?? 0
    if (Math.max(nowLists, beforeLists) < minLists) continue
    const record = nowCount.records.get(id) ?? { ...EMPTY_RECORD }
    archetypes.push({
      archetypeId: id,
      ...change(nowLists, now.window.lists, beforeLists, before.window.lists),
      record,
      rate: winRate('tournament', record, nowLists, 'lists'),
      isNew: beforeLists === 0 && nowLists > 0 && before.window.lists > 0,
    })
  }
  archetypes.sort((a, b) => b.delta - a.delta || a.archetypeId.localeCompare(b.archetypeId))

  const nowCards = new Map(cardUsage(now.entries).map((row) => [row.groupId, row.lists]))
  const beforeCards = new Map(cardUsage(before.entries).map((row) => [row.groupId, row.lists]))
  const cards: CardTrend[] = []
  for (const groupId of new Set([...nowCards.keys(), ...beforeCards.keys()])) {
    const nowLists = nowCards.get(groupId) ?? 0
    const beforeLists = beforeCards.get(groupId) ?? 0
    if (Math.max(nowLists, beforeLists) < minLists) continue
    cards.push({ groupId, ...change(nowLists, now.window.lists, beforeLists, before.window.lists) })
  }
  cards.sort((a, b) => b.delta - a.delta || a.groupId.localeCompare(b.groupId))

  return { days, now: now.window, before: before.window, archetypes, cards }
}
