/**
 * Recent tournament lists to play against (Fase 23): the lists that placed well in the last days of the era, each
 * the exact list of a player in a tournament (by functional card, so two players with the same list are one row,
 * with the best placing kept and how many played it). For a game against the bot with a list that really won.
 */
import type { DatasetEntry, TournamentDataset } from './dataset.js'

export const RECENT_LISTS_DAYS = 7
/** Placings shown: the top 8 of each tournament. */
export const RECENT_LISTS_TOP = 8

export interface RecentList {
  listKey: string
  archetypeId: string | null
  archetypeName: string | null
  tournamentId: string
  tournamentName: string
  date: Date
  players: number
  playerName: string
  placing: number
  record: { wins: number; losses: number; ties: number }
  /** Players with this very list in the window (the row keeps the best placing). */
  pilots: number
  energies: string[]
}

export function recentLists(
  dataset: TournamentDataset,
  options: { days?: number; top?: number; limit?: number } = {},
): { from: Date | null; to: Date | null; lists: RecentList[] } {
  const days = options.days ?? RECENT_LISTS_DAYS
  const top = options.top ?? RECENT_LISTS_TOP
  const newest = dataset.entries.reduce((max, entry) => Math.max(max, entry.date.getTime()), 0)
  if (newest === 0) return { from: null, to: null, lists: [] }
  const from = newest - (days - 1) * 24 * 60 * 60 * 1000
  const tournaments = new Map(dataset.tournaments.map((tournament) => [tournament.id, tournament]))
  const better = (a: DatasetEntry, b: DatasetEntry) =>
    (a.placing ?? Number.POSITIVE_INFINITY) - (b.placing ?? Number.POSITIVE_INFINITY) ||
    b.date.getTime() - a.date.getTime()
  const byKey = new Map<string, { best: DatasetEntry; pilots: number }>()
  for (const entry of dataset.entries) {
    if (entry.date.getTime() < from || entry.keyByGroup === null) continue
    if (entry.placing === null || entry.placing > top) continue
    const row = byKey.get(entry.keyByGroup)
    if (!row) byKey.set(entry.keyByGroup, { best: entry, pilots: 1 })
    else {
      row.pilots += 1
      if (better(entry, row.best) < 0) row.best = entry
    }
  }
  const lists = [...byKey.entries()]
    .map(([listKey, { best, pilots }]) => {
      const tournament = tournaments.get(best.tournamentId)
      return {
        listKey,
        archetypeId: best.archetypeId,
        archetypeName: best.archetypeId ? (dataset.archetypes.get(best.archetypeId)?.name ?? best.archetypeId) : null,
        tournamentId: best.tournamentId,
        tournamentName: tournament?.name ?? best.tournamentId,
        date: best.date,
        players: tournament?.players ?? 0,
        playerName: best.playerName,
        placing: best.placing ?? 0,
        record: { wins: best.record.wins, losses: best.record.losses, ties: best.record.ties },
        pilots,
        energies: best.energies,
      }
    })
    .sort((a, b) => a.placing - b.placing || b.players - a.players || b.date.getTime() - a.date.getTime())
  return {
    from: new Date(from),
    to: new Date(newest),
    lists: options.limit ? lists.slice(0, options.limit) : lists,
  }
}
