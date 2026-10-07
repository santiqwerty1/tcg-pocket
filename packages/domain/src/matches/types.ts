/** Own matches (PLAN §3.6, M6): vocabulary shared by the API, the PWA and the MCP tools. */

export const MATCH_RESULTS = ['win', 'loss', 'tie'] as const
export type MatchResult = (typeof MATCH_RESULTS)[number]

/** Game modes as the plan names them (competitive = ranked, casual = random normal, beginner, event, friend). */
export const MATCH_MODES = ['competitive', 'casual', 'beginner', 'event', 'friend'] as const
export type MatchMode = (typeof MATCH_MODES)[number]

export const MATCH_RESULT_LABEL_ES: Readonly<Record<MatchResult, string>> = {
  win: 'Victoria',
  loss: 'Derrota',
  tie: 'Empate',
}

export const MATCH_MODE_LABEL_ES: Readonly<Record<MatchMode, string>> = {
  competitive: 'Competitiva',
  casual: 'Distendida',
  beginner: 'Principiante',
  event: 'Evento',
  friend: 'Amigo',
}

/** Mode of the very first match, before there is a «last used» one. */
export const DEFAULT_MATCH_MODE: MatchMode = 'casual'

/** Longest opponent text accepted (an archetype name, not a note). */
export const OPPONENT_MAX_LENGTH = 80
export const MATCH_NOTE_MAX_LENGTH = 2000

/** What the statistics read from a logged match. */
export interface MatchFacts {
  deckId: string
  /** Revision number of the deck when the match was played. */
  deckRevision: number | null
  result: MatchResult
  /** Free text as typed (cleaned); grouping uses `opponentKey`. */
  opponent: string | null
  wentFirst: boolean | null
  mode: MatchMode
  playedAt: Date
}
