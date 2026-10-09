/**
 * Meta semanal (Fase 11): what is being played more and less, this week against the week before. Two windows of
 * `days` days end at the newest tournament of the era (so stale data still compares two full weeks); each archetype's
 * share of the lists in each window and the change in points, with a two-proportion test so a swing of 2 lists out of
 * 30 is not sold as a trend. The same for cards (share of lists that play them). Lists only, no win rates mixed in.
 *
 * H-011 (Fase 37): the lists of a tournament come together (one big tournament can carry an archetype), so each
 * share's variance is the clustered one by tournament (never below the binomial); and with hundreds of archetypes
 * and cards looked at once, «claro» is Benjamini–Hochberg at 5 % over all of them, not |z| ≥ 1,96 each.
 */
import type { CardId } from '../catalog/types.js'
import {
  addRecords,
  type Cluster,
  clusteredVariance,
  clusteredWinRate,
  EMPTY_RECORD,
  type GameRecord,
  type WinRate,
} from '../stats/rates.js'
import { benjaminiHochberg, twoSidedP } from '../stats/tests.js'
import type { DatasetEntry, TournamentDataset } from './dataset.js'

export const DEFAULT_TREND_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000
/** False discovery rate of the «claro» changes (Benjamini–Hochberg). */
export const TREND_FDR = 0.05

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
  /** Two-proportion z (clustered by tournament): positive when it grew. */
  z: number
  /** Its two-sided p-value. */
  p: number
  /** A discovery of Benjamini–Hochberg at 5 % among every archetype and card of the comparison. */
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

/** One window's count of something (an archetype, a card) by tournament: lists with it out of the tournament's. */
type ByTournament = ReadonlyMap<string, number>

/** Variance of a window's share: clustered by tournament, never below the binomial one. */
function shareVariance(byTournament: ByTournament, totals: ByTournament): number {
  let lists = 0
  let total = 0
  const clusters: Cluster[] = []
  for (const [tournamentId, size] of totals) {
    const count = byTournament.get(tournamentId) ?? 0
    lists += count
    total += size
    clusters.push({ successes: count, trials: size })
  }
  if (total === 0) return 0
  const p = lists / total
  return Math.max((p * (1 - p)) / total, clusteredVariance(clusters) ?? 0)
}

function change(
  now: { byTournament: ByTournament; totals: ByTournament; lists: number; total: number },
  before: { byTournament: ByTournament; totals: ByTournament; lists: number; total: number },
): ShareChange {
  const p1 = now.total === 0 ? 0 : now.lists / now.total
  const p0 = before.total === 0 ? 0 : before.lists / before.total
  const se =
    now.total === 0 || before.total === 0
      ? 0
      : Math.sqrt(shareVariance(now.byTournament, now.totals) + shareVariance(before.byTournament, before.totals))
  const z = se === 0 ? 0 : (p1 - p0) / se
  return {
    now: { lists: now.lists, share: p1 * 100 },
    before: { lists: before.lists, share: p0 * 100 },
    delta: (p1 - p0) * 100,
    z,
    p: se === 0 ? 1 : twoSidedP(z),
    clear: false,
  }
}

/** Lists of each tournament of a window. */
function tournamentSizes(entries: readonly DatasetEntry[]): Map<string, number> {
  const sizes = new Map<string, number>()
  for (const entry of entries) sizes.set(entry.tournamentId, (sizes.get(entry.tournamentId) ?? 0) + 1)
  return sizes
}

function bump(map: Map<string, Map<string, number>>, key: string, tournamentId: string): void {
  const inner = map.get(key) ?? new Map<string, number>()
  inner.set(tournamentId, (inner.get(tournamentId) ?? 0) + 1)
  map.set(key, inner)
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
    const archetypes = new Map<string, Map<string, number>>()
    const cards = new Map<string, Map<string, number>>()
    const records = new Map<string, GameRecord[]>()
    for (const entry of entries) {
      for (const groupId of entry.groups.keys()) bump(cards, groupId, entry.tournamentId)
      if (entry.archetypeId === null) continue
      bump(archetypes, entry.archetypeId, entry.tournamentId)
      records.set(entry.archetypeId, [...(records.get(entry.archetypeId) ?? []), entry.record])
    }
    return { archetypes, cards, records, totals: tournamentSizes(entries), total: entries.length }
  }
  const nowCount = count(now.entries)
  const beforeCount = count(before.entries)
  const sum = (map: ByTournament | undefined) =>
    [...(map ?? new Map<string, number>()).values()].reduce((a, b) => a + b, 0)
  const sides = (key: string, kind: 'archetypes' | 'cards') => {
    const nowBy = nowCount[kind].get(key) ?? new Map<string, number>()
    const beforeBy = beforeCount[kind].get(key) ?? new Map<string, number>()
    return {
      now: { byTournament: nowBy, totals: nowCount.totals, lists: sum(nowBy), total: nowCount.total },
      before: { byTournament: beforeBy, totals: beforeCount.totals, lists: sum(beforeBy), total: beforeCount.total },
    }
  }
  const archetypes: ArchetypeTrend[] = []
  for (const id of new Set([...nowCount.archetypes.keys(), ...beforeCount.archetypes.keys()])) {
    const { now: nowSide, before: beforeSide } = sides(id, 'archetypes')
    if (Math.max(nowSide.lists, beforeSide.lists) < minLists) continue
    const lists = nowCount.records.get(id) ?? []
    const record = lists.reduce((total, item) => addRecords(total, item), { ...EMPTY_RECORD })
    archetypes.push({
      archetypeId: id,
      ...change(nowSide, beforeSide),
      record,
      rate: clusteredWinRate('tournament', lists, nowSide.lists, 'lists'),
      isNew: beforeSide.lists === 0 && nowSide.lists > 0 && before.window.lists > 0,
    })
  }
  archetypes.sort((a, b) => b.delta - a.delta || a.archetypeId.localeCompare(b.archetypeId))

  const cards: CardTrend[] = []
  for (const groupId of new Set([...nowCount.cards.keys(), ...beforeCount.cards.keys()])) {
    const { now: nowSide, before: beforeSide } = sides(groupId, 'cards')
    if (Math.max(nowSide.lists, beforeSide.lists) < minLists) continue
    cards.push({ groupId, ...change(nowSide, beforeSide) })
  }
  cards.sort((a, b) => b.delta - a.delta || a.groupId.localeCompare(b.groupId))

  // «Claro»: Benjamini–Hochberg over every archetype and card compared.
  const tested: ShareChange[] = [...archetypes, ...cards]
  const discoveries = benjaminiHochberg(
    tested.map((item) => item.p),
    TREND_FDR,
  )
  for (const [at, item] of tested.entries()) item.clear = discoveries[at] ?? false

  return { days, now: now.window, before: before.window, archetypes, cards }
}
