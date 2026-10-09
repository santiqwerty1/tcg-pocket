/** Response shapes of the Laboratorio de mazos (T-008, docs/API.md «Laboratorio»). Scores are `MetaScore` (0–100). */
import type {
  ExploreConfig,
  ExploreStop,
  GameRecord,
  GauntletSkip,
  MetaScore,
  NoveltyKind,
  PerGameSummary,
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
  /**
   * T-017 A2: what its games say beyond the rate (going first and second, how its losses ended, how far it evolved),
   * over the headline games, every rival together and unweighted; null without per-game results.
   */
  games: LabGamesView | null
  /** Per rival, over the games of the headline score (the confirmation when there is one). */
  perRival: { rival: number; record: GameRecord; rate: WinRate | null }[]
  /** Card changes from the starting list (search variants). */
  changes: { add: CardLineView[]; remove: CardLineView[] } | null
  /**
   * T-017 E1: a variant against the list it came from, in its round (game by game when there are per-game results):
   * «+3,2 puntos (IC −1,0 a +7,4)». Null for the starting list and tests.
   */
  vsParent: {
    text: string
    value: number | null
    ci95: [number, number] | null
    paired: boolean
    /** Review of #20: «verify» when its verification measured it (fresh seeds); «round», the round that picked it. */
    measuredIn: 'verify' | 'round'
    /** False when a list missed a rival in that round (a failed chunk, «Frenar»): no difference then. */
    complete: boolean
    /** With a verification: the difference in the round that picked it, which flatters it. */
    selectionText: string | null
  } | null
  /**
   * T-017 E1/E2: why each card that came in was proposed (share of the era's lists and of the archetype's lists that
   * play it, when the search kept them) and how many copies the collection lacks for it.
   */
  why: { cardId: string; nameEs: string; eraShare: number | null; archetypeShare: number | null; missing: number }[]
  novelty: LabNoveltyView
  cards: CardLineView[]
  energies: string[]
  simulable: boolean
}

/** T-017 A2: `PerGameSummary` plus what the screen needs (review of #7). */
export interface LabGamesView extends PerGameSummary {
  /** Games in those chunks; `games` is how many of them carry per-game results. */
  total: number
  /** Whether the list plays a Stage 2 Pokémon: without one, «reached Stage 2» is left out. */
  hasStage2: boolean
  /** Win rates going first and second, with n and interval («orientativo» under 30 games). */
  firstRate: WinRate | null
  secondRate: WinRate | null
}

export interface LabExploreView {
  config: ExploreConfig
  poolEs: string
  phase: 'search' | 'confirm' | 'done'
  stopReason: ExploreStop | null
  stopReasonEs: string | null
  /** T-017 D2: «Frenar y confirmar» was asked; the search ends its round (or its verification) and confirms. */
  stopRequested: boolean
  base: number
  best: number
  roundsDone: number
  rounds: {
    index: number
    /** H-010: «verify» replays the incumbent and the screened variant with fresh seeds before accepting it. */
    kind: 'search' | 'verify' | 'confirm'
    incumbent: number
    candidates: number[]
    accepted: number | null
    /** The search round's best variant that passed the screen (it then goes to verification). */
    screened: number | null
    decided: boolean
    /** T-017 D2: «Frenar y confirmar» cut this round short. */
    stopped: boolean
  }[]
  /**
   * T-017 E2: cards most lists of the archetype play (30 % or more) that the search could not try because the
   * collection has none, most played first.
   */
  leftOut: { cardId: string; nameEs: string; archetypeShare: number }[]
  /**
   * T-017 C4: what the rounds measured about each card change, the clearest first (points of meta score, shrunk toward
   * 0; «+» came in, «−» went out). It steers the draws; it never decides what is accepted.
   */
  learned: { sign: '+' | '-'; cardId: string; nameEs: string; mean: number; n: number }[]
  /** Snapshot ids of the variants that joined the two best swaps measured so far. */
  combos: number[]
  /**
   * H-010: what the confirmation says of the list found against the starting one; null without a confirmation.
   * «better» only past `verifyZ` standard errors.
   */
  confirmation: {
    verdict: 'better' | 'unclear' | 'worse'
    verdictEs: string
    /** Points of the found list over the starting one, with its 95 % interval («+5,2 puntos (IC +1,0 a +9,4)»). */
    differenceText: string
    difference: { value: number; se: number; ci95: [number, number] }
  } | null
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
