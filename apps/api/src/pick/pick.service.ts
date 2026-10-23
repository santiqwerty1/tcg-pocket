/**
 * ¿Qué mazo llevo hoy? (Fase 15): the decks built in the game, each with three separate numbers — own matches, what
 * its tournament archetype should score against today's meta (matchups weighted by the last two weeks), and its
 * latest Laboratorio score — never combined into one. Sorted by the source asked for (tournament by default).
 * H-007 (Fase 36): the era is resolved once per request and the Laboratorio scores come in one batch, of the current
 * engine only (it used to cost hundreds of queries every time «Hoy» opened).
 * H-055: next to the Laboratorio's number, «posible punto ciego del bot» when the list has cards the e bots play badly
 * or the number is far from the tournament one.
 */
import { Injectable } from '@nestjs/common'
import {
  botWarnings,
  botWarningText,
  type CatalogIndex,
  type DeckCardEntry,
  type GameRecord,
  type WinRate,
} from '@tcg/domain'
import { CatalogService } from '../catalog/catalog.service.js'
import { type DeckLabScore, type DeckLabStatus, LabService } from '../lab/lab.service.js'
import { bankShares } from '../lab/lab-blind-spots.js'
import type { LabRefreshView } from '../lab/lab-views.js'
import type { MyMetaSummary } from '../matches/match-views.js'
import { MatchesService, myMetaSummary } from '../matches/matches.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { DeckTournamentView } from '../tournaments/tournament-views.js'
import { TournamentsService } from '../tournaments/tournaments.service.js'

export type PickSort = 'tournament' | 'matches' | 'lab'

export interface PickRowView {
  deck: { id: string; name: string }
  archetype: { id: string; name: string; source: 'owner' | 'guessed' } | null
  /** Own matches with the deck (every mode). */
  mine: { record: GameRecord; rate: WinRate | null } | null
  /** The archetype's matchups weighted by today's meta (or by «mi meta», Fase 44). */
  tournament: { value: number; ci95: [number, number]; coverage: number; matches: number; rivals: number } | null
  /**
   * Latest Laboratorio score of the current list: of the current era, or of another one (`stale`, shown as old) when
   * this era has none.
   */
  lab: {
    value: number
    ci95: [number, number]
    games: number
    text: string
    jobId: number
    era: string
    /** The bots (the Laboratorio's default, D-029). */
    bot: string
    stale: boolean
    finishedAt: string | null
  } | null
  /** The latest score of this era with each other bot (e3, f2…), apart. */
  labOthers: { bot: string; value: number; ci95: [number, number]; games: number; jobId: number }[]
  /** Review of #109: the list's last test failed before playing it whole: «Reintentar lo que falló» on that job. */
  labFailed: { jobId: number } | null
  /** «Actualizar todos»: the test of the list against this era's meta, queued or playing now. */
  labRunning: { jobId: number; status: 'queued' | 'running'; gamesDone: number; totalGames: number } | null
  /**
   * Whether the engine can play the list (D-029 review): without it «Actualizar todos» leaves the deck out, so a row
   * without a score says so instead of asking for it. Null when the deck has no list to look at.
   */
  labSimulable: boolean | null
  /**
   * H-055: «posible punto ciego del bot» of the Laboratorio's number: the list's cards the e bots play badly, and the
   * number far from what the archetype makes in tournaments against the same rivals (only a score of this era). Null
   * without a Laboratorio score or when nothing applies.
   */
  blindSpot: { text: string } | null
}

export type PickMeta = 'tournament' | 'mine'

export interface PickView {
  sort: PickSort
  meta: {
    era: string
    kind: 'recent' | 'era'
    days: number
    lists: number
    /** Phone review: the window's dates, up to the newest tournament loaded. */
    from: string | null
    to: string | null
  } | null
  /** Fase 44: which weights the tournament number used; «mine» falls back to the tournament meta until it is enough. */
  weights: { asked: PickMeta; used: PickMeta; mine: MyMetaSummary | null }
  items: PickRowView[]
  /** «Actualizar todos»: the decks whose list has no Laboratorio score of this era and is not under test now. */
  labDue: number
  note: string
}

