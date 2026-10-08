/**
 * Own matches (PLAN §3.6, M6): quick logging, list and edit, statistics with Wilson intervals and the per-deck
 * comparison with three separate columns. The rules (opponent grouping, rates, picker order, revision at the time
 * of the match) live in @tcg/domain; this service persists `matches` and shapes responses.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  cleanOpponent,
  DEFAULT_MATCH_MODE,
  type DeckCardEntry,
  filterMatches,
  formatPercentEs,
  type MatchFacts,
  type MatchMode,
  type MatchResult,
  matchStats,
  opponentKey,
  orderDecksForPicker,
  revisionAt,
  suggestOpponents,
} from '@tcg/domain'
import type { Prisma } from '../generated/prisma/client.js'
import type { MatchSource } from '../generated/prisma/enums.js'
import { idToString, parseNumericId } from '../http/ids.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { TournamentsService } from '../tournaments/tournaments.service.js'
import type {
  ComparisonColumnView,
  DeckComparisonView,
  MatchDeckRef,
  MatchStatsView,
  MatchSuggestionsView,
  MatchView,
  RowView,
} from './match-views.js'

export interface MatchInput {
  deckId: string
  result: MatchResult
  opponent?: string | null | undefined
  wentFirst?: boolean | null | undefined
  /** Default: the mode of the last logged match. */
  mode?: MatchMode | undefined
  note?: string | undefined
  /** ISO 8601; default: now (server clock, so a phone with a wrong clock does not matter). */
  playedAt?: string | undefined
}

export type MatchPatch = Partial<MatchInput>

export interface MatchListQuery {
  deckId?: string | undefined
  mode?: MatchMode | undefined
  result?: MatchResult | undefined
  /** Free text: matches whose opponent key contains its key («blaz» finds «Mega-Blaziken ex»). */
  opponent?: string | undefined
  from?: string | undefined
  to?: string | undefined
  limit: number
  offset: number
}

export interface MatchStatsQuery {
  deckId?: string | undefined
  mode?: MatchMode | undefined
  from?: string | undefined
  to?: string | undefined
}

/** A match dated more than this into the future is refused (typo in the date, not clock skew). */
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000
/** Opponent suggestions are computed over the last year of matches. */
const SUGGESTIONS_WINDOW_MS = 365 * 24 * 60 * 60 * 1000
const SUGGESTED_OPPONENTS = 30

const matchInclude = {
  deck: { select: { id: true, name: true, archivedAt: true } },
  deckRevision: { select: { number: true } },
} satisfies Prisma.MatchInclude

type MatchRecord = Prisma.MatchGetPayload<{ include: typeof matchInclude }>

function deckRef(deck: { id: number; name: string; archivedAt: Date | null }): MatchDeckRef {
  return { id: idToString(deck.id), name: deck.name, archived: deck.archivedAt !== null }
}

