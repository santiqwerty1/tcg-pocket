/**
 * ¿Qué mazo llevo hoy? (Fase 15): the decks built in the game, each with three separate numbers — own matches, what
 * its tournament archetype should score against today's meta (matchups weighted by the last two weeks), and its
 * latest Laboratorio score — never combined into one. Sorted by the source asked for (tournament by default).
 * H-007 (Fase 36): the era is resolved once per request and the Laboratorio scores come in one batch, of the current
 * engine only (it used to cost hundreds of queries every time «Hoy» opened).
 */
import { Injectable } from '@nestjs/common'
import type { DeckCardEntry, GameRecord, WinRate } from '@tcg/domain'
import { type DeckLabScore, LabService } from '../lab/lab.service.js'
import type { MyMetaSummary } from '../matches/match-views.js'
import { MatchesService } from '../matches/matches.service.js'
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
  /** Latest Laboratorio score of the current list. */
  lab: { value: number; ci95: [number, number]; games: number; text: string; jobId: number; era: string } | null
}

export type PickMeta = 'tournament' | 'mine'

export interface PickView {
  sort: PickSort
  meta: { era: string; kind: 'recent' | 'era'; days: number; lists: number } | null
  /** Fase 44: which weights the tournament number used; «mine» falls back to the tournament meta until it is enough. */
  weights: { asked: PickMeta; used: PickMeta; mine: MyMetaSummary | null }
  items: PickRowView[]
  note: string
}

@Injectable()
export class PickService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matches: MatchesService,
    private readonly tournaments: TournamentsService,
    private readonly lab: LabService,
  ) {}

  async today(sort: PickSort = 'tournament', asked: PickMeta = 'tournament'): Promise<PickView> {
    const decks = await this.prisma.deck.findMany({
      where: { builtInGame: true, archivedAt: null },
      select: { id: true, name: true, currentRevisionId: true, tournamentArchetypeId: true },
      orderBy: { id: 'asc' },
    })
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
      .todayExpectations({}, used === 'mine' && mineMeta ? { shares: mineMeta.shares } : {})
      .catch(() => null)
    const scores = await this.lab.deckScores(decks.map((deck) => deck.id)).catch(() => new Map<number, DeckLabScore>())
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
      const score = scores.get(deck.id) ?? null
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
            }
          : null,
      })
    }
    const key = (row: PickRowView): number | null =>
      sort === 'matches'
        ? (row.mine?.rate?.value ?? null)
        : sort === 'lab'
          ? (row.lab?.value ?? null)
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
        mine: mineMeta
          ? { text: mineMeta.text, enough: mineMeta.enough, coverage: mineMeta.coverage, matched: mineMeta.matched }
          : null,
      },
      items,
      note:
        used === 'mine'
          ? 'Tres números separados: tus partidas, lo que el arquetipo del mazo debería sacar contra los rivales que te tocan a vos (tus partidas recientes, con los matchups de torneos entre personas), y el último puntaje del Laboratorio (bots). No se combinan: ordená por el que te importe.'
          : 'Tres números separados: tus partidas, lo que el arquetipo del mazo debería sacar contra el meta de los últimos días según torneos (personas), y el último puntaje del Laboratorio (bots). No se combinan: ordená por el que te importe.',
    }
  }
}