@Injectable()
export class PickService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matches: MatchesService,
    private readonly tournaments: TournamentsService,
    private readonly lab: LabService,
    private readonly catalog: CatalogService,
  ) {}

  async today(sort: PickSort = 'tournament', asked: PickMeta = 'tournament'): Promise<PickView> {
    const decks = await this.decks()

    const revisions = new Map(
      (
        await this.prisma.deckRevision.findMany({
          where: { id: { in: decks.map((deck) => deck.currentRevisionId).filter((id): id is number => id !== null) } },
          select: { id: true, cards: true },
        })
      ).map((row) => [row.id, row.cards as unknown as DeckCardEntry[]]),
    )
    const stats = await this.matches.stats({})
    const mine = new Map(stats.byDeck.map((row) => [row.deck.id, { record: row.record, rate: row.rate }]))
    // H-007: the era, its dataset and the aliases once, and the Laboratorio scores in one go.
    const mineMeta = asked === 'mine' ? await this.matches.myMeta({}).catch(() => null) : null
    const used: PickMeta = mineMeta?.enough ? 'mine' : 'tournament'
    const today = await this.tournaments
      .todayExpectations(
        {},
        used === 'mine' && mineMeta ? { shares: mineMeta.shares, sharesSample: mineMeta.effectiveMatches } : {},
      )
      .catch(() => null)
    const era = today?.scope.era ?? (await this.tournaments.currentEra().catch(() => undefined))
    const scores = await this.lab
      .deckLabStatus(
        decks.map((deck) => deck.id),
        era,
      )
      .catch(() => new Map<number, DeckLabStatus>())
    let index: CatalogIndex | null = null
    try {
      index = this.catalog.requireIndex()
    } catch {
      index = null
    }
    // One evaluator per era and format of the scores (review of #119): the scope, aliases and matchups are read once, not
    // once per deck.
    type Expectations = Awaited<ReturnType<TournamentsService['expectationsWith']>>
    const scopes = new Map<string, Promise<Expectations | null>>()
    const expectationsFor = (score: DeckLabScore) => {
      const key = `${score.era}|${score.format}`
      let found = scopes.get(key)
      if (!found) {
        found = this.tournaments.expectationsWith({ era: score.era, format: score.format }).catch(() => null)
        scopes.set(key, found)
      }
      return found
    }
    const items: PickRowView[] = []
    for (const deck of decks) {
      const cards = deck.currentRevisionId === null ? null : revisions.get(deck.currentRevisionId)
      let placed: DeckTournamentView | null = null
      if (cards && today) {
        try {
          placed = today.place(cards, deck.tournamentArchetypeId ?? null)
        } catch {
          placed = null
        }
      }
      const ref = placed?.archetype?.archetype
      const archetype = ref?.id
        ? {
            id: ref.id,
            name: ref.name,
            source: placed?.archetype?.source === 'owner' ? ('owner' as const) : ('guessed' as const),
          }
        : null
      const expected = archetype && today ? today.expected(archetype.id) : null
      const status = scores.get(deck.id) ?? null
      const score = status?.score ?? null
      const labScore = score?.score.score ?? null
      // H-055: the list rules for the bot that played it; the general rule only within the era, against what the
      // archetype makes in tournaments against the test's own rivals with its weights, era and format (review of #119:
      // the row's number is against the whole recent meta, or «mi meta», while a bank can have 3 rivals).
      // Review of #119: a score that is not of every rival (a list that is itself in the bank plays no pairing against
      // itself) is reweighted over the rest, so it is not compared.
      const expectations =
        labScore && score && archetype && !status?.stale && labScore.coverage >= 0.999
          ? await expectationsFor(score)
          : null
      let bank: ReturnType<Expectations> = null
      try {
        bank = expectations && archetype && score ? expectations(archetype.id, bankShares(score.rivals)) : null
      } catch {
        bank = null
      }
      const warning =
        labScore && score && cards && index
          ? botWarningText(
              botWarnings({
                cards,
                index,
                bot: score.bot,
                simulated: bank ? labScore : null,
                tournament: bank,
              }),
              score.bot,
            )
          : null
      items.push({
        deck: { id: String(deck.id), name: deck.name },
        archetype,
        mine: mine.get(String(deck.id)) ?? null,
        tournament: expected,
        lab: score?.score.score
          ? {
              value: score.score.score.value,
              ci95: score.score.score.ci95,
              games: score.score.score.games,
              text: score.score.text,
              jobId: score.jobId,
              era: score.era,
              bot: score.bot,
              stale: status?.stale ?? false,
              finishedAt: score.finishedAt?.toISOString() ?? null,
            }
          : null,
        labOthers: (status?.others ?? []).flatMap((found) =>
          found.score.score
            ? [
                {
                  bot: found.bot,
                  value: found.score.score.value,
                  ci95: found.score.score.ci95,
                  games: found.score.score.games,
                  jobId: found.jobId,
                },
              ]
            : [],
        ),
        labFailed: status?.failed ?? null,
        labRunning: status?.running ?? null,
        labSimulable: status ? status.simulable : null,
        blindSpot: warning ? { text: warning } : null,
      })
    }
    const key = (row: PickRowView): number | null =>
      sort === 'matches'
        ? (row.mine?.rate?.value ?? null)
        : sort === 'lab'
          ? row.lab && !row.lab.stale
            ? row.lab.value
            : null
          : (row.tournament?.value ?? null)
    items.sort((a, b) => {
      const x = key(a)
      const y = key(b)
      if (x === null && y === null) return a.deck.name.localeCompare(b.deck.name, 'es')
      if (x === null) return 1
      if (y === null) return -1
      return y - x
    })
    return {
      sort,
      meta: today ? { era: today.scope.era, ...today.meta } : null,
      weights: {
        asked,
        used,
        mine: mineMeta ? myMetaSummary(mineMeta) : null,
      },
      items,
      labDue: [...scores.values()].filter(
        (status) => status.simulable && !status.running && !status.failed && (!status.score || status.stale),
      ).length,
      note:
        used === 'mine'
          ? 'Tres números separados: tus partidas, lo que el arquetipo del mazo debería sacar según torneos (personas) pesado por tus rivales de la era («mi meta»: los matchups son de torneos, los pesos salen de tus partidas, y su intervalo cuenta las dos cosas), y el último puntaje del Laboratorio (bots). No se combinan: ordená por el que te importe.'
          : 'Tres números separados: tus partidas, lo que el arquetipo del mazo debería sacar contra el meta de los últimos días según torneos (personas), y el último puntaje del Laboratorio (bots). No se combinan: ordená por el que te importe.',
    }
  }

  /** «Actualizar todos»: a test against this era's meta of every deck built in the game whose list needs one. */
  async refreshLab(dryRun = false): Promise<LabRefreshView> {
    const decks = await this.decks()
    return this.lab.refreshDecks(
      decks.map((deck) => deck.id),
      dryRun,
    )
  }

  /** The decks built in the game and not archived. */
  private decks() {
    return this.prisma.deck.findMany({
      where: { builtInGame: true, archivedAt: null },
      select: { id: true, name: true, currentRevisionId: true, tournamentArchetypeId: true },
      orderBy: { id: 'asc' },
    })
  }
}
