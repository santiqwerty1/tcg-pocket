/**
 * Tournament statistics (BRIEF M5, PLAN §3.5): reads what the sync stored, builds the dataset of one era and format
 * with @tcg/domain (cached until the data, the settings or the catalog change) and answers the questions of the
 * brief: records by archetype and by exact list, what I can build today, which card unlocks the most lists, and an
 * archetype with and without a card. Tournament data only: it never mixes with own matches or simulations.
 */
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import {
  archetypeRows,
  buildableLists,
  buildDataset,
  type CardId,
  type CatalogIndex,
  cardUsage,
  type DatasetEntry,
  type DeckCardEntry,
  deckInTournaments,
  entriesOfArchetype,
  entriesOfList,
  eraMean,
  eraOf,
  eraRange,
  eraSets,
  type LimitlessDecklist,
  type ListAgainstCollection,
  type ListCard,
  type ListKeyKind,
  type ListRow,
  listRows,
  listsAgainstCollection,
  mostCommonEnergies,
  newEraWarning,
  playableCopies,
  type RecordRow,
  recordOf,
  type SetRelease,
  type StoredEntry,
  type StoredTournament,
  substitutesFor,
  type TournamentDataset,
  type TournamentFormat,
  tournamentVersion,
  unlockCards,
  withWithout,
} from '@tcg/domain'
import { CatalogService } from '../catalog/catalog.service.js'
import { CollectionRepository } from '../collection/collection.repository.js'
import { ENV, type Env } from '../config/env.js'
import { dateOnly, todayInOwnerZone } from '../config/time-zone.js'

import type { Prisma } from '../generated/prisma/client.js'
import { idToString, parseNumericId } from '../http/ids.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { TournamentDataVersion, TournamentSettings } from './tournament-settings.js'
import { TournamentSyncService } from './tournament-sync.service.js'
import type {
  ArchetypeDetailView,
  ArchetypeRefView,
  ArchetypesView,
  BuildableView,
  CardLineView,
  DeckTournamentView,
  DeckVersionDetailView,
  DeckVersionsView,
  DeckVersionView,
  EraView,
  ListAgainstCollectionView,
  ListDetailView,
  ListRowView,
  ListsView,
  RecordRowView,
  ScopeView,
  SetReleaseView,
  StatusView,
  TournamentRowView,
  UnknownCardView,
  UnlockView,
} from './tournament-views.js'

export const LIMITLESS_ATTRIBUTION = 'Datos de torneo: Limitless (play.limitlesstcg.com)'

/** Archetypes with at least this many lists in the current era are offered as opponents in the quick-entry sheet. */
export const OPPONENT_MIN_LISTS = 5
/** Each era dataset holds ~12 k lists in memory: two are enough (current and one other) on a 512 MB machine. */
const CACHE_SIZE = 2

export interface ScopeQuery {
  era?: string | undefined
  format?: TournamentFormat | undefined
}

export interface Scope {
  era: string
  format: TournamentFormat
  minPlayers: number
  sets: SetRelease[]
  index: CatalogIndex
}

interface CacheEntry {
  key: string
  index: CatalogIndex
  dataset: TournamentDataset
}

