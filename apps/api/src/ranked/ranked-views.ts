/** Response shapes of the ranked API (docs/API.md «Ranked»). */
import type { GameRecord, Rank, RankedSeason, WinRate } from '@tcg/domain'

/** A record with its rate and text («50 % (n = 4, IC …, orientativo)»). */
export interface RateRowView {
  record: GameRecord
  games: number
  rate: WinRate<'matches'> | null
  text: string
}

export interface RankChangeView {
  id: string
  at: string
  rank: Rank
  points: number | null
  label: string
}

/**
 * 18/10: the season and the rank a match was played at (its edit page; Claude): only a competitive match in a season
 * has them. `next`: the next rank noted in the season after it (the one it led to, or a later one).
 */
export interface MatchRankedView {
  matchId: string
  competitive: boolean
  season: { code: string; name: string } | null
  rank: RankChangeView | null
  next: RankChangeView | null
}

export interface SeasonSummaryView extends RateRowView {
  season: RankedSeason
  /** The last rank noted in the season. */
  rank: RankChangeView | null
  /** The curve: each rank noted, oldest first, with the decks played since the one before. */
  steps: (RankChangeView & {
    move: 'up' | 'down' | 'same' | null
    decks: ({ deckId: string; deckName: string } & RateRowView)[]
  })[]
  byRank: ({ rank: Rank | null; label: string } & RateRowView)[]
  byDeck: ({ deckId: string; deckName: string } & RateRowView)[]
}

export interface RankedView {
  timeZone: string
  /** YYYY-MM-DD in the owner's time zone. */
  today: string
  ranks: { code: Rank; label: string }[]
  seasons: (RankedSeason & RateRowView & { current: boolean; rankLabel: string | null })[]
  /** The season of today, with the rank noted last. */
  current: { code: string; name: string; endsOn: string; rank: RankChangeView | null } | null
  /** The season asked for, else the current one, else the last one that ended. */
  summary: SeasonSummaryView | null
}
