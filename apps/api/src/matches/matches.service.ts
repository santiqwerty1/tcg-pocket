/**
 * Own matches (PLAN §3.6, M6): quick logging, list and edit, statistics with Wilson intervals and the per-deck
 * comparison with three separate columns. The rules (opponent grouping, rates, picker order, revision at the time
 * of the match) live in @tcg/domain; this service persists `matches` and shapes responses.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  botLabel,
  botWarningText,
  type CatalogIndex,
  cleanOpponent,
  coinAdjustedRate,
  DEFAULT_MATCH_MODE,
  type DeckCardEntry,
  eraRange,
  filterMatches,
  formatPercentEs,
  type GameRecord,
  groupSeenMatches,
  holmVerdicts,
  type LuckCheck,
  listBotWarnings,
  losingStreak,
  luckCheck,
  type MatchFacts,
  type MatchMode,
  type MatchResult,
  MY_META_MODES,
  type MyMeta,
  matchStats,
  myMeta,
  normalizeSeenCards,
  oneIn,
  opponentKey,
  opponentLabels,
  opponentTurns,
  orderDecksForPicker,
  revisionAt,
  type SeenCard,
  seenCardsTextEs,
  simulationRate,
  suggestArchetypesForCards,
  suggestOpponents,
  tallyMatches,
  turnOrderImpact,
} from '@tcg/domain'
import { CatalogService } from '../catalog/catalog.service.js'
import type { Prisma } from '../generated/prisma/client.js'
import type { MatchSource } from '../generated/prisma/enums.js'
import { idToString, parseNumericId } from '../http/ids.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { SimulationsService } from '../simulation/simulations.service.js'
import { TournamentsService } from '../tournaments/tournaments.service.js'
import type {
  ComparisonColumnView,
  DeckComparisonView,
  DeckMatchupRowView,
  DeckMatchupsView,
  LuckView,
  MatchDeckRef,
  MatchStatsView,
  MatchSuggestionsView,
  MatchView,
  MyMetaSummary,
  MyMetaView,
  RivalSuggestionsView,
  RowView,
  UnclassifiedView,
} from './match-views.js'

/** Fase 44: what «mi meta» is asked for — the era (the current one by default), one mode, the last days, the half-life. */
export interface MyMetaQuery {
  era?: string | undefined
  mode?: MatchMode | undefined
  days?: number | undefined
  halfLifeDays?: number | undefined
}

/** Fase 44: the part of «mi meta» the deck sheet and «¿Cuál llevo hoy?» show next to the number it weighs. */
export function myMetaSummary(meta: MyMeta): MyMetaSummary {
  const { text, enough, coverage, matched, effectiveMatches, orientative } = meta
  return { text, enough, coverage, matched, effectiveMatches, orientative }
}

/** Most played archetypes always shown in a deck's «Contra cada rival» (the rest only when the deck met them). */
const DECK_MATCHUP_RIVALS = 10

/** Matches a tournament matchup needs to be the expected rate of «¿mala racha?». */
const LUCK_EXPECTED_MIN_MATCHES = 10

