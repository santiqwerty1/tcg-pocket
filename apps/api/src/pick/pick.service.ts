/**
 * ¿Qué mazo llevo hoy? (Fase 15): the decks built in the game, each with three separate numbers — own matches, what
 * its tournament archetype should score against today's meta (matchups weighted by the last two weeks), and its
 * latest Laboratorio score — never combined into one. Sorted by the source asked for (tournament by default).
 */
import { Injectable } from '@nestjs/common'
import type { DeckCardEntry, GameRecord, WinRate } from '@tcg/domain'
import { LabService } from '../lab/lab.service.js'
import { MatchesService } from '../matches/matches.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { TournamentsService } from '../tournaments/tournaments.service.js'

export type PickSort = 'tournament' | 'matches' | 'lab'

export interface PickRowView {
  deck: { id: string; name: string }
  archetype: { id: string; name: string; source: 'owner' | 'guessed' } | null
  /** Own matches with the deck (every mode). */
  mine: { record: GameRecord; rate: WinRate | null } | null
  /** The archetype's matchups weighted by today's meta. */
  tournament: { value: number; coverage: number; matches: number; rivals: number } | null
  /** Latest Laboratorio score of the current list. */
  lab: { value: number; ci95: [number, number]; games: number; text: string; jobId: number; era: string } | null
}

export interface PickView {
  sort: PickSort
  meta: { era: string; kind: 'recent' | 'era'; days: number; lists: number } | null
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

  async today(sort: PickSort = 'tournament'): Promise<PickView> {
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
    const today = await this.tournaments.todayExpectations().catch(() => null)
    const items: PickRowView[] = []
    for (const deck of decks) {
      const cards = deck.currentRevisionId === null ? null : revisions.get(deck.currentRevisionId)
      const placed =
        cards && today
          ? await this.tournaments.deckTournament(cards, deck.tournamentArchetypeId ?? null).catch(() => null)
          : null
      const ref = placed?.archetype?.archetype
      const archetype = ref?.id
        ? {
            id: ref.id,
            name: ref.name,
            source: placed?.archetype?.source === 'owner' ? ('owner' as const) : ('guessed' as const),
          }
        : null
      const expected = archetype && today ? today.expected(archetype.id) : null
      const score = await this.lab.deckScore(deck.id).catch(() => null)
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
      items,
      note: 'Tres números separados: tus partidas, lo que el arquetipo del mazo debería sacar contra el meta de los últimos días según torneos (personas), y el último puntaje del Laboratorio (bots). No se combinan: ordená por el que te importe.',
    }
  }
}
