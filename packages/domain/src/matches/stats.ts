/**
 * Statistics of own matches (M6): overall, by deck, by opponent, by who went first, by mode and by deck revision.
 * Every row carries its W/L/T record and a `WinRate<'matches'>` (null without games). Only own matches enter here:
 * tournament and simulation rates are other types (PLAN I9) and are never added to these.
 */
import { EMPTY_RECORD, type GameRecord, matchWinRate, type WinRate } from '../stats/rates.js'
import { opponentKey, opponentLabels } from './opponents.js'
import { MATCH_MODE_LABEL_ES, MATCH_MODES, type MatchFacts, type MatchMode, type MatchResult } from './types.js'

export interface MatchRow {
  record: GameRecord
  rate: WinRate<'matches'> | null
}

export interface DeckRow extends MatchRow {
  deckId: string
}

export interface OpponentRow extends MatchRow {
  /** null groups the matches logged without an opponent. */
  key: string | null
  label: string
}

export type WentFirstKey = 'first' | 'second' | 'unknown'

export interface WentFirstRow extends MatchRow {
  key: WentFirstKey
  label: string
}

export interface ModeRow extends MatchRow {
  mode: MatchMode
  label: string
}

export interface RevisionRow extends MatchRow {
  revision: number | null
}

export interface MatchStatsReport {
  overall: MatchRow
  /** Most played first. */
  byDeck: DeckRow[]
  /** Most played first; «Sin rival anotado» last. */
  byOpponent: OpponentRow[]
  /** Always the three rows, in this order. */
  byWentFirst: WentFirstRow[]
  /** Only modes with matches, in MATCH_MODES order. */
  byMode: ModeRow[]
  /** Newest revision first; meaningful when the matches belong to one deck. */
  byRevision: RevisionRow[]
}

export const NO_OPPONENT_LABEL = 'Sin rival anotado'

export const WENT_FIRST_LABEL_ES: Readonly<Record<WentFirstKey, string>> = {
  first: 'Empecé yo',
  second: 'Empezó el rival',
  unknown: 'Sin dato',
}

const RESULT_FIELD: Record<MatchResult, keyof GameRecord> = { win: 'wins', loss: 'losses', tie: 'ties' }

export function tallyMatches(matches: readonly Pick<MatchFacts, 'result'>[]): GameRecord {
  const record: GameRecord = { ...EMPTY_RECORD }
  for (const match of matches) record[RESULT_FIELD[match.result]] += 1
  return record
}

export function matchRow(matches: readonly Pick<MatchFacts, 'result'>[]): MatchRow {
  const record = tallyMatches(matches)
  return { record, rate: matchWinRate(record) }
}

function groupBy<K>(matches: readonly MatchFacts[], keyOf: (match: MatchFacts) => K): Map<K, MatchFacts[]> {
  const groups = new Map<K, MatchFacts[]>()
  for (const match of matches) {
    const key = keyOf(match)
    const list = groups.get(key)
    if (list) list.push(match)
    else groups.set(key, [match])
  }
  return groups
}

function byGamesThen<T extends MatchRow>(tieBreak: (a: T, b: T) => number): (a: T, b: T) => number {
  const games = (row: T) => row.rate?.games ?? 0
  return (a, b) => games(b) - games(a) || tieBreak(a, b)
}

export function wentFirstKey(wentFirst: boolean | null): WentFirstKey {
  if (wentFirst === null) return 'unknown'
  return wentFirst ? 'first' : 'second'
}

export function matchStats(matches: readonly MatchFacts[]): MatchStatsReport {
  const labels = opponentLabels(matches)

  const byDeck = [...groupBy(matches, (match) => match.deckId)]
    .map(([deckId, list]): DeckRow => ({ deckId, ...matchRow(list) }))
    .sort(byGamesThen((a, b) => a.deckId.localeCompare(b.deckId, 'en', { numeric: true })))

  const byOpponent = [...groupBy(matches, (match) => opponentKey(match.opponent))]
    .map(
      ([key, list]): OpponentRow => ({
        key,
        label: key === null ? NO_OPPONENT_LABEL : (labels.get(key) ?? key),
        ...matchRow(list),
      }),
    )
    .sort((a, b) => {
      if ((a.key === null) !== (b.key === null)) return a.key === null ? 1 : -1
      return byGamesThen<OpponentRow>((x, y) => x.label.localeCompare(y.label, 'es'))(a, b)
    })

  const wentFirstGroups = groupBy(matches, (match) => wentFirstKey(match.wentFirst))
  const byWentFirst = (['first', 'second', 'unknown'] as const).map(
    (key): WentFirstRow => ({ key, label: WENT_FIRST_LABEL_ES[key], ...matchRow(wentFirstGroups.get(key) ?? []) }),
  )

  const modeGroups = groupBy(matches, (match) => match.mode)
  const byMode = MATCH_MODES.filter((mode) => modeGroups.has(mode)).map(
    (mode): ModeRow => ({ mode, label: MATCH_MODE_LABEL_ES[mode], ...matchRow(modeGroups.get(mode) ?? []) }),
  )

  const byRevision = [...groupBy(matches, (match) => match.deckRevision)]
    .map(([revision, list]): RevisionRow => ({ revision, ...matchRow(list) }))
    .sort((a, b) => (b.revision ?? -1) - (a.revision ?? -1))

  return { overall: matchRow(matches), byDeck, byOpponent, byWentFirst, byMode, byRevision }
}

export interface MatchFilter {
  deckId?: string | null | undefined
  mode?: MatchMode | null | undefined
  /** Inclusive lower bound of `playedAt`. */
  from?: Date | null | undefined
  /** Exclusive upper bound of `playedAt`. */
  to?: Date | null | undefined
  /** Grouping key (`opponentKey`) of the opponent. */
  opponentKey?: string | null | undefined
}

export function filterMatches<T extends MatchFacts>(matches: readonly T[], filter: MatchFilter): T[] {
  return matches.filter(
    (match) =>
      (!filter.deckId || match.deckId === filter.deckId) &&
      (!filter.mode || match.mode === filter.mode) &&
      (!filter.from || match.playedAt >= filter.from) &&
      (!filter.to || match.playedAt < filter.to) &&
      (!filter.opponentKey || opponentKey(match.opponent) === filter.opponentKey),
  )
}