function luckText(
  record: GameRecord,
  expected: LuckView['expected'],
  check: LuckView['check'],
  streak: LuckView['streak'],
): string {
  const games = record.wins + record.losses + record.ties
  if (!expected || !check) {
    return games === 0
      ? 'Todavía no hay partidas.'
      : 'No hay datos de torneo para comparar: el mazo no tiene arquetipo de torneo en la era.'
  }
  const era = expected.era ? ` en la era ${expected.era}` : ''
  const own = `Vas ${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ''}${era} (${formatPercentEs(check.actual)})`
  const base = `Lo esperable (${expected.label}) es ${formatPercentEs(expected.value)}`
  const parts: string[] = []
  if (check.verdict === 'too_few') {
    parts.push(`${own}. ${base}; con ${games} ${games === 1 ? 'partida' : 'partidas'} todavía no se puede decir nada.`)
  } else if (check.verdict === 'unlucky') {
    parts.push(
      `${own}. ${base}: sacar ${record.wins} o menos de ${games} pasa 1 de cada ${oneIn(check.lowerTail)} veces. Es raro: si sigue así, mirá la lista o cómo jugás el matchup.`,
    )
  } else if (check.verdict === 'lucky') {
    parts.push(
      `${own}. ${base}: sacar ${record.wins} o más de ${games} pasa 1 de cada ${oneIn(check.upperTail)} veces. Te viene yendo mejor de lo esperable.`,
    )
  } else {
    const tail = check.actual < check.expected ? check.lowerTail : check.upperTail
    parts.push(
      `${own}. ${base}: un resultado así o más lejos pasa 1 de cada ${oneIn(tail)} veces. Está dentro de lo normal.`,
    )
  }
  if (streak) {
    parts.push(
      `Llevás ${streak.losses} derrotas seguidas: a ese ritmo, ${streak.losses} seguidas pasan 1 de cada ${oneIn(streak.probability)} veces, pero en ${streak.games} partidas una racha así aparece ${formatPercentEs(streak.somewhere * 100)} de las veces.`,
    )
  }
  return parts.join(' ')
}

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
  /** Fase 28: the phone's id of a match saved without signal; a second create with it returns the first match. */
  clientRef?: string | undefined
  /** Fase 28: how long ago it was played (measured on the phone, so its clock does not matter); `playedAt` wins. */
  playedAgoMs?: number | undefined
  /** 14/10: the rival's cards seen («2 Greninja»), any edition of each name. */
  opponentCards?: SeenCard[] | undefined
}

export type MatchPatch = Partial<MatchInput>

export interface MatchListQuery {
  deckId?: string | undefined
  mode?: MatchMode | undefined
  result?: MatchResult | undefined
  /** Free text: matches whose opponent key contains its key («blaz» finds «Mega-Blaziken ex»). */
  opponent?: string | undefined
  opponentMatch?: 'contains' | 'exact' | undefined
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

/** The cards seen as stored (`[]` for a match logged before 14/10, or with nothing noted). */
function storedCards(value: Prisma.JsonValue): SeenCard[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const card = item as { cardId?: unknown; count?: unknown } | null
        return typeof card?.cardId === 'string' && typeof card.count === 'number'
          ? [{ cardId: card.cardId, count: card.count }]
          : []
      })
    : []
}