function toView(record: MatchRecord): MatchView {
  return {
    id: idToString(record.id),
    deck: deckRef(record.deck),
    deckRevision: record.deckRevision.number,
    result: record.result,
    opponent: record.opponentText,
    wentFirst: record.wentFirst,
    mode: record.mode,
    note: record.note,
    playedAt: record.playedAt,
    source: record.source,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** What is stored: the cleaned text, or null when it has nothing to group by («---», blanks). */
function storedOpponent(raw: string | null | undefined): string | null {
  const cleaned = cleanOpponent(raw)
  return opponentKey(cleaned) === null ? null : cleaned
}

function parseDate(raw: string | undefined, field: string): Date | undefined {
  if (raw === undefined) return undefined
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException({ code: 'validation', message: `Fecha inválida en ${field}.` })
  }
  return date
}

function assertNotFuture(playedAt: Date, now = new Date()): void {
  if (playedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    throw new BadRequestException({
      code: 'played_at_future',
      message: 'La fecha de la partida está en el futuro.',
    })
  }
}

function assertRange(from: Date | undefined, to: Date | undefined): void {
  if (from && to && from.getTime() > to.getTime()) {
    throw new BadRequestException({ code: 'validation', message: '«Desde» es posterior a «hasta».' })
  }
}

@Injectable()
export class MatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tournaments: TournamentsService,
  ) {}

  // ---------------------------------------------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------------------------------------------

  async list(query: MatchListQuery): Promise<{ items: MatchView[]; total: number }> {
    const from = parseDate(query.from, 'from')
    const to = parseDate(query.to, 'to')
    assertRange(from, to)
    const where: Prisma.MatchWhereInput = {
      ...(query.deckId ? { deckId: parseNumericId(query.deckId, 'Mazo') } : {}),
      ...(query.mode ? { mode: query.mode } : {}),
      ...(query.result ? { result: query.result } : {}),
      ...(from || to ? { playedAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    }
    const orderBy: Prisma.MatchOrderByWithRelationInput[] = [{ playedAt: 'desc' }, { id: 'desc' }]
    const key = opponentKey(query.opponent ?? null)
    if (key === null) {
      const [records, total] = await Promise.all([
        this.prisma.match.findMany({ where, include: matchInclude, orderBy, skip: query.offset, take: query.limit }),
        this.prisma.match.count({ where }),
      ])
      return { items: records.map(toView), total }
    }
    // The opponent groups by a normalized key the database does not know: filter in memory (a few thousand rows).
    const records = (await this.prisma.match.findMany({ where, include: matchInclude, orderBy })).filter(
      (record) => opponentKey(record.opponentText)?.includes(key) ?? false,
    )
    return {
      items: records.slice(query.offset, query.offset + query.limit).map(toView),
      total: records.length,
    }
  }

  async get(rawId: string): Promise<MatchView> {
    return toView(await this.requireMatch(rawId))
  }

  /** Defaults and suggestions of the quick-entry sheet. */
  async suggestions(now = new Date()): Promise<MatchSuggestionsView> {
    const [decks, perDeck, recent, last] = await Promise.all([
      this.prisma.deck.findMany({
        where: { archivedAt: null },
        select: { id: true, name: true, builtInGame: true, currentRevisionId: true, energies: true },
      }),
      this.prisma.match.groupBy({ by: ['deckId'], _max: { playedAt: true }, _count: { _all: true } }),
      this.prisma.match.findMany({
        where: { playedAt: { gte: new Date(now.getTime() - SUGGESTIONS_WINDOW_MS) }, opponentText: { not: null } },
        select: { opponentText: true, playedAt: true },
      }),
      this.prisma.match.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { deckId: true, mode: true, deck: { select: { archivedAt: true } } },
      }),
    ])
    const revisionIds = decks.map((deck) => deck.currentRevisionId).filter((id): id is number => id !== null)
    const energiesByRevision = new Map(
      (
        await this.prisma.deckRevision.findMany({
          where: { id: { in: revisionIds } },
          select: { id: true, energies: true },
        })
      ).map((revision) => [revision.id, revision.energies]),
    )
    const played = new Map(perDeck.map((row) => [row.deckId, row]))
    const ordered = orderDecksForPicker(
      decks.map((deck) => ({
        id: idToString(deck.id),
        name: deck.name,
        builtInGame: deck.builtInGame,
        archived: false,
        lastPlayedAt: played.get(deck.id)?._max.playedAt ?? null,
        energies:
          (deck.currentRevisionId === null ? undefined : energiesByRevision.get(deck.currentRevisionId)) ??
          deck.energies,
        games: played.get(deck.id)?._count._all ?? 0,
      })),
    )
    return {
      decks: ordered.map(({ archived: _archived, ...deck }) => deck),
      lastDeckId: last && last.deck.archivedAt === null ? idToString(last.deckId) : null,
      lastMode: last?.mode ?? DEFAULT_MATCH_MODE,
      opponents: suggestOpponents(
        recent.map((row) => ({ opponent: row.opponentText, playedAt: row.playedAt })),
        { now, limit: SUGGESTED_OPPONENTS },
      ),
      tournamentArchetypes: await this.tournaments.opponentArchetypes(),
    }
  }

  async stats(query: MatchStatsQuery): Promise<MatchStatsView> {
    const deckId = query.deckId ? parseNumericId(query.deckId, 'Mazo') : undefined
    if (deckId !== undefined) await this.requireDeckRef(deckId)
    const from = parseDate(query.from, 'from')
    const to = parseDate(query.to, 'to')
    assertRange(from, to)
    const { facts, decks } = await this.loadFacts()
    const selected = filterMatches(facts, {
      deckId: deckId === undefined ? null : idToString(deckId),
      mode: query.mode ?? null,
      from: from ?? null,
      to: to ?? null,
    })
    const report = matchStats(selected)
    const row = ({ record, rate }: RowView): RowView => ({ record, rate })
    return {
      filters: {
        deckId: deckId === undefined ? null : idToString(deckId),
        mode: query.mode ?? null,
        from: from?.toISOString() ?? null,
        to: to?.toISOString() ?? null,
      },
      overall: row(report.overall),
      byDeck: report.byDeck.map((item) => ({
        deck: decks.get(item.deckId) ?? { id: item.deckId, name: `Mazo ${item.deckId}`, archived: false },
        ...row(item),
      })),
      byOpponent: report.byOpponent.map((item) => ({ key: item.key, label: item.label, ...row(item) })),
      byWentFirst: report.byWentFirst.map((item) => ({ key: item.key, label: item.label, ...row(item) })),
      byMode: report.byMode.map((item) => ({ mode: item.mode, label: item.label, ...row(item) })),
      byRevision:
        deckId === undefined ? [] : report.byRevision.map((item) => ({ revision: item.revision, ...row(item) })),
    }
  }

  /** Per deck: own matches, tournament and simulation side by side; the last two arrive in Fases 5 and 6. */
  async comparison(rawDeckId: string, mode: MatchMode | undefined): Promise<DeckComparisonView> {
    const deck = await this.requireDeckRef(parseNumericId(rawDeckId, 'Mazo'))
    const stats = await this.stats({ deckId: deck.id, mode })
    const games = stats.overall.rate?.games ?? 0
    return {
      deck,
      columns: [
        {
          source: 'matches',
          label: 'Mis partidas',
          available: true,
          record: stats.overall.record,
          rate: stats.overall.rate,
          note:
            games === 0
              ? 'Todavía no registraste partidas con este mazo.'
              : `Partidas registradas en la app${mode ? ' (filtradas por modalidad)' : ', todas las modalidades'}.`,
        },
        await this.tournamentColumn(Number(deck.id)),
        {
          source: 'simulation',
          label: 'Simulación',
          available: false,
          record: null,
          rate: null,
          note: 'Las simulaciones con el motor deckgym llegan en la Fase 6.',
        },
      ],
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------------------------------------------

  async create(input: MatchInput, source: MatchSource = 'ui'): Promise<MatchView> {
    const deck = await this.requireDeckWithRevisions(input.deckId)
    const explicit = parseDate(input.playedAt, 'playedAt')
    const playedAt = explicit ?? new Date()
    assertNotFuture(playedAt)
    // Logged now: the current revision. Dated by hand: the revision that was current at that time.
    const revision =
      (explicit ? undefined : deck.revisions.find((item) => item.id === deck.currentRevisionId)) ??
      revisionAt(deck.revisions, playedAt)
    const mode = input.mode ?? (await this.lastMode())
    const created = await this.prisma.match.create({
      data: {
        deckId: deck.id,
        deckRevisionId: revision.id,
        result: input.result,
        opponentText: storedOpponent(input.opponent),
        wentFirst: input.wentFirst ?? null,
        mode,
        note: input.note?.trim() ?? '',
        playedAt,
        source,
      },
      include: matchInclude,
    })
    return toView(created)
  }

  async patch(rawId: string, patch: MatchPatch): Promise<MatchView> {
    const current = await this.requireMatch(rawId)
    const data: Prisma.MatchUncheckedUpdateInput = {}
    const playedAt = parseDate(patch.playedAt, 'playedAt')
    if (playedAt) assertNotFuture(playedAt)
    const deckChanged = patch.deckId !== undefined && parseNumericId(patch.deckId, 'Mazo') !== current.deckId
    if (deckChanged || (playedAt && playedAt.getTime() !== current.playedAt.getTime())) {
      // The revision follows the deck and the date: it is the one that was current when the match was played.
      const deck = await this.requireDeckWithRevisions(patch.deckId ?? idToString(current.deckId))
      data.deckId = deck.id
      data.deckRevisionId = revisionAt(deck.revisions, playedAt ?? current.playedAt).id
    }
    if (playedAt) data.playedAt = playedAt
    if (patch.result !== undefined) data.result = patch.result
    if (patch.opponent !== undefined) data.opponentText = storedOpponent(patch.opponent)
    if (patch.wentFirst !== undefined) data.wentFirst = patch.wentFirst
    if (patch.mode !== undefined) data.mode = patch.mode
    if (patch.note !== undefined) data.note = patch.note.trim()
    if (Object.keys(data).length === 0) return toView(current)
    const updated = await this.prisma.match.update({ where: { id: current.id }, data, include: matchInclude })
    return toView(updated)
  }

  async delete(rawId: string): Promise<void> {
    const match = await this.requireMatch(rawId)
    await this.prisma.match.delete({ where: { id: match.id } })
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------------------------

  private async requireMatch(rawId: string): Promise<MatchRecord> {
    const id = parseNumericId(rawId, 'Partida')
    const record = await this.prisma.match.findUnique({ where: { id }, include: matchInclude })
    if (!record) throw new NotFoundException(`Partida ${rawId} no encontrada.`)
    return record
  }

  private async requireDeckWithRevisions(rawDeckId: string) {
    const id = parseNumericId(rawDeckId, 'Mazo')
    const deck = await this.prisma.deck.findUnique({
      where: { id },
      select: {
        id: true,
        currentRevisionId: true,
        revisions: { select: { id: true, number: true, createdAt: true } },
      },
    })
    if (!deck) throw new NotFoundException(`Mazo ${rawDeckId} no encontrado.`)
    return deck
  }

  /**
   * Tournament column: the exact list (by functional card, and by name when it differs) and the archetype, as
   * separate rows; the headline is the exact list when someone played it, otherwise the archetype.
   */
  private async tournamentColumn(deckId: number): Promise<ComparisonColumnView> {
    const deck = await this.prisma.deck.findUnique({
      where: { id: deckId },
      select: { currentRevisionId: true, tournamentArchetypeId: true },
    })
    const revision =
      deck?.currentRevisionId == null
        ? null
        : await this.prisma.deckRevision.findUnique({ where: { id: deck.currentRevisionId }, select: { cards: true } })
    const empty = (note: string): ComparisonColumnView => ({
      source: 'tournament',
      label: 'Torneo',
      available: false,
      record: null,
      rate: null,
      note,
    })
    if (!revision) return empty('El mazo no tiene lista guardada.')
    let view: Awaited<ReturnType<TournamentsService['deckTournament']>>
    try {
      view = await this.tournaments.deckTournament(
        revision.cards as unknown as DeckCardEntry[],
        deck?.tournamentArchetypeId ?? null,
      )
    } catch {
      return empty('Todavía no hay datos de torneo sincronizados.')
    }
    const tournaments = `${view.scope.tournaments} ${view.scope.tournaments === 1 ? 'torneo' : 'torneos'}`
    const scope = `Era ${view.scope.era.code} (${view.scope.era.nameEs}), ${tournaments}, media ${
      view.scope.mean.rate ? formatPercentEs(view.scope.mean.rate.value) : 'sin datos'
    }. ${view.scope.attribution}.`
    if (view.scope.lists === 0) return empty(`Sin listas de torneo en la era ${view.scope.era.code} todavía.`)
    const rows: NonNullable<ComparisonColumnView['rows']> = []
    if (view.exactByGroup)
      rows.push({ label: 'Lista exacta', record: view.exactByGroup.record, rate: view.exactByGroup.rate })
    if (view.exactByName && view.exactByName.lists !== view.exactByGroup?.lists) {
      rows.push({
        label: 'Lista exacta por nombre',
        record: view.exactByName.record,
        rate: view.exactByName.rate,
        note: 'Mismas cartas por nombre, aunque alguna tenga otro texto.',
      })
    }
    if (view.archetype) {
      rows.push({
        label: `Arquetipo: ${view.archetype.archetype.name}`,
        record: view.archetype.record,
        rate: view.archetype.rate,
        note:
          view.archetype.source === 'owner'
            ? 'Arquetipo elegido en el mazo.'
            : view.archetype.swaps === 0
              ? 'Sugerido por las listas iguales a la del mazo.'
              : `Sugerido por las listas más parecidas (${view.archetype.swaps === 1 ? '1 cambio' : `${view.archetype.swaps} cambios`}).`,
      })
    }
    const headline = rows[0] ?? null
    return {
      source: 'tournament',
      label: 'Torneo',
      available: headline !== null,
      record: headline?.record ?? null,
      rate: headline?.rate ?? null,
      note: headline === null ? `Nadie jugó esta lista ni una parecida en la era. ${scope}` : scope,
      rows,
    }
  }

  private async requireDeckRef(id: number): Promise<MatchDeckRef> {
    const deck = await this.prisma.deck.findUnique({
      where: { id },
      select: { id: true, name: true, archivedAt: true },
    })
    if (!deck) throw new NotFoundException(`Mazo ${id} no encontrado.`)
    return deckRef(deck)
  }

  private async lastMode(): Promise<MatchMode> {
    const last = await this.prisma.match.findFirst({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { mode: true },
    })
    return last?.mode ?? DEFAULT_MATCH_MODE
  }

  /** Every match as domain facts plus the deck references (one user: a few thousand rows at most). */
  private async loadFacts(): Promise<{ facts: MatchFacts[]; decks: Map<string, MatchDeckRef> }> {
    const records = await this.prisma.match.findMany({
      select: {
        deckId: true,
        result: true,
        opponentText: true,
        wentFirst: true,
        mode: true,
        playedAt: true,
        deckRevision: { select: { number: true } },
        deck: { select: { id: true, name: true, archivedAt: true } },
      },
      orderBy: [{ playedAt: 'asc' }, { id: 'asc' }],
    })
    const decks = new Map<string, MatchDeckRef>()
    const facts = records.map((record): MatchFacts => {
      const deckId = idToString(record.deckId)
      if (!decks.has(deckId)) decks.set(deckId, deckRef(record.deck))
      return {
        deckId,
        deckRevision: record.deckRevision.number,
        result: record.result,
        opponent: record.opponentText,
        wentFirst: record.wentFirst,
        mode: record.mode,
        playedAt: record.playedAt,
      }
    })
    return { facts, decks }
  }
}