@Injectable()
export class TournamentsService {
  private cache: CacheEntry[] = []

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly collection: CollectionRepository,
    private readonly settings: TournamentSettings,
    private readonly version: TournamentDataVersion,
    private readonly sync: TournamentSyncService,
  ) {}

  // ---------------------------------------------------------------------------------------------------------------
  // Scope and dataset
  // ---------------------------------------------------------------------------------------------------------------

  private async scope(query: ScopeQuery): Promise<Scope> {
    const [sets, minPlayers] = await Promise.all([this.settings.sets(), this.settings.minPlayers()])
    const today = todayInOwnerZone()
    const era = query.era ?? eraOf(new Date(`${today}T12:00:00Z`), sets)
    if (!era || !eraRange(era, sets)) throw new NotFoundException(`Era ${query.era ?? '(actual)'} desconocida.`)
    return { era, format: query.format ?? 'STANDARD', minPlayers, sets, index: this.catalog.requireIndex() }
  }

  async dataset(scope: Scope): Promise<TournamentDataset> {
    const key = `${scope.era}|${scope.format}|${scope.minPlayers}|${this.version.current()}`
    const hit = this.cache.find((entry) => entry.key === key && entry.index === scope.index)
    if (hit) return hit.dataset
    const range = eraRange(scope.era, scope.sets)
    if (!range) throw new NotFoundException(`Era ${scope.era} desconocida.`)
    const tournaments = await this.prisma.tournament.findMany({
      where: {
        status: 'complete',
        format: scope.format,
        players: { gte: scope.minPlayers },
        date: { gte: range.from, ...(range.to ? { lt: range.to } : {}) },
      },
      select: { id: true, name: true, date: true, format: true, players: true },
    })
    const rows = await this.prisma.tournamentEntry.findMany({
      where: { tournamentId: { in: tournaments.map((t) => t.id) } },
      select: {
        tournamentId: true,
        playerId: true,
        playerName: true,
        country: true,
        placing: true,
        drop: true,
        wins: true,
        losses: true,
        ties: true,
        archetypeId: true,
        archetypeName: true,
        archetypeIcons: true,
        energies: true,
        decklist: true,
      },
    })
    const entries: StoredEntry[] = rows.map((row) => ({
      tournamentId: row.tournamentId,
      playerId: row.playerId,
      playerName: row.playerName,
      country: row.country,
      placing: row.placing,
      drop: row.drop,
      record: { wins: row.wins, losses: row.losses, ties: row.ties },
      archetype:
        row.archetypeId === null
          ? null
          : { id: row.archetypeId, name: row.archetypeName ?? row.archetypeId, icons: row.archetypeIcons },
      decklist: row.decklist as LimitlessDecklist | null,
      energies: row.energies,
    }))
    const dataset = buildDataset({
      tournaments: tournaments as StoredTournament[],
      entries,
      index: scope.index,
      sets: scope.sets,
      era: scope.era,
      format: scope.format,
      minPlayers: scope.minPlayers,
      aliases: await this.settings.aliases(),
    })
    this.cache = [{ key, index: scope.index, dataset }, ...this.cache].slice(0, CACHE_SIZE)
    return dataset
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------------------------------------------

  private eraView(code: string, sets: readonly SetRelease[], index: CatalogIndex, today: string): EraView {
    const range = eraRange(code, sets)
    const set = sets.find((item) => item.code === code)
    return {
      code,
      nameEs: index.expansionById(code)?.nameEs ?? set?.nameEn ?? code,
      from: range ? (dateOnly(range.from) as string) : '',
      to: range?.to ? dateOnly(range.to) : null,
      current: eraOf(new Date(`${today}T12:00:00Z`), sets) === code,
    }
  }

  private scopeView(scope: Scope, dataset: TournamentDataset): ScopeView {
    const mean = eraMean(dataset)
    return {
      era: this.eraView(scope.era, scope.sets, scope.index, todayInOwnerZone()),
      format: scope.format,
      minPlayers: scope.minPlayers,
      tournaments: dataset.tournaments.length,
      lists: dataset.entries.length,
      games: mean.rate?.games ?? 0,
      mean: rowView(mean),
      conflicts: dataset.tournaments
        .filter((t) => t.conflict !== null)
        .map((t) => ({ tournamentId: t.id, name: t.name, date: t.date.toISOString(), set: t.conflict as string })),
      unknownCards: dataset.unknownCards.length,
      attribution: LIMITLESS_ATTRIBUTION,
    }
  }

  private archetypeRef(dataset: TournamentDataset, id: string | null): ArchetypeRefView {
    if (id === null) return { id: null, name: 'Sin arquetipo', icons: [] }
    const ref = dataset.archetypes.get(id)
    return { id, name: ref?.name ?? id, icons: ref?.icons ?? [] }
  }

  private cardLines(cards: readonly ListCard[], index: CatalogIndex): CardLineView[] {
    return cards.map((card) => {
      const group = card.groupId === null ? undefined : index.groupById(card.groupId)
      const edition = card.cardId === null ? undefined : index.cardById(card.cardId)
      return {
        groupId: card.groupId,
        cardId: card.cardId,
        nameEs: group?.nameEs ?? card.name,
        nameEn: card.name,
        set: card.set,
        number: card.number,
        count: card.count,
        cardType: edition?.cardType ?? null,
      }
    })
  }

  private listView(dataset: TournamentDataset, row: ListRow, index: CatalogIndex): ListRowView {
    return {
      key: row.key,
      kind: row.kind,
      archetype: this.archetypeRef(dataset, row.archetypeId),
      cards: this.cardLines(row.cards, index),
      otherKey: row.otherKey,
      ...rowView(row),
    }
  }

  private againstView(
    dataset: TournamentDataset,
    row: ListAgainstCollection,
    index: CatalogIndex,
  ): ListAgainstCollectionView {
    return {
      ...this.listView(dataset, row.list, index),
      missing: row.missing.map((item) => ({ ...item, nameEs: index.groupById(item.groupId)?.nameEs ?? item.groupId })),
      missingCopies: row.missingCopies,
    }
  }

  async archetypes(query: ScopeQuery): Promise<ArchetypesView> {
    const scope = await this.scope(query)
    const dataset = await this.dataset(scope)
    return {
      scope: this.scopeView(scope, dataset),
      rows: archetypeRows(dataset).map((row) => ({
        archetype: this.archetypeRef(dataset, row.archetype?.id ?? null),
        ...rowView(row),
      })),
    }
  }

  async archetype(
    id: string,
    query: ScopeQuery & { card?: string | undefined; minCount?: number | undefined },
  ): Promise<ArchetypeDetailView> {
    const scope = await this.scope(query)
    const dataset = await this.dataset(scope)
    const archetypeId = id === 'none' ? null : ((await this.settings.aliases()).get(id) ?? id)
    const entries = entriesOfArchetype(dataset, archetypeId)
    if (entries.length === 0) throw new NotFoundException(`No hay listas del arquetipo ${id} en esta era.`)
    const lists = listRows({ ...dataset, entries }, 'group').slice(0, 20)
    let withWithoutView: ArchetypeDetailView['withWithout'] = null
    if (query.card) {
      const group = scope.index.groupById(query.card) ?? scope.index.groupOfCard(query.card)
      if (!group) throw new BadRequestException({ code: 'validation', message: `Carta ${query.card} desconocida.` })
      const split = withWithout(dataset, entries, group.id, query.minCount ?? 1)
      withWithoutView = {
        card: { groupId: group.id, nameEs: group.nameEs },
        minCount: split.minCount,
        with: rowView(split.with),
        without: rowView(split.without),
      }
    }
    const aliases = await this.settings.aliases()
    return {
      scope: this.scopeView(scope, dataset),
      archetype: { archetype: this.archetypeRef(dataset, archetypeId), ...rowView(recordOf(dataset, entries)) },
      merged: [...aliases].filter(([, canonical]) => canonical === archetypeId).map(([alias]) => alias),
      lists: lists.map((row) =>
        this.listView(dataset, { ...row, share: (row.lists / dataset.entries.length) * 100 }, scope.index),
      ),
      cards: cardUsage(entries).map((usage) => ({
        ...usage,
        nameEs: scope.index.groupById(usage.groupId)?.nameEs ?? usage.groupId,
      })),
      withWithout: withWithoutView,
    }
  }

  async lists(
    query: ScopeQuery & {
      kind?: ListKeyKind | undefined
      archetype?: string | undefined
      limit?: number | undefined
      minLists?: number | undefined
    },
  ): Promise<ListsView> {
    const scope = await this.scope(query)
    const dataset = await this.dataset(scope)
    const archetypeId =
      query.archetype === undefined
        ? undefined
        : query.archetype === 'none'
          ? null
          : ((await this.settings.aliases()).get(query.archetype) ?? query.archetype)
    const rows = listRows(dataset, query.kind ?? 'group').filter(
      (row) => (archetypeId === undefined || row.archetypeId === archetypeId) && row.lists >= (query.minLists ?? 1),
    )
    return {
      scope: this.scopeView(scope, dataset),
      rows: rows.slice(0, query.limit ?? 100).map((row) => this.listView(dataset, row, scope.index)),
      total: rows.length,
    }
  }

  async list(key: string, query: ScopeQuery & { kind?: ListKeyKind | undefined }): Promise<ListDetailView> {
    const scope = await this.scope(query)
    const dataset = await this.dataset(scope)
    const kind = query.kind ?? 'group'
    const entries = entriesOfList(dataset, key, kind)
    if (entries.length === 0) throw new NotFoundException(`Lista ${key} no encontrada en esta era.`)
    const row = listRows({ ...dataset, entries }, kind)[0] as ListRow
    const playable = await this.playable(scope.index)
    const [against] = listsAgainstCollection({ ...dataset, entries: [entries[0] as DatasetEntry] }, playable)
    const energies = mostCommonEnergies(entries)
    const names = new Map(dataset.tournaments.map((t) => [t.id, t.name]))
    return {
      scope: this.scopeView(scope, dataset),
      list: {
        ...this.listView(dataset, { ...row, share: (row.lists / dataset.entries.length) * 100 }, scope.index),
        missing: (against?.missing ?? []).map((item) => ({
          ...item,
          nameEs: scope.index.groupById(item.groupId)?.nameEs ?? item.groupId,
        })),
        missingCopies: against?.missingCopies ?? 0,
      },
      substitutes: substitutesFor(dataset, row.archetypeId, row.groups, scope.index, playable).map((item) => ({
        groupId: item.groupId,
        nameEs: scope.index.groupById(item.groupId)?.nameEs ?? item.groupId,
        need: item.need,
        have: item.have,
        options: item.options.map((option) => {
          const group = scope.index.groupById(option.groupId)
          return {
            groupId: option.groupId,
            cardId: group?.displayCardId ?? option.groupId,
            nameEs: group?.nameEs ?? option.groupId,
            reason: option.reason,
            reasonEs:
              option.reason === 'same_name'
                ? 'la misma carta en otra versión (con otro texto)'
                : option.reason === 'replaces'
                  ? `la juegan ${option.lists} de ${option.of} listas del arquetipo que no llevan la que falta`
                  : `la juegan ${option.lists} de ${option.of} listas del arquetipo`,
            lists: option.lists,
            of: option.of,
            have: option.have,
          }
        }),
      })),
      energies,
      text: limitlessText(row.cards, energies, scope.index),
      entries: [...entries]
        .sort((a, b) => b.date.getTime() - a.date.getTime())
        .map((entry) => ({
          tournamentId: entry.tournamentId,
          tournamentName: names.get(entry.tournamentId) ?? entry.tournamentId,
          date: entry.date.toISOString(),
          playerName: entry.playerName,
          placing: entry.placing,
          record: entry.record,
        })),
    }
  }

  /**
   * What the alerts need of the tournaments (Fase 8): the «era nueva probable» warning and the sets of the cards the
   * catalog does not know in the current era's lists (a set is out).
   */
  async eraAlerts(): Promise<{
    newEra: { lastRelease: string; days: number; likely: boolean } | null
    unknownCards: number
    unknownSets: string[]
  }> {
    const sets = await this.settings.sets()
    const warning = newEraWarning(todayInOwnerZone(), sets)
    const { dataset } = await this.scopedDataset({})
    return {
      newEra: warning ? { lastRelease: warning.lastRelease.code, days: warning.days, likely: warning.likely } : null,
      unknownCards: dataset.unknownCards.length,
      unknownSets: [...new Set(dataset.unknownCards.map((card) => card.set))].sort(),
    }
  }

  /** The era's dataset with its scope (the Laboratorio's meta bank and novelty, T-008). */
  async scopedDataset(query: ScopeQuery): Promise<{ scope: Scope; dataset: TournamentDataset }> {
    const scope = await this.scope(query)
    return { scope, dataset: await this.dataset(scope) }
  }

  /** Playable copies per functional card of the collection today. */
  async playable(index: CatalogIndex): Promise<(groupId: CardId) => number> {
    const { stock, adjustments } = await this.collection.loadState()
    const copies = new Map([...playableCopies(index, stock, adjustments)].map(([groupId, c]) => [groupId, c.playable]))
    return (groupId) => copies.get(groupId) ?? 0
  }

  async buildable(query: ScopeQuery & { limit?: number | undefined }): Promise<BuildableView> {
    const scope = await this.scope(query)
    const dataset = await this.dataset(scope)
    const rows = listsAgainstCollection(dataset, await this.playable(scope.index))
    const limit = query.limit ?? 100
    return {
      scope: this.scopeView(scope, dataset),
      buildable: buildableLists(rows)
        .slice(0, limit)
        .map((row) => this.againstView(dataset, row, scope.index)),
      near: rows
        .filter((row) => row.missingCopies > 0 && row.missingCopies <= 2)
        .sort((a, b) => a.missingCopies - b.missingCopies || b.list.lists - a.list.lists)
        .slice(0, limit)
        .map((row) => this.againstView(dataset, row, scope.index)),
    }
  }

  async unlock(query: ScopeQuery & { limit?: number | undefined }): Promise<UnlockView> {
    const scope = await this.scope(query)
    const dataset = await this.dataset(scope)
    const playable = await this.playable(scope.index)
    const cards = unlockCards(listsAgainstCollection(dataset, playable))
    return {
      scope: this.scopeView(scope, dataset),
      cards: cards.slice(0, query.limit ?? 50).map((card) => ({
        groupId: card.groupId,
        nameEs: scope.index.groupById(card.groupId)?.nameEs ?? card.groupId,
        have: playable(card.groupId),
        copies: card.copies,
        lists: card.lists,
        listsWithOneCopy: card.listsWithOneCopy,
        entries: card.entries,
        record: card.record,
        rate: card.rate,
        unlocked: card.unlocked.slice(0, 5).map((row) => this.againstView(dataset, row, scope.index)),
      })),
    }
  }

  async tournaments(query: ScopeQuery): Promise<{ scope: ScopeView; rows: TournamentRowView[] }> {
    const scope = await this.scope(query)
    const dataset = await this.dataset(scope)
    const organizers = new Map(
      (
        await this.prisma.tournament.findMany({
          where: { id: { in: dataset.tournaments.map((t) => t.id) } },
          select: { id: true, organizerName: true },
        })
      ).map((row) => [row.id, row.organizerName]),
    )
    return {
      scope: this.scopeView(scope, dataset),
      rows: dataset.tournaments.map((t) => ({
        id: t.id,
        name: t.name,
        date: t.date.toISOString(),
        players: t.players,
        lists: t.lists,
        organizerName: organizers.get(t.id) ?? null,
        conflict: t.conflict,
      })),
    }
  }

  async unknownCards(query: ScopeQuery): Promise<{ scope: ScopeView; cards: UnknownCardView[] }> {
    const scope = await this.scope(query)
    const dataset = await this.dataset(scope)
    return { scope: this.scopeView(scope, dataset), cards: dataset.unknownCards }
  }

  async status(): Promise<StatusView> {
    const [sets, minPlayers, groups, lastRun, newest] = await Promise.all([
      this.settings.sets(),
      this.settings.minPlayers(),
      this.prisma.tournament.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.limitlessSyncRun.findFirst({ where: { status: { not: 'running' } }, orderBy: { startedAt: 'desc' } }),
      this.prisma.tournament.findFirst({
        where: { status: 'complete' },
        orderBy: { date: 'desc' },
        select: { date: true },
      }),
    ])
    const index = this.catalog.requireIndex()
    const today = todayInOwnerZone()
    const eras = eraSets(sets)
      .map((set) => this.eraView(set.code, sets, index, today))
      .reverse()
    const counts = { listed: 0, complete: 0, incomplete: 0, excluded: 0, failed: 0 }
    for (const group of groups) counts[group.status] = group._count._all
    const warning = newEraWarning(today, sets)
    const progress = this.sync.currentProgress()
    return {
      currentEra: eras.find((era) => era.current) ?? null,
      eras,
      newEra: warning
        ? {
            lastRelease: warning.lastRelease.code,
            releaseDate: warning.lastRelease.releaseDate,
            days: warning.days,
            likely: warning.likely,
          }
        : null,
      minPlayers,
      sync: {
        enabled: this.env.limitlessSync,
        running: this.sync.isRunning(),
        progress: progress ? { ...progress, startedAt: progress.startedAt.toISOString() } : null,
        lastRun: lastRun
          ? {
              id: lastRun.id,
              kind: lastRun.kind,
              status: lastRun.status,
              startedAt: lastRun.startedAt.toISOString(),
              finishedAt: lastRun.finishedAt?.toISOString() ?? null,
              calls: lastRun.calls,
              tournamentsListed: lastRun.tournamentsListed,
              tournamentsDone: lastRun.tournamentsDone,
              error: lastRun.error,
            }
          : null,
        callsInWindow: this.sync.callsInWindow(),
        counts,
        newestTournament: newest?.date.toISOString() ?? null,
      },
    }
  }

  async setReleases(): Promise<SetReleaseView[]> {
    const index = this.catalog.requireIndex()
    return (await this.settings.sets())
      .map((set) => ({ ...set, nameEs: index.expansionById(set.code)?.nameEs ?? null }))
      .reverse()
  }

  async saveSetRelease(set: SetRelease): Promise<SetReleaseView> {
    await this.settings.saveSet(set)
    return { ...set, nameEs: this.catalog.requireIndex().expansionById(set.code)?.nameEs ?? null }
  }

  async setAlias(archetypeId: string, canonicalId: string | null): Promise<void> {
    await this.settings.setAlias(archetypeId, canonicalId)
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Decks and matches
  // ---------------------------------------------------------------------------------------------------------------

  /** The «torneo» column of a deck: its exact list (both keys) and its archetype (mine, or the closest lists'). */
  async deckTournament(
    cards: readonly DeckCardEntry[],
    ownerArchetypeId: string | null,
    query: ScopeQuery = {},
  ): Promise<DeckTournamentView> {
    const scope = await this.scope(query)
    const dataset = await this.dataset(scope)
    const where = deckInTournaments(dataset, cards, scope.index)
    const aliases = await this.settings.aliases()
    const chosen = ownerArchetypeId === null ? null : (aliases.get(ownerArchetypeId) ?? ownerArchetypeId)
    const archetypeId = chosen ?? where.guessed?.archetypeId ?? null
    let archetype: DeckTournamentView['archetype'] = null
    if (archetypeId !== null) {
      const entries = entriesOfArchetype(dataset, archetypeId)
      archetype = {
        archetype: this.archetypeRef(dataset, archetypeId),
        ...rowView(recordOf(dataset, entries)),
        source: chosen !== null ? 'owner' : 'guessed',
        swaps: chosen !== null ? null : (where.guessed?.swaps ?? null),
      }
    }
    return {
      scope: this.scopeView(scope, dataset),
      exactByGroup: where.exactByGroup ? rowView(where.exactByGroup) : null,
      exactByName: where.exactByName ? rowView(where.exactByName) : null,
      keyByGroup: where.keyByGroup,
      keyByName: where.keyByName,
      archetype,
    }
  }

  /** The «versión de torneo» of one deck, with other lists of its archetype to look at. */
  async deckVersion(rawDeckId: string, query: ScopeQuery = {}): Promise<DeckVersionDetailView> {
    const scope = await this.scope(query)
    const dataset = await this.dataset(scope)
    const [deck] = await this.decksWithCards({ id: parseNumericId(rawDeckId, 'Mazo') })
    if (!deck) throw new NotFoundException(`Mazo ${rawDeckId} no encontrado.`)
    const context = await this.versionContext(scope)
    return { scope: this.scopeView(scope, dataset), ...this.versionOf(dataset, scope, context, deck, true) }
  }

  /** The «versión de torneo» of every active deck (Sobres: «Completar mazos» aimed at it). */
  async deckVersions(query: ScopeQuery = {}, deckIds?: readonly number[]): Promise<DeckVersionsView> {
    const scope = await this.scope(query)
    const dataset = await this.dataset(scope)
    const where = deckIds ? { archivedAt: null, id: { in: [...deckIds] } } : { archivedAt: null }
    const [decks, context] = await Promise.all([this.decksWithCards(where), this.versionContext(scope)])
    return {
      scope: this.scopeView(scope, dataset),
      decks: decks.map((deck) => this.versionOf(dataset, scope, context, deck, false)),
    }
  }

  private async decksWithCards(where: Prisma.DeckWhereInput) {
    const decks = await this.prisma.deck.findMany({
      where,
      select: { id: true, name: true, tournamentArchetypeId: true, currentRevisionId: true },
      orderBy: { id: 'asc' },
    })
    const revisionIds = decks.map((deck) => deck.currentRevisionId).filter((id): id is number => id !== null)
    const revisions = new Map(
      (
        await this.prisma.deckRevision.findMany({
          where: { id: { in: revisionIds } },
          select: { id: true, cards: true },
        })
      ).map((revision) => [revision.id, revision.cards as unknown as DeckCardEntry[]]),
    )
    return decks.map((deck) => ({
      id: idToString(deck.id),
      name: deck.name,
      archetypeId: deck.tournamentArchetypeId,
      cards: deck.currentRevisionId === null ? [] : (revisions.get(deck.currentRevisionId) ?? []),
    }))
  }

  private async versionContext(scope: Scope) {
    const [aliases, playable] = await Promise.all([this.settings.aliases(), this.playable(scope.index)])
    return { aliases, playable }
  }

  private versionOf(
    dataset: TournamentDataset,
    scope: Scope,
    context: { aliases: Map<string, string>; playable: (groupId: CardId) => number },
    deck: { id: string; name: string; archetypeId: string | null; cards: DeckCardEntry[] },
    withAlternatives: boolean,
  ): DeckVersionView {
    const index = scope.index
    const chosen = deck.archetypeId === null ? null : (context.aliases.get(deck.archetypeId) ?? deck.archetypeId)
    const guessed = chosen === null ? deckInTournaments(dataset, deck.cards, index).guessed : null
    const archetypeId = chosen ?? guessed?.archetypeId ?? null
    const base = { deckId: deck.id, deckName: deck.name }
    if (archetypeId === null) return { ...base, archetype: null, version: null }
    const archetype = {
      ...this.archetypeRef(dataset, archetypeId),
      source: chosen !== null ? ('owner' as const) : ('guessed' as const),
      swaps: chosen !== null ? null : (guessed?.swaps ?? null),
    }
    const version = tournamentVersion(dataset, archetypeId, deck.cards, index, context.playable)
    if (!version) return { ...base, archetype, version: null }
    const named = (change: { groupId: CardId; count: number }) => ({
      groupId: change.groupId,
      nameEs: index.groupById(change.groupId)?.nameEs ?? change.groupId,
      count: change.count,
    })
    return {
      ...base,
      archetype,
      version: {
        list: this.listView(dataset, version.list, index),
        swaps: version.swaps,
        add: version.add.map(named),
        remove: version.remove.map(named),
        missing: version.missing.map((item) => ({
          ...item,
          nameEs: index.groupById(item.groupId)?.nameEs ?? item.groupId,
        })),
        missingCopies: version.missingCopies,
        alternatives: withAlternatives ? version.alternatives.map((row) => this.listView(dataset, row, index)) : [],
      },
    }
  }

  /** Archetypes of the current Standard era with ≥ 5 lists, for the opponent field of the quick-entry sheet. */
  async opponentArchetypes(): Promise<{ name: string; lists: number }[]> {
    try {
      const scope = await this.scope({})
      const dataset = await this.dataset(scope)
      return archetypeRows(dataset)
        .filter((row) => row.archetype !== null && row.lists >= OPPONENT_MIN_LISTS)
        .slice(0, 60)
        .map((row) => ({ name: row.archetype?.name ?? '', lists: row.lists }))
    } catch {
      return []
    }
  }
}

function rowView(row: RecordRow): RecordRowView {
  return { lists: row.lists, record: row.record, rate: row.rate, share: row.share }
}

/** Limitless clipboard text (Pokémon, blank line, trainers, blank line, `Energy:`): imports as a deck. */
function limitlessText(cards: readonly ListCard[], energies: readonly string[], index: CatalogIndex): string {
  const line = (card: ListCard) => `${card.count} ${card.name} ${card.set} ${card.number}`
  const isPokemon = (card: ListCard) => card.cardId !== null && index.cardById(card.cardId)?.cardType === 'pokemon'
  const blocks = [cards.filter(isPokemon).map(line), cards.filter((card) => !isPokemon(card)).map(line)]
    .filter((block) => block.length > 0)
    .map((block) => block.join('\r\n'))
  if (energies.length > 0) blocks.push(`Energy: ${energies.join(', ')}`)
  return blocks.join('\r\n\r\n')
}