function toView(record: MatchRecord, index?: CatalogIndex): MatchView {
  return {
    id: idToString(record.id),
    deck: deckRef(record.deck),
    deckRevision: record.deckRevision.number,
    result: record.result,
    opponent: record.opponentText,
    opponentCards: storedCards(record.opponentCards).map((card) => ({
      ...card,
      nameEs: index?.cardById(card.cardId)?.nameEs ?? card.cardId,
    })),
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
    private readonly simulations: SimulationsService,
    private readonly catalog: CatalogService,
  ) {}

  private view(record: MatchRecord): MatchView {
    return toView(record, this.catalog.loaded ? this.catalog.requireIndex() : undefined)
  }

  /** The cards seen as they are stored: one line per name, at most two copies; an unknown card is a 400. */
  private seenCards(cards: readonly SeenCard[], stored: Prisma.JsonValue = []): Prisma.InputJsonValue {
    // Self-review: no cards, no catalog (a match is logged even while the catalog loads), and a 503 stays a 503.
    if (cards.length === 0) return []
    const index = this.catalog.requireIndex()
    try {
      // A card already stored that the catalog no longer has stays: an edit must not fail for it.
      const kept = new Set(storedCards(stored).map((card) => card.cardId))
      return normalizeSeenCards(cards, index, kept) as unknown as Prisma.InputJsonValue
    } catch (error) {
      throw new BadRequestException({ code: 'validation', message: (error as Error).message })
    }
  }

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
      return { items: records.map((record) => this.view(record)), total }
    }
    // The opponent groups by a normalized key the database does not know: filter in memory (a few thousand rows).
    const exact = query.opponentMatch === 'exact'
    const records = (await this.prisma.match.findMany({ where, include: matchInclude, orderBy })).filter((record) => {
      const recordKey = opponentKey(record.opponentText)
      return exact ? recordKey === key : (recordKey?.includes(key) ?? false)
    })
    return {
      items: records.slice(query.offset, query.offset + query.limit).map((record) => this.view(record)),
      total: records.length,
    }
  }

  async get(rawId: string): Promise<MatchView> {
    return this.view(await this.requireMatch(rawId))
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
        coinAdjusted: coinAdjustedRate(selected.filter((match) => match.deckId === item.deckId)),
      })),
      byOpponent: report.byOpponent.map((item) => ({ key: item.key, label: item.label, ...row(item) })),
      byWentFirst: report.byWentFirst.map((item) => ({ key: item.key, label: item.label, ...row(item) })),
      byMode: report.byMode.map((item) => ({ mode: item.mode, label: item.label, ...row(item) })),
      byRevision:
        deckId === undefined ? [] : report.byRevision.map((item) => ({ revision: item.revision, ...row(item) })),
      turnOrder: turnOrderImpact(selected),
      coinAdjusted: coinAdjustedRate(selected),
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
        await this.simulationColumn(Number(deck.id)),
      ],
    }
  }

  /**
   * Fase 9: against each rival, own matches with the deck and the tournament matchup of the deck's archetype, side by
   * side. Rivals: the most played archetypes of the era and every opponent of the deck's matches; a typed opponent is
   * the archetype whose name has the same key («Mega-Blaziken ex» ≡ «mega blaziken ex»).
   */
  async deckMatchups(rawDeckId: string, mode: MatchMode | undefined): Promise<DeckMatchupsView> {
    const deck = await this.requireDeckRef(parseNumericId(rawDeckId, 'Mazo'))
    // The matches once: the deck's record by rival, its turns and «mi meta» come from the same read (review of #52).
    const { facts } = await this.loadFacts()
    const ofDeck = filterMatches(facts, { deckId: deck.id, mode: mode ?? null, from: null, to: null })
    const stats = matchStats(ofDeck)
    const row = await this.prisma.deck.findUnique({
      where: { id: Number(deck.id) },
      select: { currentRevisionId: true, tournamentArchetypeId: true },
    })
    const revision =
      row?.currentRevisionId == null
        ? null
        : await this.prisma.deckRevision.findUnique({ where: { id: row.currentRevisionId }, select: { cards: true } })
    const placed = revision
      ? await this.tournaments
          .deckTournament(revision.cards as unknown as DeckCardEntry[], row?.tournamentArchetypeId ?? null)
          .catch(() => null)
      : null
    const archetype = placed?.archetype?.archetype.id
      ? {
          id: placed.archetype.archetype.id,
          name: placed.archetype.archetype.name,
          source: placed.archetype.source === 'owner' ? ('owner' as const) : ('guessed' as const),
        }
      : null
    const context = await this.tournaments.archetypeMatchupsOf(archetype?.id ?? null).catch(() => null)
    const tournamentByRival = new Map(
      (context?.matchups.rows ?? []).map((item) => [
        item.rival.id,
        { record: item.record, rate: item.rate, perGame: item.perGame },
      ]),
    )
    const shares = context ? this.tournaments.shares(context.dataset) : []
    const mine = new Map(stats.byOpponent.map((item) => [item.key, item]))
    const turns = opponentTurns(ofDeck)
    // H-009: the verdict compares the same era on both sides, per game, with the tournament's uncertainty, and the
    // rivals together (Holm).
    const eraFrom = context ? (eraRange(context.scope.era, context.scope.sets)?.from ?? null) : null
    const inEra = eraFrom ? ofDeck.filter((fact) => fact.playedAt >= eraFrom) : ofDeck
    const checks: { at: number; check: LuckCheck }[] = []
    const used = new Set<string>()
    const rows: DeckMatchupRowView[] = []
    for (const [at, share] of shares.entries()) {
      const key = opponentKey(share.name)
      const own = key === null ? undefined : mine.get(key)
      if (at >= DECK_MATCHUP_RIVALS && !own) continue
      if (key !== null && own) used.add(key)
      const tournament = tournamentByRival.get(share.archetypeId) ?? null
      const perGame = tournament?.perGame ?? null
      if (own && perGame && tournament?.rate && tournament.rate.games >= LUCK_EXPECTED_MIN_MATCHES) {
        const record = tallyMatches(inEra.filter((fact) => opponentKey(fact.opponent) === key))
        const expected = (perGame.wins / (perGame.wins + perGame.losses)) * 100
        checks.push({ at: rows.length, check: luckCheck(record, expected, { expectedRecord: perGame }) })
      }
      rows.push({
        rival: { id: share.archetypeId, name: share.name },
        share: share.share,
        mine: own ? { record: own.record, rate: own.rate } : null,
        tournament: tournament ? { record: tournament.record, rate: tournament.rate } : null,
        luck: null,
        turn: key === null ? null : (turns.get(key) ?? null),
      })
    }
    const verdicts = holmVerdicts(checks.map((item) => item.check))
    for (const [i, item] of checks.entries()) {
      const row = rows[item.at]
      if (row) row.luck = verdicts[i] ?? null
    }
    for (const own of stats.byOpponent) {
      if (own.key !== null && used.has(own.key)) continue
      rows.push({
        rival: { id: null, name: own.label },
        share: null,
        mine: { record: own.record, rate: own.rate },
        tournament: null,
        luck: null,
        turn: turns.get(own.key) ?? null,
      })
    }
    // Fase 44: the same expected figure with the rivals weighted by «mi meta» (every deck's matches of the era, in
    // the modes asked or competitive and casual), only when the deck has an archetype to weigh.
    const mineMeta =
      archetype && context ? await this.myMetaOf(facts, { era: context.scope.era, mode }).catch(() => null) : null
    const expectedMine =
      archetype && mineMeta?.enough
        ? await this.tournaments
            .expectedWith(
              archetype.id,
              { shares: mineMeta.shares, sample: mineMeta.effectiveMatches },
              { era: context?.scope.era },
            )
            .catch(() => null)
        : null
    return {
      deck,
      archetype,
      era: context?.scope.era ?? '',
      tournamentsWithPairings: context?.matchups.tournamentsWithPairings ?? 0,
      expected: context?.matchups.expected ?? null,
      expectedMine,
      myMeta: mineMeta ? myMetaSummary(mineMeta) : null,
      rows,
      attribution: 'Datos de torneo: Limitless (play.limitlesstcg.com)',
    }
  }

  /**
   * Fase 44: «mi meta» — the rivals of my matches (every deck) as shares of the era's tournament archetypes, the
   * recent ones weighing more. A rival is an archetype by name, or by the archetype its note was written from. Only
   * the era's matches count (the tournament numbers it weighs are the era's), in `mode` or else competitive and
   * casual (MY_META_MODES), and `days` narrows it further.
   */
  async myMeta(query: MyMetaQuery = {}): Promise<MyMetaView> {
    const { facts } = await this.loadFacts()
    return this.myMetaOf(facts, query)
  }

  private async myMetaOf(facts: readonly MatchFacts[], query: MyMetaQuery): Promise<MyMetaView> {
    const now = new Date()
    const era = await this.tournaments.eraArchetypes({ era: query.era })
    const since = query.days ? new Date(now.getTime() - query.days * 24 * 60 * 60 * 1000) : null
    const eraFrom = era.range?.from ?? null
    const from = since && eraFrom ? (since > eraFrom ? since : eraFrom) : (since ?? eraFrom)
    const modes: readonly MatchMode[] = query.mode ? [query.mode] : MY_META_MODES
    const selected = filterMatches(facts, { deckId: null, mode: null, from, to: era.range?.to ?? null }).filter(
      (fact) => modes.includes(fact.mode),
    )
    const notes = await this.prisma.rivalNote.findMany({
      where: { archetypeId: { not: null } },
      select: { key: true, archetypeId: true },
    })
    const links = new Map(
      notes.flatMap((note) => (note.archetypeId ? [[note.key, era.canonical(note.archetypeId)] as const] : [])),
    )
    return {
      era: era.era,
      from: from?.toISOString() ?? null,
      filters: { mode: query.mode ?? null, modes: [...modes], days: query.days ?? null },
      ...myMeta(selected, era.archetypes, { now, links, halfLifeDays: query.halfLifeDays }),
    }
  }

  /**
   * Fase 13: is the deck's record (against one rival, or overall) unusual for what tournaments say it should do?
   * Expected rate: the matchup of the deck's archetype against the rival (10 matches or more), else the archetype's
   * record in the era. Also the current losing run of the deck.
   *
   * H-009 (Fase 37): both sides per game (the tournament's BO3 converted) and in the same era (own games since it
   * started), with the uncertainty of the tournament record (beta-binomial).
   */
  async luck(rawDeckId: string, opponent: string | undefined, mode: MatchMode | undefined): Promise<LuckView> {
    const deck = await this.requireDeckRef(parseNumericId(rawDeckId, 'Mazo'))
    const { facts } = await this.loadFacts()
    const key = opponentKey(opponent ?? null)
    const expected = await this.expectedFor(deck.id, key)
    const eraFrom = expected?.from ? new Date(expected.from) : null
    const ofDeck = filterMatches(facts, { deckId: deck.id, mode: mode ?? null, from: eraFrom, to: null })
    const selected = key === null ? ofDeck : ofDeck.filter((fact) => opponentKey(fact.opponent) === key)
    const record = tallyMatches(selected)
    const check = expected ? luckCheck(record, expected.value, { expectedRecord: expected.perGame }) : null
    const run = expected
      ? losingStreak(
          ofDeck.map((fact) => fact.result),
          expected.value,
        )
      : null
    const streak = run ? { ...run, games: ofDeck.length } : null
    return {
      deck,
      opponent: key === null ? null : (cleanOpponent(opponent) ?? null),
      record,
      expected,
      check,
      streak,
      text: luckText(record, expected, check, streak),
    }
  }

  /** The expected rate of a deck, against a rival (by key) or overall, from tournaments. */
  private async expectedFor(deckId: string, key: string | null): Promise<LuckView['expected']> {
    const row = await this.prisma.deck.findUnique({
      where: { id: Number(deckId) },
      select: { currentRevisionId: true, tournamentArchetypeId: true },
    })
    const revision =
      row?.currentRevisionId == null
        ? null
        : await this.prisma.deckRevision.findUnique({ where: { id: row.currentRevisionId }, select: { cards: true } })
    if (!revision) return null
    const placed = await this.tournaments
      .deckTournament(revision.cards as unknown as DeckCardEntry[], row?.tournamentArchetypeId ?? null)
      .catch(() => null)
    const archetype = placed?.archetype
    if (!archetype?.archetype.id) return null
    const context = await this.tournaments.archetypeMatchupsOf(archetype.archetype.id).catch(() => null)
    const era = context?.scope.era ?? null
    const range = context ? eraRange(context.scope.era, context.scope.sets) : null
    const from = range ? range.from.toISOString() : null
    const rateOf = (record: { wins: number; losses: number }) => (record.wins / (record.wins + record.losses)) * 100
    if (key !== null) {
      const hit = context?.matchups.rows.find((item) => opponentKey(item.rival.name) === key)
      if (hit?.rate && hit.perGame && hit.rate.games >= LUCK_EXPECTED_MIN_MATCHES) {
        return {
          value: rateOf(hit.perGame),
          kind: 'matchup',
          label: `${archetype.archetype.name} contra ${hit.rival.name} en torneos, por partida`,
          games: hit.rate.games,
          perGame: hit.perGame,
          era,
          from,
        }
      }
    }
    // The archetype against everyone: per game from the pairings; without them, its standings record (as exact).
    const field = context?.matchups.fieldPerGame ?? null
    if (field && field.wins + field.losses >= LUCK_EXPECTED_MIN_MATCHES) {
      return {
        value: rateOf(field),
        kind: 'archetype',
        label: `${archetype.archetype.name} en torneos, por partida`,
        games: Math.round(field.wins + field.losses),
        perGame: field,
        era,
        from,
      }
    }
    if (!archetype.rate) return null
    return {
      value: archetype.rate.value,
      kind: 'archetype',
      label: `${archetype.archetype.name} en torneos`,
      games: archetype.rate.games,
      perGame: null,
      era,
      from,
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------------------------------------------

  async create(input: MatchInput, source: MatchSource = 'ui'): Promise<MatchView> {
    if (input.clientRef) {
      const sent = await this.prisma.match.findUnique({ where: { clientRef: input.clientRef }, include: matchInclude })
      if (sent) return this.view(sent)
    }
    const deck = await this.requireDeckWithRevisions(input.deckId)
    const explicit =
      parseDate(input.playedAt, 'playedAt') ??
      (input.playedAgoMs !== undefined ? new Date(Date.now() - input.playedAgoMs) : undefined)
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
        clientRef: input.clientRef ?? null,
        opponentCards: this.seenCards(input.opponentCards ?? []),
      },
      include: matchInclude,
    })
    return this.view(created)
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
    if (patch.opponentCards !== undefined) {
      data.opponentCards = this.seenCards(patch.opponentCards, current.opponentCards)
    }
    if (Object.keys(data).length === 0) return this.view(current)
    const updated = await this.prisma.match.update({ where: { id: current.id }, data, include: matchInclude })
    return this.view(updated)
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Rivals by the cards seen (14/10)
  // ---------------------------------------------------------------------------------------------------------------

  /** The current era's archetypes that play the cards seen: those with every card first, then «parecido a X». */
  async rivalSuggestions(cards: readonly SeenCard[]): Promise<RivalSuggestionsView> {
    const { scope, dataset } = await this.tournaments.scopedDataset({})
    const seen = cards.length > 0 ? (this.seenCards(cards) as unknown as SeenCard[]) : []
    return {
      era: scope.era,
      lists: dataset.entries.length,
      suggestions: suggestArchetypesForCards(seen, dataset.entries, dataset.archetypes, scope.index),
    }
  }

  /**
   * The matches to classify: those without a rival and with cards seen, grouped by similar cards (newest first), each
   * group with the archetypes its cards suggest. Also the rivals typed that are no archetype of the era (`own`, from
   * «mi meta»): they can be moved to one, or renamed.
   */
  async unclassified(): Promise<UnclassifiedView> {
    const { scope, dataset } = await this.tournaments.scopedDataset({})
    const index = scope.index
    const rows = await this.prisma.match.findMany({
      where: { opponentText: null, NOT: { opponentCards: { equals: [] } } },
      orderBy: { playedAt: 'desc' },
      take: 500,
      include: matchInclude,
    })
    const byId = new Map(rows.map((row) => [idToString(row.id), row]))
    const groups = groupSeenMatches(
      rows.map((row) => ({ id: idToString(row.id), playedAt: row.playedAt, cards: storedCards(row.opponentCards) })),
      index,
    )
    const own = await this.ownRivals(dataset.archetypes)
    return {
      era: scope.era,
      groups: groups.map((group) => ({
        matches: group.matchIds.flatMap((id) => {
          const row = byId.get(id)
          return row ? [this.view(row)] : []
        }),
        cards: group.cards.map((card) => ({ ...card, nameEs: index.cardById(card.cardId)?.nameEs ?? card.cardId })),
        text: seenCardsTextEs(group.cards, index),
        suggestions: suggestArchetypesForCards(group.cards, dataset.entries, dataset.archetypes, index),
      })),
      own,
    }
  }

  /** How many matches wait for a rival (without one, with cards seen): what «Hoy» shows, without the groups. */
  async unclassifiedCount(): Promise<{ matches: number }> {
    return {
      matches: await this.prisma.match.count({ where: { opponentText: null, NOT: { opponentCards: { equals: [] } } } }),
    }
  }

  /**
   * Self-review: the rivals typed that are no archetype of the current era (by name, or by the archetype a note of
   * theirs was written from), counted over every match — every mode and every era —, since reclassifying one changes
   * them all.
   */
  private async ownRivals(archetypes: ReadonlyMap<string, { name: string }>) {
    const [rows, notes] = await Promise.all([
      this.prisma.match.findMany({
        where: { opponentText: { not: null } },
        select: { opponentText: true, playedAt: true },
      }),
      this.prisma.rivalNote.findMany({ where: { archetypeId: { not: null } }, select: { key: true } }),
    ])
    const known = new Set([
      ...[...archetypes.values()].map((archetype) => opponentKey(archetype.name)),
      ...notes.map((note) => note.key),
    ])
    const facts = rows.map((row) => ({ opponent: row.opponentText, playedAt: row.playedAt }))
    const labels = opponentLabels(facts)
    const games = new Map<string, number>()
    for (const fact of facts) {
      const key = opponentKey(fact.opponent)
      if (key !== null && !known.has(key)) games.set(key, (games.get(key) ?? 0) + 1)
    }
    return [...games]
      .map(([key, count]) => ({ key, label: labels.get(key) ?? key, games: count }))
      .sort((a, b) => b.games - a.games || a.label.localeCompare(b.label, 'es'))
  }

  /**
   * Gives the matches one rival: an archetype's name or one of the owner's own («Greninja Suicune»). By ids, or every
   * match of a rival typed before (`from`, by its key: reclassifying). Returns how many changed.
   */
  async classify(input: {
    matchIds?: string[] | undefined
    from?: string | undefined
    opponent: string | null
    /** «Deshacer» a rename: the note goes back from `from` to `to` (labels), in the same transaction. */
    note?: { from: string; to: string } | undefined
    /**
     * The rival each of `matchIds` must still have (null: none). Codex on #114: a match edited since the list was read
     * (or since what is undone) is left as it is and comes back in `skipped`.
     */
    expect?: string | null | undefined
  }) {
    // `null`: back to «sin clasificar» (what «Deshacer» sends for matches that had no rival).
    const opponent = input.opponent === null ? null : storedOpponent(input.opponent)
    if (input.opponent !== null && opponent === null) {
      throw new BadRequestException({ code: 'validation', message: 'Falta el rival.' })
    }
    const ids = [...new Set((input.matchIds ?? []).map((id) => parseNumericId(id, 'Partida')))]
    const fromKey = input.from === undefined ? null : opponentKey(input.from)
    if (ids.length === 0 && fromKey === null) {
      throw new BadRequestException({ code: 'validation', message: 'Mandá las partidas o el rival a reclasificar.' })
    }
    return this.prisma.$transaction(async (tx) => {
      // Codex on #114: the rows stay locked from the check to the write, so an edit cannot land in between.
      if (ids.length > 0) await tx.$queryRaw`SELECT id FROM matches WHERE id = ANY(${ids}) FOR UPDATE`
      const found = await tx.match.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, opponentText: true },
      })
      if (found.length !== ids.length) throw new NotFoundException('Alguna de esas partidas ya no existe.')
      // Codex on #114: a match that changed since (edited in the app or by Claude) is left as it is.
      const expectKey = input.expect === undefined ? undefined : opponentKey(input.expect)
      const skipped =
        expectKey === undefined
          ? []
          : found.filter((row) => opponentKey(row.opponentText) !== expectKey).map((row) => row.id)
      const targets = new Set(ids.filter((id) => !skipped.includes(id)))
      if (fromKey !== null) {
        const typed = await tx.match.findMany({
          where: { opponentText: { not: null } },
          select: { id: true, opponentText: true },
        })
        for (const row of typed) if (opponentKey(row.opponentText) === fromKey) targets.add(row.id)
      }
      // Self-review: what each match had, so «Deshacer» puts it back (a rival merged into an archetype could not be
      // told apart afterwards).
      const before = await tx.match.findMany({
        where: { id: { in: [...targets] } },
        select: { id: true, opponentText: true },
      })
      const { count } = await tx.match.updateMany({
        where: { id: { in: [...targets] } },
        data: { opponentText: opponent },
      })
      // The note about the rival follows its new name when that one has none; «Deshacer» sends it back (Codex on #114:
      // undoing a rename restored the matches but left the note on the new name).
      const moveNote = async (from: string, to: string) => {
        const [fromNote, toNote] = [opponentKey(from), opponentKey(to)]
        if (fromNote === null || toNote === null) return null
        const note = await tx.rivalNote.findUnique({ where: { key: fromNote }, select: { label: true } })
        if (!note) return null
        // Codex on #114: the same rival in another spelling («greninja suicune» → «Greninja Suicune»): the note's label
        // takes it too (the Notes page shows it), and «Deshacer» gives the old one back the same way.
        if (fromNote === toNote) {
          if (note.label === to) return null
          await tx.rivalNote.update({ where: { key: fromNote }, data: { label: to } })
          return { from: note.label, to }
        }
        const taken = await tx.rivalNote.findUnique({ where: { key: toNote }, select: { key: true } })
        if (taken) return null
        await tx.rivalNote.update({ where: { key: fromNote }, data: { key: toNote, label: to } })
        return { from: note.label, to }
      }
      // Codex on #114: a «Deshacer» whose matches were all edited since restores none, so the note stays too.
      const noteMoved =
        count === 0
          ? null
          : input.note !== undefined
            ? await moveNote(input.note.from, input.note.to)
            : input.from !== undefined && opponent !== null
              ? await moveNote(input.from, opponent)
              : null
      return {
        updated: count,
        opponent,
        previous: before.map((row) => ({ id: idToString(row.id), opponent: row.opponentText })),
        /** The note moved with it (labels), for «Deshacer». */
        noteMoved,
        /** The matches left as they were: they no longer had the rival expected. */
        skipped: skipped.map(idToString),
      }
    })
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

  /** Simulation column: finished games of the deck's current list, for the bot pair with the most games. */
  private async simulationColumn(deckId: number): Promise<ComparisonColumnView> {
    const column = await this.simulations.deckColumn(deckId).catch(() => null)
    if (!column || column.games === 0) {
      return {
        source: 'simulation',
        label: 'Simulación',
        available: false,
        record: null,
        rate: null,
        note: 'Todavía no se simuló la lista actual de este mazo (Más → Simulación).',
      }
    }
    return {
      source: 'simulation',
      label: 'Simulación',
      available: true,
      record: column.record,
      rate: simulationRate(column.record),
      // Review of the PR: the column pools the deck's games on both sides, so only a bot both sides share names it.
      blindSpot:
        column.players[0] === column.players[1] ? await this.simulationBlindSpot(deckId, column.players[0]) : null,
      note: `Bots ${botLabel(column.players[0])} vs ${botLabel(column.players[1])}, ${column.jobs === 1 ? '1 simulación' : `${column.jobs} simulaciones`}, motor ${column.engineRev.slice(0, 7)}. El porcentaje depende del bot.`,
    }
  }

  /** H-055: the list rules of «posible punto ciego del bot» for the current list and the bot of its side. */
  private async simulationBlindSpot(deckId: number, bot: string): Promise<{ text: string } | null> {
    let index: CatalogIndex
    try {
      index = this.catalog.requireIndex()
    } catch {
      return null
    }
    const deck = await this.prisma.deck.findUnique({ where: { id: deckId }, select: { currentRevisionId: true } })
    const revision =
      deck?.currentRevisionId == null
        ? null
        : await this.prisma.deckRevision.findUnique({ where: { id: deck.currentRevisionId }, select: { cards: true } })
    if (!revision) return null
    const text = botWarningText(listBotWarnings(revision.cards as unknown as DeckCardEntry[], index, bot), bot)
    return text ? { text } : null
  }

  private async requireDeckRef(id: number): Promise<MatchDeckRef> {
    const deck = await this.prisma.deck.findUnique({
      where: { id },
      select: { id: true, name: true, archivedAt: true },
    })
    if (!deck) throw new NotFoundException(`Mazo ${id} no encontrado.`)
    return deckRef(deck)
  }

  /** The mode a match gets when none is given: the last logged one's (also for `matches_log` with a rank). */
  async lastMode(): Promise<MatchMode> {
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
