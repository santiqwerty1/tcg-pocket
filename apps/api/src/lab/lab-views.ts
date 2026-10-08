/** Response shapes of the Laboratorio de mazos (T-008, docs/API.md «Laboratorio»). Scores are `MetaScore` (0–100). */
import type {
  ExploreConfig,
  ExploreStop,
  GameRecord,
  GauntletSkip,
  MetaScore,
  NoveltyKind,
  TournamentFormat,
  WinRate,
} from '@tcg/domain'
import type { JobSummaryView } from '../simulation/simulation-views.js'

export interface CardLineView {
  cardId: string
  nameEs: string
  count: number
}

export interface LabBankRivalView {
  archetypeId: string
  archetypeName: string
  /** Share of the era's lists (0–100). */
  share: number
  /** Weight in the meta score (the shares normalized over the bank). */
  weight: number
  listKey: string
  /** Times the list was played in the era, and its tournament rate. */
  listLists: number
  listRate: WinRate | null
  /** 0 = the archetype's representative list; more = a later one (the earlier could not be simulated). */
  rank: number
  energies: string[]
  cards: CardLineView[]
}

export interface LabBankView {
  era: string
  format: TournamentFormat
  size: number
  /** Lists of the era. */
  lists: number
  /** Share of the era's lists the bank stands for (0–100). */
  coverage: number
  rivals: LabBankRivalView[]
  skipped: GauntletSkip[]
  engineRev: string
  attribution: string
}

export interface LabScoreView {
  score: MetaScore | null
  /** «52,3 % contra el meta (n = 1.000, IC 48,1–56,5 %)». */
  text: string
}

export interface LabNoveltyView {
  kind: NoveltyKind
  label: string
  /** Changes to the closest exact list of the era (null when the era has none). */
  swaps: number | null
  closestArchetype: string | null
  closestLists: number
  nearbyLists: number
  nearbyEntries: number
}

export interface LabRivalView {
  snapshot: number | null
  label: string
  archetypeId: string
  archetypeName: string
  share: number
  weight: number
  listKey: string
}

export interface LabDeckView {
  snapshot: number
  label: string
  deckId: string | null
  /** base: where the search started; best: what it found; variant: tried on the way; deck: tested against the meta. */
  role: 'base' | 'best' | 'variant' | 'deck'
  /** Search round the variant was born in. */
  round: number | null
  /** The search rounds' games (a test: every game). */
  search: LabScoreView
  /** The confirmation round's games (only base and best of a finished search). */
  confirm: LabScoreView | null
  /** Per rival, over the games of the headline score (the confirmation when there is one). */
  perRival: { rival: number; record: GameRecord; rate: WinRate | null }[]
  /** Card changes from the starting list (search variants). */
  changes: { add: CardLineView[]; remove: CardLineView[] } | null
  novelty: LabNoveltyView
  cards: CardLineView[]
  energies: string[]
  simulable: boolean
}

export interface LabExploreView {
  config: ExploreConfig
  poolEs: string
  phase: 'search' | 'confirm' | 'done'
  stopReason: ExploreStop | null
  stopReasonEs: string | null
  base: number
  best: number
  roundsDone: number
  rounds: {
    index: number
    kind: 'search' | 'confirm'
    incumbent: number
    candidates: number[]
    accepted: number | null
    decided: boolean
  }[]
  locked: CardLineView[]
  /** Fase 16: the event whose rules every variant keeps. */
  event: { id: string; name: string; rules: string[] } | null
}

export interface LabJobView {
  job: JobSummaryView
  mode: 'test' | 'explore'
  era: string
  format: TournamentFormat
  size: number
  rivals: LabRivalView[]
  decks: LabDeckView[]
  explore: LabExploreView | null
  /** «Juegan bots…»: always shown with the numbers. */
  note: string
}

/** Fase 19: a first list around 1–4 cards (POST /api/lab/core). */
export interface LabCoreView {
  era: string
  format: TournamentFormat
  pool: 'collection' | 'all'
  event: { id: string; name: string } | null
  /** Which lists the rest came from: the ones that play the whole core, part of it, or the whole era. */
  basis: { kind: 'together' | 'partial' | 'era'; lists: number; text: string }
  energies: string[]
  cards: (CardLineView & {
    groupId: string
    reason: 'core' | 'line' | 'usage'
    /** Share (0–100) of the basis lists that play it; null for the core and its line. */
    share: number | null
  })[]
  /** Core cards that could not go in. */
  left: { cardId: string; nameEs: string; reason: string }[]
  /** Errors of the draft as a deck (empty = it validates). */
  problems: string[]
  total: number
  attribution: string
}

export interface LabJobsView {
  items: (JobSummaryView & { mode: 'test' | 'explore'; era: string | null })[]
}
