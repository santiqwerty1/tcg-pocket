/**
 * The read tools of the MCP server (PLAN §3.8, Apéndice D; Fase 3). Definitions (names, Spanish descriptions,
 * input schemas) come from @tcg/domain; the handlers here call the same services as the REST API and answer
 * compact JSON (also as `structuredContent`). Every rate carries its canonical Spanish `text`
 * («70 % (n = 10, IC 39,7–89,2 %, orientativo)») so the model quotes n and interval with it.
 */

import type { CallToolResult, McpRequestContext, StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import { McpServer } from '@modelcontextprotocol/server'
import { BadRequestException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import {
  type CardEdition,
  type FunctionalGroup,
  foldText,
  formatWinRateEs,
  MATCH_MODE_LABEL_ES,
  MATCH_RESULT_LABEL_ES,
  type MatchMode,
  MCP_READ_TOOLS,
  MCP_SERVER_INSTRUCTIONS,
  MCP_WRITE_INSTRUCTIONS,
  type Rarity,
  type TournamentFormat,
} from '@tcg/domain'
import { PinoLogger } from 'nestjs-pino'
import { CatalogService } from '../catalog/catalog.service.js'
import type { GroupDetail } from '../catalog/catalog-views.js'
import { CollectionService } from '../collection/collection.service.js'
import { ENV, type Env } from '../config/env.js'
import type { DeckImportFormat } from '../decks/deck-formats.js'
import { DecksService } from '../decks/decks.service.js'
import { EventsService } from '../events/events.service.js'
import type { RowView } from '../matches/match-views.js'
import { MatchesService } from '../matches/matches.service.js'
import { PacksService } from '../packs/packs.service.js'
import { PickService } from '../pick/pick.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { RivalNotesService } from '../rivals/rival-notes.service.js'
import { SimulationsService } from '../simulation/simulations.service.js'
import type {
  ArchetypeRowView,
  ListAgainstCollectionView,
  ListRowView,
  RecordRowView,
  ScopeView,
} from '../tournaments/tournament-views.js'
import { TournamentsService } from '../tournaments/tournaments.service.js'
import { TradesService } from '../trades/trades.controller.js'
import { WeeklyService } from '../weekly/weekly.controller.js'
import { type DeckRef, DeckRefResolver } from './deck-ref.js'
import { jobSummaryJson, rateView } from './mcp-json.js'
import { McpLabToolsService } from './mcp-lab-tools.service.js'
import { McpPlayToolsService } from './mcp-play-tools.service.js'
import { McpWriteToolsService } from './mcp-write-tools.service.js'

type Json = Record<string, unknown>

const percentFormat = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const twoDecimals = (value: number) => Math.round(value * 100) / 100

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const

interface ToolDefinition<S extends StandardSchemaWithJSON> {
  name: string
  title: string
  description: string
  input: S
}

/** Registration config of a domain tool definition; keeps the zod input type so the handler args are typed. */
function config<S extends StandardSchemaWithJSON>(
  def: ToolDefinition<S>,
): { title: string; description: string; inputSchema: S; annotations: typeof READ_ONLY } {
  return { title: def.title, description: def.description, inputSchema: def.input, annotations: READ_ONLY }
}

function ok(data: Json): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }
}

function rowView(row: RowView): Json {
  return { record: row.record, rate: rateView(row.rate) }
}

/** Attacks and ability in one line each (rules text is English, DECISIONES 0.14). */
function cardText(card: CardEdition): string[] {
  const lines: string[] = []
  if (card.ability) lines.push(`Ability ${card.ability.name}: ${card.ability.effect}`)
  for (const attack of card.attacks) {
    const cost = attack.cost.length > 0 ? attack.cost.join('+') : 'sin costo'
    const damage = attack.damage ? ` ${attack.damage}` : ''
    lines.push(`${attack.name} [${cost}]${damage}${attack.effect ? `: ${attack.effect}` : ''}`)
  }
  return lines
}

@Injectable()
export class McpToolsService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly collection: CollectionService,
    private readonly decks: DecksService,
    private readonly matches: MatchesService,
    private readonly packs: PacksService,
    private readonly tournaments: TournamentsService,
    private readonly simulations: SimulationsService,
    private readonly prisma: PrismaService,
    private readonly deckRefs: DeckRefResolver,
    private readonly rivalNotes: RivalNotesService,
    private readonly pick: PickService,
    private readonly events: EventsService,
    private readonly writeTools: McpWriteToolsService,
    private readonly labTools: McpLabToolsService,
    private readonly playTools: McpPlayToolsService,
    private readonly trades: TradesService,
    private readonly weekly: WeeklyService,
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(McpToolsService.name)
  }

  /** One server per HTTP request (stateless, both protocol eras): cheap, only registrations. */
  buildServer(context: McpRequestContext): McpServer {
    // Write tools only for a token with `mcp:write`: a read-only connector does not even see them.
    const canWrite = context.authInfo?.scopes?.includes('mcp:write') ?? false
    const server = new McpServer(
      { name: 'tcg-pocket', title: 'TCG Pocket de Santi', version: this.env.version },
      {
        instructions: canWrite
          ? `${MCP_SERVER_INSTRUCTIONS}
${MCP_WRITE_INSTRUCTIONS}`
          : MCP_SERVER_INSTRUCTIONS,
      },
    )
    const t = MCP_READ_TOOLS
    const caller = context.authInfo?.clientId ?? 'unknown'
    const run = (name: string, work: () => Promise<Json>) => this.run(name, caller, work)

    server.registerTool(t.collectionSummary.name, config(t.collectionSummary), () =>
      run(t.collectionSummary.name, () => this.collectionSummary()),
    )
    server.registerTool(t.cardsSearch.name, config(t.cardsSearch), (args) =>
      run(t.cardsSearch.name, async () => this.cardsSearch(args.q, args.lang, args.limit)),
    )
    server.registerTool(t.collectionPlayableCopies.name, config(t.collectionPlayableCopies), (args) =>
      run(t.collectionPlayableCopies.name, () => this.playableCopies(args.query)),
    )
    server.registerTool(t.collectionEditions.name, config(t.collectionEditions), (args) =>
      run(t.collectionEditions.name, () => this.editions(args.query)),
    )
    server.registerTool(t.decksList.name, config(t.decksList), (args) =>
      run(t.decksList.name, () => this.decksList(args)),
    )
    server.registerTool(t.decksGet.name, config(t.decksGet), (args) =>
      run(t.decksGet.name, () => this.decksGet(args.deck)),
    )
    server.registerTool(t.decksFindByCard.name, config(t.decksFindByCard), (args) =>
      run(t.decksFindByCard.name, () => this.decksFindByCard(args.query)),
    )
    server.registerTool(t.decksValidate.name, config(t.decksValidate), (args) =>
      run(t.decksValidate.name, () => this.decksValidate(args)),
    )
    server.registerTool(t.decksMissing.name, config(t.decksMissing), (args) =>
      run(t.decksMissing.name, () => this.decksMissing(args.deck)),
    )
    server.registerTool(t.decksClosest.name, config(t.decksClosest), (args) =>
      run(t.decksClosest.name, () => this.decksClosest(args)),
    )
    // Random is read-only but not idempotent: each call may pick another deck.
    server.registerTool(
      t.decksRandom.name,
      { ...config(t.decksRandom), annotations: { ...READ_ONLY, idempotentHint: false } },
      (args) => run(t.decksRandom.name, () => this.decksRandom(args)),
    )
    server.registerTool(t.matchesStats.name, config(t.matchesStats), (args) =>
      run(t.matchesStats.name, () => this.matchesStats(args)),
    )
    server.registerTool(t.matchesList.name, config(t.matchesList), (args) =>
      run(t.matchesList.name, () => this.matchesList(args)),
    )
    server.registerTool(t.packsRecommend.name, config(t.packsRecommend), (args) =>
      run(t.packsRecommend.name, () => this.packsRecommend(args)),
    )
    server.registerTool(t.tournamentsStats.name, config(t.tournamentsStats), (args) =>
      run(t.tournamentsStats.name, () => this.tournamentsStats(args)),
    )
    server.registerTool(t.matchesLuck.name, config(t.matchesLuck), (args) =>
      run(t.matchesLuck.name, () => this.matchesLuck(args)),
    )
    server.registerTool(t.eventsCheck.name, config(t.eventsCheck), (args) =>
      run(t.eventsCheck.name, () => this.eventsCheck(args)),
    )
    server.registerTool(t.rivalsNotes.name, config(t.rivalsNotes), (args) =>
      run(t.rivalsNotes.name, () => this.rivalsNotes(args)),
    )
    server.registerTool(t.decksPickToday.name, config(t.decksPickToday), (args) =>
      run(t.decksPickToday.name, () => this.decksPickToday(args)),
    )
    server.registerTool(t.decksDrawOdds.name, config(t.decksDrawOdds), (args) =>
      run(t.decksDrawOdds.name, () => this.decksDrawOdds(args)),
    )
    server.registerTool(t.tournamentsTrends.name, config(t.tournamentsTrends), (args) =>
      run(t.tournamentsTrends.name, () => this.tournamentsTrends(args)),
    )
    server.registerTool(t.tournamentsMatchups.name, config(t.tournamentsMatchups), (args) =>
      run(t.tournamentsMatchups.name, () => this.tournamentsMatchups(args)),
    )
    server.registerTool(t.tournamentsBuildable.name, config(t.tournamentsBuildable), (args) =>
      run(t.tournamentsBuildable.name, () => this.tournamentsBuildable(args)),
    )
    server.registerTool(t.tournamentsUnlockCards.name, config(t.tournamentsUnlockCards), (args) =>
      run(t.tournamentsUnlockCards.name, () => this.tournamentsUnlock(args)),
    )
    server.registerTool(t.collectionPackLuck.name, config(t.collectionPackLuck), () =>
      run(t.collectionPackLuck.name, () => this.collectionPackLuck()),
    )
    server.registerTool(t.weekSummary.name, config(t.weekSummary), (args) =>
      run(t.weekSummary.name, async () => ({ ...(await this.weekly.summary({ week: args.week })) })),
    )
    server.registerTool(t.collectionTrades.name, config(t.collectionTrades), (args) =>
      run(t.collectionTrades.name, () => this.collectionTrades(args)),
    )
    server.registerTool(t.collectionMissions.name, config(t.collectionMissions), (args) =>
      run(t.collectionMissions.name, () => this.collectionMissions(args)),
    )
    server.registerTool(t.simulationsResults.name, config(t.simulationsResults), (args) =>
      run(t.simulationsResults.name, () => this.simulationsResults(args)),
    )
    this.labTools.registerRead(server, run)
    this.playTools.registerRead(server, run)
    if (canWrite) {
      this.writeTools.register(server, run)
      this.labTools.registerWrite(server, run)
    }
    return server
  }

  /** Runs a tool: expected failures (unknown card or deck, invalid input) become `isError` results the model reads. */
  private async run(name: string, caller: string, work: () => Promise<Json>): Promise<CallToolResult> {
    const started = Date.now()
    try {
      const data = await work()
      this.logger.info({ tool: name, caller, ms: Date.now() - started }, 'mcp tool call')
      return ok(data)
    } catch (error) {
      if (error instanceof HttpException) {
        const body = error.getResponse()
        const message =
          typeof body === 'object' && body !== null && 'message' in body ? String(body.message) : error.message
        this.logger.info({ tool: name, caller, ms: Date.now() - started, status: error.getStatus() }, 'mcp tool error')
        return { content: [{ type: 'text', text: message }], isError: true }
      }
      this.logger.error({ tool: name, caller, err: error }, 'mcp tool failed')
      return { content: [{ type: 'text', text: 'Error interno del servidor al ejecutar la tool.' }], isError: true }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Collection and catalog
  // ---------------------------------------------------------------------------------------------------------------

  private async collectionSummary(): Promise<Json> {
    const summary = await this.collection.summary()
    return {
      copies: summary.copies,
      functionalCardsWithAtLeastOne: summary.groupsWithAtLeast.one,
      functionalCardsWithAtLeastTwo: summary.groupsWithAtLeast.two,
      functionalCardsMissing: summary.groupsMissing,
      activeAdjustments: summary.activeAdjustments,
      lastImportAt: summary.lastImportAt?.toISOString() ?? null,
    }
  }

  private cardsSearch(q: string, lang: 'es' | 'en' | 'any' | undefined, limit: number | undefined): Json {
    const index = this.catalog.requireIndex()
    const hits = index.search(q, { lang: lang ?? 'any', limit: limit ?? 10 })
    return {
      query: q,
      results: hits.map(({ card, matchedOn }) => ({
        cardId: card.id,
        nameEs: card.nameEs,
        nameEn: card.nameEn,
        functionalGroupId: card.functionalGroupId,
        expansion: index.expansionById(card.expansionId)?.nameEs ?? card.expansionId,
        rarity: card.rarity,
        cardType: card.cardType,
        stage: card.evolutionType,
        hp: card.hp,
        energy: card.energy,
        prizePoints: card.prizePoints,
        text: cardText(card),
        matchedOn,
      })),
    }
  }

  /**
   * Functional cards a query refers to. An id or an exact name keeps every group with that score (two Riolu with
   * different text); a looser query returns up to five candidates, name matches before rules-text matches.
   */
  private resolveGroups(query: string): { groups: FunctionalGroup[]; exact: boolean } {
    const index = this.catalog.requireIndex()
    const hits = index.searchGroups(query, { limit: 30 })
    const byName = hits.filter((hit) => hit.matchedOn !== 'text')
    const pool = byName.length > 0 ? byName : hits
    const best = pool[0]
    if (!best) throw new NotFoundException(`No encontré ninguna carta «${query}» en el catálogo.`)
    const exact = best.matchedOn === 'id' || best.matchedOn === 'name_exact'
    const chosen = exact ? pool.filter((hit) => hit.score === best.score) : pool.slice(0, 5)
    return { groups: chosen.map((hit) => hit.group), exact }
  }

  private async playableCopies(query: string): Promise<Json> {
    const { groups, exact } = this.resolveGroups(query)
    const details = await Promise.all(groups.map((group) => this.catalog.groupDetail(group.id)))
    return {
      query,
      exactMatch: exact,
      ...(exact ? {} : { note: 'No hubo coincidencia exacta: estas son las cartas más parecidas.' }),
      cards: details.map((detail) => ({
        functionalGroupId: detail.id,
        nameEs: detail.nameEs,
        nameEn: detail.nameEn,
        playableCopies: detail.playable,
        fromCollection: detail.fromStock,
        adjustment: detail.adjustment
          ? { playableCopies: detail.adjustment.playableCopies, reason: detail.adjustment.reason }
          : null,
        ownedEditions: stockUnits(detail).filter((unit) => unit.owned > 0),
        decksUsingIt: detail.decks.map((deck) => ({
          id: deck.id,
          name: deck.name,
          copies: deck.count,
          builtInGame: deck.builtInGame,
        })),
      })),
    }
  }

  private async editions(query: string): Promise<Json> {
    const { groups, exact } = this.resolveGroups(query)
    const details = await Promise.all(groups.map((group) => this.catalog.groupDetail(group.id)))
    return {
      query,
      exactMatch: exact,
      cards: details.map((detail) => ({
        functionalGroupId: detail.id,
        nameEs: detail.nameEs,
        playableCopies: detail.playable,
        editions: detail.editions.map((edition) => ({
          cardId: edition.card.id,
          rarity: edition.card.rarity,
          expansion: edition.card.expansionId,
          owned: edition.owned,
          collected: edition.collected,
          ...(edition.twinCardIds.length > 0 ? { sharesRowWith: edition.twinCardIds } : {}),
        })),
      })),
      note: 'Las ediciones gemelas (sharesRowWith) son la misma fila del tracker: su cantidad no se suma dos veces.',
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Decks
  // ---------------------------------------------------------------------------------------------------------------

  private resolveDeck(ref: string): Promise<DeckRef> {
    return this.deckRefs.resolve(ref)
  }

  private async decksList(args: { archived?: boolean; builtInGame?: boolean; tag?: string }): Promise<Json> {
    const [items, stats] = await Promise.all([
      this.decks.list({ archived: args.archived, builtInGame: args.builtInGame, tag: args.tag }),
      this.matches.stats({}),
    ])
    const byDeck = new Map(stats.byDeck.map((row) => [row.deck.id, row]))
    return {
      count: items.length,
      decks: items.map((deck) => {
        const played = byDeck.get(deck.id)
        return {
          id: deck.id,
          name: deck.name,
          energies: deck.energies,
          tags: deck.tags,
          valid: deck.valid,
          validationErrors: deck.errorCount,
          complete: deck.complete,
          missingCopies: deck.missingCount,
          builtInGame: deck.builtInGame,
          archived: deck.archivedAt !== null,
          revision: deck.revisionNumber,
          myMatches: played ? rowView(played) : null,
        }
      }),
    }
  }

  private async decksGet(ref: string): Promise<Json> {
    const deck = await this.resolveDeck(ref)
    const [detail, exported, stats, tournament] = await Promise.all([
      this.decks.detail(deck.id),
      this.decks.export(deck.id, 'spanish').catch(() => null),
      this.matches.stats({ deckId: deck.id }),
      this.tournaments.deckVersion(deck.id).catch(() => null),
    ])
    const version = tournament?.version ?? null
    return {
      id: detail.id,
      name: detail.name,
      energies: detail.energies,
      tags: detail.tags,
      builtInGame: detail.builtInGame,
      archived: detail.archivedAt !== null,
      revision: detail.revisionNumber,
      cardCount: detail.cardCount,
      cards: detail.cards.map((entry) => ({
        count: entry.count,
        cardId: entry.card.id,
        nameEs: entry.card.nameEs,
        nameEn: entry.card.nameEn,
        cardType: entry.card.cardType,
        stage: entry.card.evolutionType,
        prizePoints: entry.card.prizePoints,
        playableCopies: entry.playable,
        missing: entry.missing,
      })),
      valid: detail.validation.ok,
      errors: detail.validation.errors.map((issue) => issue.message),
      warnings: detail.validation.warnings.map((issue) => issue.message),
      complete: detail.completeness.complete,
      missing: detail.completeness.missing.map((item) => ({ nameEs: item.nameEs, need: item.need, have: item.have })),
      notes: detail.notes,
      revisions: detail.revisions.length,
      text: exported?.body ?? null,
      myMatches: rowView(stats.overall),
      bestVersions: {
        note: 'Al armarlo en el juego, usá estas versiones que tenés de la misma carta (más rara o holográfica).',
        changes: detail.bestVersions.groups.map((group) => ({
          nameEs: group.nameEs,
          listed: group.current.map((entry) => `${entry.count}× ${entry.cardId}`),
          use: group.recommended.map(
            (pick) => `${pick.count}× ${pick.cardId} ${pick.rarity}${pick.holo ? ' holográfica' : ''}`,
          ),
        })),
      },
      tournamentVersion:
        tournament === null
          ? null
          : {
              note: 'La lista de torneo de su arquetipo a la que conviene apuntar: jugada al menos 5 veces en la era, la de mejor cota inferior del intervalo. «missing» es lo que falta en la colección para armarla.',
              archetype: tournament.archetype
                ? {
                    name: tournament.archetype.name,
                    source: tournament.archetype.source === 'owner' ? 'elegido en el mazo' : 'sugerido',
                  }
                : null,
              list: version
                ? {
                    key: version.list.key,
                    lists: version.list.lists,
                    record: version.list.record,
                    rate: rateView(version.list.rate),
                    cards: version.list.cards.map(
                      (card) => `${card.count} ${card.nameEs} (${card.set}-${card.number})`,
                    ),
                  }
                : null,
              changes: version
                ? {
                    swaps: version.swaps,
                    add: version.add.map((change) => `${change.count} ${change.nameEs}`),
                    remove: version.remove.map((change) => `${change.count} ${change.nameEs}`),
                  }
                : null,
              missing: version
                ? version.missing.map((item) => ({ nameEs: item.nameEs, need: item.need, have: item.have }))
                : [],
              era: tournament.scope.era.code,
              source: tournament.scope.attribution,
            },
    }
  }

  private async decksClosest(args: {
    deck?: string
    text?: string
    scope?: 'built' | 'all'
    limit?: number
  }): Promise<Json> {
    const deck = args.deck ? await this.resolveDeck(args.deck) : null
    if (!deck && (args.text === undefined || args.text.trim() === '')) {
      throw new BadRequestException('Indicá la lista nueva: `deck` (un mazo guardado) o `text` (la lista pegada).')
    }
    const result = await this.decks.closest(
      deck
        ? { deckId: deck.id, scope: args.scope, limit: args.limit }
        : { text: args.text, scope: args.scope, limit: args.limit },
    )
    const change = (item: { nameEs: string; count: number; cardIds: string[] }) =>
      `${item.count}× ${item.nameEs} (${item.cardIds.join(', ')})`
    return {
      target: result.target,
      scope: result.scope === 'built' ? 'mazos armados en el juego' : 'todos los mazos guardados activos',
      candidates: result.candidates,
      ...(result.scope === 'built' && result.builtInGameDecks === 0
        ? {
            note: 'No hay mazos marcados como «armado en el juego». Marcalos en la app o pedí scope «all».',
          }
        : {}),
      closest: result.results.map((distance) => ({
        deckId: distance.deckId,
        deck: distance.name,
        builtInGame: distance.builtInGame,
        swaps: distance.swaps,
        keep: distance.keep,
        remove: distance.toRemove.map(change),
        add: distance.toAdd.map(change),
        energy: distance.energies.change ? { from: distance.energies.from, to: distance.energies.to } : 'sin cambios',
        sameCardOtherEdition: distance.otherEdition.map(change),
      })),
    }
  }

  private async decksRandom(args: { builtInGame?: boolean; tag?: string; leastPlayed?: boolean }): Promise<Json> {
    const picked = await this.decks.random(args)
    return {
      deck: {
        id: picked.deck.id,
        name: picked.deck.name,
        energies: picked.deck.energies,
        valid: picked.deck.valid,
        complete: picked.deck.complete,
        builtInGame: picked.deck.builtInGame,
      },
      myMatches: picked.games,
      drawnFrom: picked.candidates,
    }
  }

  private async decksFindByCard(query: string): Promise<Json> {
    const { groups, exact } = this.resolveGroups(query)
    const details = await Promise.all(groups.map((group) => this.catalog.groupDetail(group.id)))
    return {
      query,
      exactMatch: exact,
      cards: details.map((detail) => ({
        functionalGroupId: detail.id,
        nameEs: detail.nameEs,
        playableCopies: detail.playable,
        decks: detail.decks.map((deck) => ({
          id: deck.id,
          name: deck.name,
          copies: deck.count,
          builtInGame: deck.builtInGame,
        })),
      })),
      note: 'Solo mazos activos (no archivados), según su revisión actual.',
    }
  }

  private async decksValidate(args: {
    text?: string
    format?: DeckImportFormat
    cards?: { cardId: string; count: number }[]
    energies?: ('grass' | 'fire' | 'water' | 'lightning' | 'psychic' | 'fighting' | 'darkness' | 'metal')[]
  }): Promise<Json> {
    const index = this.catalog.requireIndex()
    const named = (cards: readonly { cardId: string; count: number }[]) =>
      cards.map((entry) => {
        const card = index.cardById(entry.cardId)
        return {
          count: entry.count,
          cardId: entry.cardId,
          nameEs: card?.nameEs ?? null,
          cardType: card?.cardType ?? null,
        }
      })
    if (args.text !== undefined && args.text.trim() !== '') {
      const drafts = await this.decks.importPreview(args.text, args.format ?? 'auto')
      if (drafts.length === 0) return { decks: [], message: 'No encontré ningún mazo en el texto.' }
      return {
        decks: drafts.map((draft) => ({
          title: draft.title,
          number: draft.number,
          parsed: draft.draft !== null,
          parseErrors: draft.errors.map((issue) => ({
            message: issue.message,
            ...(issue.line === undefined ? {} : { line: issue.line }),
            ...(issue.candidates ? { candidates: issue.candidates } : {}),
          })),
          parseWarnings: draft.warnings.map((issue) => issue.message),
          energies: draft.draft?.energies ?? [],
          cards: named(draft.draft?.cards ?? []),
          valid: draft.validation?.ok ?? false,
          errors: draft.validation?.errors.map((issue) => issue.message) ?? [],
          warnings: draft.validation?.warnings.map((issue) => issue.message) ?? [],
          complete: draft.completeness?.complete ?? false,
          missing:
            draft.completeness?.missing.map((item) => ({ nameEs: item.nameEs, need: item.need, have: item.have })) ??
            [],
        })),
      }
    }
    if (args.cards) {
      const result = await this.decks.validate({ cards: args.cards, energies: args.energies ?? [] })
      return {
        decks: [
          {
            parsed: true,
            energies: args.energies ?? [],
            cards: named(args.cards),
            valid: result.validation.ok,
            errors: result.validation.errors.map((issue) => issue.message),
            warnings: result.validation.warnings.map((issue) => issue.message),
            complete: result.completeness.complete,
            missing: result.completeness.missing.map((item) => ({
              nameEs: item.nameEs,
              need: item.need,
              have: item.have,
            })),
          },
        ],
      }
    }
    throw new BadRequestException('Mandá `text` (la lista pegada) o `cards` con códigos de edición.')
  }

  private async decksMissing(ref: string): Promise<Json> {
    const index = this.catalog.requireIndex()
    const deck = await this.resolveDeck(ref)
    const [detail, rules] = await Promise.all([this.decks.detail(deck.id), this.prisma.rarityRule.findMany()])
    const ruleByRarity = new Map(rules.map((rule) => [rule.rarity, rule]))
    let totalPoints: number | null = 0
    const missing = detail.completeness.missing.map((item) => {
      const copies = item.need - item.have
      const editions = index.cardsOfGroup(item.groupId).map((card) => {
        const rule = ruleByRarity.get(card.rarity)
        const expansion = index.expansionById(card.expansionId)
        return {
          cardId: card.id,
          rarity: card.rarity,
          points: rule?.points ?? null,
          pointsVerified: rule?.pointsVerified ?? false,
          tradeable: Boolean(rule?.tradeable) && (expansion?.tradeable ?? false),
        }
      })
      const priced = editions.filter((edition) => edition.points !== null)
      const cheapest = priced.reduce<(typeof priced)[number] | null>(
        (best, edition) => (best === null || (edition.points ?? 0) < (best.points ?? 0) ? edition : best),
        null,
      )
      if (cheapest?.points == null) totalPoints = null
      else if (totalPoints !== null) totalPoints += cheapest.points * copies
      return {
        nameEs: item.nameEs,
        functionalGroupId: item.groupId,
        need: item.need,
        have: item.have,
        missingCopies: copies,
        cheapestEdition: cheapest,
        otherEditions: editions.filter((edition) => edition !== cheapest).map((edition) => edition.cardId),
      }
    })
    return {
      deck: { id: detail.id, name: detail.name },
      complete: detail.completeness.complete,
      missing,
      totalPackPoints: totalPoints,
      note: 'Puntos de sobre por rareza según el tracker (pointsVerified false: sin confirmar en el juego). Una edición es intercambiable si lo son su rareza y su expansión.',
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Matches
  // ---------------------------------------------------------------------------------------------------------------

  private async matchesStats(args: { deck?: string; mode?: MatchMode; days?: number }): Promise<Json> {
    const deck = args.deck ? await this.resolveDeck(args.deck) : null
    const from = args.days ? new Date(Date.now() - args.days * 24 * 60 * 60 * 1000).toISOString() : undefined
    const stats = await this.matches.stats({ deckId: deck?.id, mode: args.mode, from })
    return {
      source: 'Mis partidas registradas en la app (no incluye torneos ni simulaciones).',
      filters: {
        deck: deck ? deck.name : null,
        mode: args.mode ? MATCH_MODE_LABEL_ES[args.mode] : null,
        days: args.days ?? null,
      },
      overall: rowView(stats.overall),
      byDeck: stats.byDeck.map((row) => ({ deck: row.deck.name, deckId: row.deck.id, ...rowView(row) })),
      byOpponent: stats.byOpponent.map((row) => ({ opponent: row.label, ...rowView(row) })),
      byWentFirst: stats.byWentFirst.map((row) => ({ who: row.label, ...rowView(row) })),
      turnOrder: {
        text: stats.turnOrder.text,
        verdict: stats.turnOrder.verdict,
        coverage: `${Math.round(stats.turnOrder.coverage)} % de las partidas tienen anotado quién empezó`,
      },
      byMode: stats.byMode.map((row) => ({ mode: row.label, ...rowView(row) })),
      byRevision: stats.byRevision.map((row) => ({ revision: row.revision, ...rowView(row) })),
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Packs
  // ---------------------------------------------------------------------------------------------------------------

  private async packsRecommend(args: {
    model?: 'corrected' | 'tracker'
    alpha?: number
    collection?: { rarities: Rarity[]; copies: number } | null
    onlyAvailable?: boolean
    limitedBoost?: number
    deckTarget?: 'saved' | 'tournament'
    limit?: number
  }): Promise<Json> {
    const result = await this.packs.recommend({
      model: args.model,
      alpha: args.alpha,
      collection: args.collection,
      onlyAvailable: args.onlyAvailable ?? true,
      limitedBoost: args.limitedBoost,
      deckTarget: args.deckTarget,
    })
    const day = (iso: string) => iso.split('-').reverse().join('/')
    const lastDay = (limited: { until: string | null; daysLeft: number | null }) =>
      limited.until === null
        ? 'tiempo limitado, sin fecha de fin cargada'
        : limited.daysLeft !== null && limited.daysLeft < 0
          ? `terminó el ${day(limited.until)}`
          : `tiempo limitado hasta el ${day(limited.until)}${limited.daysLeft === null ? '' : limited.daysLeft === 0 ? ' (último día)' : ` (quedan ${limited.daysLeft} días)`}`
    const pct = (value: number) => `${percentFormat.format(value)} %`
    const packName = (pack: { nameEs: string; expansionId: string }) => `${pack.nameEs} (${pack.expansionId})`
    const reasons: Record<string, string> = {
      reprints: 'el tracker no cuenta reimpresiones de otra expansión',
      babies: 'el tracker excluye bebés del denominador en sets sin sobre de bebés',
    }
    return {
      model: result.model === 'corrected' ? 'corregido' : 'tracker',
      alpha: result.alpha,
      limitedBoost: result.limitedBoost,
      today: result.today,
      goals: {
        deckTarget: result.deckTarget === 'tournament' ? 'versión de torneo' : 'lista guardada',
        decks: result.goals.decks,
        collection: result.collection,
        ...(result.goals.decks.length === 0
          ? { note: 'Ningún mazo tiene prioridad de sobres: se marca en cada mazo (1 a 3).' }
          : {}),
      },
      packs: result.rows.slice(0, args.limit ?? 8).map((row) => ({
        pack: packName(row),
        available: row.available,
        probability: pct(row.probability),
        expectedWantedCards: twoDecimals(row.expected),
        score: twoDecimals(row.expectedValue),
        packsFor50: row.packsFor50,
        packsFor90: row.packsFor90,
        ...(row.limited
          ? {
              limited: lastDay(row.limited),
              onlyHere: {
                decks: row.limited.exclusive
                  .filter((item) => item.goal === 'decks')
                  .map((item) => `${item.nameEs} (${item.cardId})`),
                collectionVersions: row.limited.exclusive.filter((item) => item.goal === 'collection').length,
                examples: row.limited.exclusive
                  .filter((item) => item.goal === 'collection')
                  .slice(0, 12)
                  .map((item) => `${item.cardId} ${item.nameEs} ${item.rarity}${item.holo ? ' holo' : ''}`),
              },
            }
          : {}),
        ...(Math.abs(row.otherModel.probability - row.probability) >= 0.005
          ? {
              otherModel: `${row.otherModel.model === 'tracker' ? 'tracker' : 'corregido'}: ${pct(row.otherModel.probability)}${row.otherModel.reasons.length > 0 ? ` (${row.otherModel.reasons.map((reason) => reasons[reason] ?? reason).join('; ')})` : ''}`,
            }
          : {}),
      })),
      missingCards: result.missing.map((item) => ({
        nameEs: item.nameEs,
        missing: item.missing,
        decks: item.decks.map((deck) => `${deck.name} (prioridad ${deck.priority})`),
        cheapest: item.cheapest
          ? `${item.cheapest.cardId} ${item.cheapest.rarity}: ${item.cheapest.points} puntos${item.cheapest.verified ? '' : ' (sin verificar)'}, ${item.cheapest.tradeable ? 'intercambiable' : 'no intercambiable'}`
          : 'no se compra con puntos',
        tradeable: item.tradeable,
        bestPack: item.bestPack
          ? `${packName(item.bestPack)}: ${pct(item.bestPack.probability)} por sobre, ~${Math.round(item.bestPack.packsPerCopy)} sobres por copia${item.bestPack.limited ? ' (tiempo limitado)' : ''}`
          : 'no sale de ningún sobre a la venta',
        ...(item.bestPack?.limited
          ? {
              afterLimited: item.afterLimited
                ? `cuando termine: ${packName(item.afterLimited)}, ${pct(item.afterLimited.probability)} por sobre`
                : 'cuando termine no la da ningún sobre a la venta',
            }
          : {}),
        advice:
          item.advice === 'redeem' && item.redeem
            ? `canjearla con los puntos guardados de su expansión: ${item.redeem.cardId} ${item.redeem.rarity}, ${item.redeem.points} puntos (tenés ${item.redeem.saved}; alcanzan para ${item.redeem.copies} ${item.redeem.copies === 1 ? 'copia' : 'copias'})`
            : item.advice === 'buy'
              ? 'conviene comprarla con puntos'
              : item.advice === 'open'
                ? 'conviene abrir sobres'
                : item.advice === 'trade'
                  ? 'ningún sobre a la venta la da ni se compra con puntos que se puedan ganar: conseguirla por intercambio'
                  : null,
        ...(item.retiredCheapest
          ? {
              withSavedPoints: `si quedan puntos de su expansión: ${item.retiredCheapest.cardId} ${item.retiredCheapest.rarity}, ${item.retiredCheapest.points} puntos${item.retiredCheapest.verified ? '' : ' (sin verificar)'}`,
            }
          : {}),
      })),
      deckCompletion: result.decks.map((deck) => ({
        deck: deck.name,
        missingCopies: deck.missingCopies,
        notInPacks: deck.notInPacks,
        bestPacks: deck.bestPacks.map(
          (pack) =>
            `${packName(pack)}: cubre ${pack.covered} de ${deck.missingCopies} copias en ~${Math.round(pack.expectedPacks)} sobres${pack.method === 'simulation' ? ' (simulación)' : ''}${pack.limited ? ' (tiempo limitado)' : ''}`,
        ),
        ...(deck.plan
          ? {
              daysToComplete: `${deck.plan.days.p50} días (mediana; ${deck.plan.days.p80} con mala suerte) a ${result.planner.packsPerDay} sobres por día, ~${Math.round(deck.plan.packs.p50)} sobres`,
              plan: deck.plan.groups.map(
                (group) =>
                  `${packName(group)}: ${group.cards.join(', ')}${group.endsBeforeDone ? ' (el sobre deja de venderse antes)' : ''}`,
              ),
              ...(deck.plan.redeemable.length > 0 ? { redeemWithSavedPoints: deck.plan.redeemable } : {}),
            }
          : {}),
      })),
      ...(result.collectionOutOfPacks
        ? {
            collectionOutOfPacks: `${result.collectionOutOfPacks.versions} versiones buscadas no salen de ningún sobre a la venta; ${result.collectionOutOfPacks.tradeable} se pueden intercambiar`,
          }
        : {}),
      assumptions: result.assumptions,
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Tournaments (Fase 5)
  // ---------------------------------------------------------------------------------------------------------------

  private scopeJson(scope: ScopeView): Json {
    return {
      era: `${scope.era.code} (${scope.era.nameEs}), desde el ${scope.era.from}${scope.era.to ? ` hasta el ${scope.era.to}` : ''}`,
      format: scope.format,
      minPlayers: scope.minPlayers,
      tournaments: scope.tournaments,
      lists: scope.lists,
      eraMean: rateView(scope.mean.rate),
      ...(scope.conflicts.length > 0
        ? {
            warning: `${scope.conflicts.length} torneos traen cartas de un set posterior a su fecha o que la tabla de eras no conoce.`,
          }
        : {}),
      source: scope.attribution,
    }
  }

  private recordJson(row: RecordRowView): Json {
    return {
      lists: row.lists,
      record: row.record,
      share: `${percentFormat.format(row.share)} %`,
      rate: rateView(row.rate),
    }
  }

  private listJson(row: ListRowView): Json {
    return {
      key: row.key,
      archetype: row.archetype.name,
      ...this.recordJson(row),
      cards: row.cards.map((card) => `${card.count} ${card.nameEs} (${card.set}-${card.number})`),
    }
  }

  private againstJson(row: ListAgainstCollectionView): Json {
    return {
      ...this.listJson(row),
      ...(row.missing.length > 0
        ? { missing: row.missing.map((item) => `${item.nameEs}: tenés ${item.have} de ${item.need}`) }
        : {}),
    }
  }

  /** An archetype by Limitless id or by part of its name (case and accents folded). */
  private findArchetype(rows: readonly ArchetypeRowView[], query: string): ArchetypeRowView {
    const folded = foldText(query)
    const exact = rows.find((row) => row.archetype.id === query || foldText(row.archetype.name) === folded)
    const hit = exact ?? rows.find((row) => foldText(row.archetype.name).includes(folded))
    if (!hit) throw new NotFoundException(`No hay listas de un arquetipo «${query}» en esta era.`)
    return hit
  }

  private async tournamentsStats(args: {
    era?: string
    format?: TournamentFormat
    by?: 'archetype' | 'list'
    archetype?: string
    card?: string
    minCopies?: number
    limit?: number
  }): Promise<Json> {
    const scope = { era: args.era, format: args.format }
    const limit = args.limit ?? 15
    if (args.card && !args.archetype) {
      throw new BadRequestException({
        code: 'validation',
        message: '«card» va con «archetype»: con y sin esa carta dentro de un arquetipo.',
      })
    }
    if (args.archetype) {
      const all = await this.tournaments.archetypes(scope)
      const hit = this.findArchetype(all.rows, args.archetype)
      const card = args.card ? (this.resolveGroups(args.card).groups[0]?.id ?? undefined) : undefined
      const detail = await this.tournaments.archetype(hit.archetype.id ?? 'none', {
        ...scope,
        card,
        minCount: args.minCopies,
      })
      return {
        scope: this.scopeJson(detail.scope),
        archetype: {
          id: detail.archetype.archetype.id,
          name: detail.archetype.archetype.name,
          ...this.recordJson(detail.archetype),
        },
        topLists: detail.lists.slice(0, Math.min(limit, 10)).map((row) => this.listJson(row)),
        cards: detail.cards.slice(0, 30).map((usage) => ({
          card: usage.nameEs,
          lists: usage.lists,
          share: `${percentFormat.format(usage.share)} %`,
          oneCopy: usage.byCopies[1] ?? 0,
          twoCopies: usage.byCopies[2] ?? 0,
        })),
        ...(detail.withWithout
          ? {
              withWithout: {
                card: detail.withWithout.card.nameEs,
                minCopies: detail.withWithout.minCount,
                with: this.recordJson(detail.withWithout.with),
                without: this.recordJson(detail.withWithout.without),
                note: 'Dos filas con su propio n e intervalo; la diferencia no es un número aparte.',
              },
            }
          : {}),
      }
    }
    if (args.by === 'list') {
      const lists = await this.tournaments.lists({ ...scope, limit })
      return {
        scope: this.scopeJson(lists.scope),
        totalLists: lists.total,
        lists: lists.rows.map((row) => this.listJson(row)),
      }
    }
    const archetypes = await this.tournaments.archetypes(scope)
    return {
      scope: this.scopeJson(archetypes.scope),
      totalArchetypes: archetypes.rows.length,
      archetypes: archetypes.rows.slice(0, limit).map((row) => ({
        id: row.archetype.id,
        name: row.archetype.name,
        ...this.recordJson(row),
      })),
    }
  }

  private async matchesLuck(args: { deck: string; opponent?: string }): Promise<Json> {
    const deck = await this.resolveDeck(args.deck)
    const luck = await this.matches.luck(deck.id, args.opponent, undefined)
    return {
      deck: luck.deck,
      opponent: luck.opponent,
      record: luck.record,
      expected: luck.expected,
      verdict: luck.check?.verdict ?? null,
      text: luck.text,
    }
  }

  private async eventsCheck(args: { event?: string }): Promise<Json> {
    const events = await this.events.list()
    if (!args.event) {
      return {
        total: events.length,
        events: events.map((event) => ({ id: event.id, name: event.name, endsOn: event.endsOn, rules: event.rulesEs })),
      }
    }
    const wanted = foldText(args.event)
    const hit =
      events.find((event) => event.id === args.event || foldText(event.name) === wanted) ??
      events.find((event) => foldText(event.name).includes(wanted))
    if (!hit) throw new NotFoundException(`No hay un evento «${args.event}».`)
    const detail = await this.events.detail(hit.id)
    return {
      event: {
        id: detail.id,
        name: detail.name,
        startsOn: detail.startsOn,
        endsOn: detail.endsOn,
        rules: detail.rulesEs,
      },
      decksThatComply: detail.decks.filter((deck) => deck.ok).map((deck) => `#${deck.id} ${deck.name}`),
      decksThatDoNot: detail.decks
        .filter((deck) => !deck.ok)
        .slice(0, 15)
        .map((deck) => ({ deck: `#${deck.id} ${deck.name}`, problems: deck.problems.slice(0, 4) })),
      tournamentLists: detail.lists.slice(0, 10).map((list) => ({
        key: list.key,
        archetype: list.archetype,
        pokemon: list.pokemon,
        lists: list.lists,
        rate: rateView(list.rate),
        missingCopies: list.missingCopies,
      })),
    }
  }

  private async rivalsNotes(args: { opponent?: string }): Promise<Json> {
    const shape = (note: { label: string; text: string; updatedAt: Date }) => ({
      rival: note.label,
      text: note.text,
      updatedAt: note.updatedAt.toISOString(),
    })
    if (args.opponent) {
      const note = await this.rivalNotes.lookup(args.opponent)
      return note ? { note: shape(note) } : { note: null, message: `Santi no tiene notas contra «${args.opponent}».` }
    }
    const notes = await this.rivalNotes.list()
    return { total: notes.length, notes: notes.map(shape) }
  }

  private async decksPickToday(args: { sort?: 'tournament' | 'matches' | 'lab'; limit?: number }): Promise<Json> {
    const view = await this.pick.today(args.sort)
    const percent = (value: number) => `${percentFormat.format(value)} %`
    return {
      sortedBy: view.sort,
      meta: view.meta,
      decks: view.items.slice(0, args.limit ?? 10).map((row) => ({
        deck: `#${row.deck.id} ${row.deck.name}`,
        archetype: row.archetype?.name ?? null,
        myMatches: row.mine ? rateView(row.mine.rate) : null,
        tournamentAgainstToday: row.tournament
          ? `${percent(row.tournament.value)} (matchups con datos: ${percent(row.tournament.coverage)} del meta)`
          : null,
        lab: row.lab?.text ?? null,
      })),
      note: view.note,
    }
  }

  private async decksDrawOdds(args: {
    deck: string
    cards?: string[]
    alsoCards?: string[]
    turns?: number
  }): Promise<Json> {
    const deck = await this.resolveDeck(args.deck)
    const ids = (queries?: string[]) => queries?.map((query) => this.resolveGroups(query).groups[0]?.id ?? query)
    const odds = await this.decks.drawOdds(deck.id, {
      cards: ids(args.cards),
      cards2: ids(args.alsoCards),
      turns: args.turns,
    })
    const percent = (value: number) => `${percentFormat.format(value * 100)} %`
    const names = odds.groups.map((group) => group.cards.map((card) => card.nameEs).join(' o '))
    return {
      deck: odds.deck,
      deckSize: odds.deckSize,
      basicPokemon: odds.basics,
      cards: odds.groups.map((group, at) => ({ cards: names[at], copies: group.copies })),
      byTurn: odds.rows.map((row) => ({
        turn: row.turn === 0 ? 'mano inicial' : `turno propio ${row.turn}`,
        cardsSeen: row.cardsSeen,
        ...Object.fromEntries(row.each.map((value, at) => [names[at] ?? `carta ${at + 1}`, percent(value)])),
        ...(row.all === null ? {} : { both: percent(row.all) }),
      })),
      basicsInOpeningHand: odds.basicsInHand
        .filter((row) => row.probability > 0)
        .map((row) => `${row.count}: ${percent(row.probability)}`),
      note: odds.note,
    }
  }

  private async tournamentsTrends(args: {
    era?: string
    format?: TournamentFormat
    days?: number
    limit?: number
  }): Promise<Json> {
    const view = await this.tournaments.trends({ era: args.era, format: args.format, days: args.days })
    const limit = args.limit ?? 8
    const points = (value: number) => `${value >= 0 ? '+' : ''}${percentFormat.format(value)} pts`
    const share = (value: number) => `${percentFormat.format(value)} %`
    const row = (
      name: string,
      item: {
        now: { lists: number; share: number }
        before: { lists: number; share: number }
        delta: number
        clear: boolean
      },
    ) => ({
      name,
      now: `${share(item.now.share)} (${item.now.lists} listas)`,
      before: `${share(item.before.share)} (${item.before.lists} listas)`,
      change: points(item.delta),
      clear: item.clear,
    })
    const archetypes = view.archetypes.map((item) => ({ ...row(item.archetype.name, item), isNew: item.isNew }))
    const cards = view.cards.map((item) => row(item.nameEs, item))
    return {
      scope: this.scopeJson(view.scope),
      thisWeek: view.now,
      weekBefore: view.before,
      archetypesUp: archetypes.filter((_, at) => (view.archetypes[at]?.delta ?? 0) > 0).slice(0, limit),
      archetypesDown: archetypes
        .filter((_, at) => (view.archetypes[at]?.delta ?? 0) < 0)
        .reverse()
        .slice(0, limit),
      cardsUp: cards.filter((_, at) => (view.cards[at]?.delta ?? 0) > 0).slice(0, limit),
      cardsDown: cards
        .filter((_, at) => (view.cards[at]?.delta ?? 0) < 0)
        .reverse()
        .slice(0, limit),
      note: 'Cuota de listas de torneo; «clear» = cambio claro (prueba al 95 %). No mezcla porcentajes de victoria.',
    }
  }

  private async tournamentsMatchups(args: {
    era?: string
    format?: TournamentFormat
    archetype?: string
    top?: number
  }): Promise<Json> {
    const scope = { era: args.era, format: args.format }
    const percent = (value: number) => `${percentFormat.format(value)} %`
    const expectedJson = (expected: { value: number; coverage: number; matches: number; rivals: number } | null) =>
      expected
        ? {
            value: percent(expected.value),
            coversMeta: percent(expected.coverage),
            matches: expected.matches,
            rivals: expected.rivals,
          }
        : null
    if (args.archetype) {
      const all = await this.tournaments.archetypes(scope)
      const hit = this.findArchetype(all.rows, args.archetype)
      const detail = await this.tournaments.archetype(hit.archetype.id ?? 'none', scope)
      return {
        scope: this.scopeJson(detail.scope),
        archetype: { id: detail.archetype.archetype.id, name: detail.archetype.archetype.name },
        tournamentsWithPairings: detail.matchups.tournamentsWithPairings,
        expectedAgainstMeta: expectedJson(detail.matchups.expected),
        rivals: detail.matchups.rows.slice(0, 25).map((row) => ({
          rival: row.rival.name,
          rivalShare: percent(row.share),
          record: row.record,
          rate: rateView(row.rate),
        })),
        note: 'Partidas de torneo entre personas; cada fila con su n e intervalo. El espejo (mismo arquetipo) da 50 % por construcción.',
      }
    }
    const matrix = await this.tournaments.matchupMatrix({ ...scope, top: args.top ?? 10 })
    const name = new Map(matrix.archetypes.map((row) => [row.archetype.id, row.archetype.name]))
    return {
      scope: this.scopeJson(matrix.scope),
      coverage: matrix.coverage,
      archetypes: matrix.archetypes.map((row) => ({
        id: row.archetype.id,
        name: row.archetype.name,
        share: percent(row.share),
        againstEveryone: rateView(row.field.rate),
        expectedAgainstMeta: expectedJson(row.expected),
        matchups: matrix.cells
          .filter((cell) => cell.a === row.archetype.id && cell.b !== cell.a)
          .map((cell) => `vs ${name.get(cell.b) ?? cell.b}: ${formatWinRateEs(cell.rate)}`),
      })),
    }
  }

  private async tournamentsBuildable(args: { era?: string; format?: TournamentFormat; limit?: number }): Promise<Json> {
    const limit = args.limit ?? 10
    const view = await this.tournaments.buildable({ era: args.era, format: args.format, limit })
    // For the lists one or two copies away: what can take the place of each missing card (Fase 8).
    const near = await Promise.all(
      view.near.map(async (row) => {
        const detail = await this.tournaments.list(row.key, { era: args.era, format: args.format })
        return {
          ...this.againstJson(row),
          substitutes: detail.substitutes.map((item) => ({
            missing: item.nameEs,
            options: item.options.map(
              (option) => `${option.nameEs} (${option.cardId}): ${option.reasonEs}; tenés ${option.have}`,
            ),
          })),
        }
      }),
    )
    return {
      scope: this.scopeJson(view.scope),
      buildable: view.buildable.map((row) => this.againstJson(row)),
      nearlyBuildable: near,
    }
  }

  private async collectionPackLuck(): Promise<Json> {
    const view = await this.collection.packLuck()
    const verdict = {
      too_few: 'pocas cartas',
      normal: 'dentro de lo normal',
      unlucky: 'peor de lo normal',
      lucky: 'mejor de lo normal',
    }
    const shape = (item: NonNullable<typeof view.overall>) => ({
      from: item.from.appliedAt.slice(0, 10),
      to: item.to.appliedAt.slice(0, 10),
      gained: item.luck.gained,
      packsIfAllFromPacks: Math.round(item.luck.packsEstimate),
      byRarity: item.luck.byRarity,
      artRareOrBetter: {
        observed: item.luck.rare.observed,
        expected: Math.round(item.luck.rare.expected * 10) / 10,
        verdict: verdict[item.luck.rare.check.verdict],
      },
      ex: {
        observed: item.luck.ex.observed,
        expected: Math.round(item.luck.ex.expected * 10) / 10,
        verdict: verdict[item.luck.ex.check.verdict],
      },
    })
    return {
      imports: view.imports,
      ...(view.imports < 2 ? { note: 'Hace falta una segunda importación del CSV para comparar.' } : {}),
      latest: view.intervals[0] ? shape(view.intervals[0]) : null,
      overall: view.overall ? shape(view.overall) : null,
      caveat: 'Aproximado: cuenta todo lo que entró (también intercambios, Wonder Pick y premios); las promos no.',
    }
  }

  /** Fase 31: the trade list, the gives cut per rarity (the game shows few at a time anyway). */
  private async collectionTrades(args: { rarities?: Rarity[]; limit?: number }): Promise<Json> {
    const view = await this.trades.trades(args.rarities)
    const limit = args.limit ?? 15
    const rows = view.byRarity.filter((row) => view.rarities.includes(row.rarity))
    return {
      rarities: view.rarities,
      totals: view.totals,
      byRarity: rows.map((row) => ({
        rarity: row.rarity,
        wants: row.wants.map((want) => ({
          card: want.nameEs,
          missing: want.missing,
          decks: want.decks,
          ask: want.options.filter((option) => option.rarity === row.rarity).map((option) => option.cardId),
          otherPrints: want.options.filter((option) => option.rarity !== row.rarity),
        })),
        gives: row.gives.slice(0, limit).map((give) => ({ card: give.nameEs, cardId: give.cardId, spare: give.spare })),
        moreGives: Math.max(0, row.gives.length - limit),
      })),
      untradeable: view.untradeable.map((row) => ({ card: row.nameEs, missing: row.missing, decks: row.decks })),
      text: view.text,
    }
  }

  private async collectionMissions(args: { expansion?: string; incomplete?: boolean; limit?: number }): Promise<Json> {
    const view = await this.collection.missions({ expansion: args.expansion, incomplete: args.incomplete })
    return {
      total: view.total,
      complete: view.complete,
      missions: view.items.slice(0, args.limit ?? 20).map((item) => ({
        expansion: item.expansionId,
        name: item.name,
        reward: item.reward,
        secret: item.secret,
        complete: item.complete,
        missingCopies: item.missingCopies,
        slots: item.slots.map((slot) => ({
          card: slot.nameEs,
          need: slot.amount,
          have: slot.have,
          accepted: slot.options.map((option) => option.cardId),
        })),
      })),
    }
  }

  private async tournamentsUnlock(args: { era?: string; format?: TournamentFormat; limit?: number }): Promise<Json> {
    const view = await this.tournaments.unlock({ era: args.era, format: args.format, limit: args.limit ?? 10 })
    return {
      scope: this.scopeJson(view.scope),
      cards: view.cards.map((card) => ({
        card: card.nameEs,
        functionalGroupId: card.groupId,
        have: card.have,
        copiesToAdd: card.copies,
        listsUnlocked: card.lists,
        listsWithOneCopy: card.listsWithOneCopy,
        unlockedListsRecord: { lists: card.entries, record: card.record, rate: rateView(card.rate) },
        examples: card.unlocked.slice(0, 3).map((row) => `${row.archetype.name}: ${formatWinRateEs(row.rate)}`),
      })),
    }
  }

  private async matchesList(args: { deck?: string; opponent?: string; limit?: number }): Promise<Json> {
    const deck = args.deck ? await this.resolveDeck(args.deck) : null
    const page = await this.matches.list({
      deckId: deck?.id,
      opponent: args.opponent,
      limit: args.limit ?? 20,
      offset: 0,
    })
    return {
      total: page.total,
      matches: page.items.map((match) => ({
        id: match.id,
        playedAt: match.playedAt.toISOString(),
        deck: match.deck.name,
        deckRevision: match.deckRevision,
        result: MATCH_RESULT_LABEL_ES[match.result],
        opponent: match.opponent,
        wentFirst: match.wentFirst === null ? null : match.wentFirst ? 'empecé yo' : 'empezó el rival',
        mode: MATCH_MODE_LABEL_ES[match.mode],
        note: match.note || null,
      })),
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Simulations (Fase 6)
  // ---------------------------------------------------------------------------------------------------------------

  private async simulationsResults(args: { job?: number; deck?: string; limit?: number }): Promise<Json> {
    const limit = args.limit ?? 15
    const deck = args.deck ? await this.resolveDeck(args.deck) : null
    const note = 'Juegan bots del motor deckgym: el porcentaje depende del bot y del motor, no predice partidas reales.'
    if (args.job === undefined) {
      const jobs = await this.simulations.list(limit, null)
      const column = deck
        ? (await this.matches.comparison(deck.id, undefined)).columns.find((c) => c.source === 'simulation')
        : null
      return {
        note,
        ...(deck && column
          ? {
              deck: { id: deck.id, name: deck.name },
              simulation: { record: column.record, rate: rateView(column.rate), detail: column.note },
            }
          : {}),
        jobs: jobs.map((job) => jobSummaryJson(job)),
      }
    }
    const job = await this.simulations.detail(String(args.job))
    const byId = new Map(job.snapshots.map((snapshot) => [snapshot.id, snapshot]))
    const name = (id: number) => byId.get(id)?.label ?? `#${id}`
    const base: Json = { note, job: jobSummaryJson(job) }
    if (job.kind === 'optimize') {
      return {
        ...base,
        deck: job.sideA[0] !== undefined ? name(job.sideA[0]) : null,
        rivals: job.sideB.map(name),
        combinations: (job.optimize ?? []).slice(0, limit).map((row) => ({
          added: row.cards.map((card) => card.nameEs),
          record: row.record,
          rate: rateView(row.rate),
        })),
      }
    }
    const skipped = job.snapshots
      .filter((snapshot) => !snapshot.simulable)
      .map((snapshot) => ({ deck: snapshot.label, problems: snapshot.problems.map((problem) => problem.message) }))
    if (deck) {
      const own = job.rows.find((row) => byId.get(row.snapshot)?.deckId === deck.id)
      if (!own) throw new NotFoundException(`El mazo «${deck.name}» no está en la simulación #${job.id}.`)
      return {
        ...base,
        deck: name(own.snapshot),
        record: own.total,
        rate: rateView(own.rate),
        pairings: [...own.cells]
          .filter((cell) => cell.record !== null)
          .sort((a, b) => (b.rate?.value ?? -1) - (a.rate?.value ?? -1))
          .map((cell) => ({ rival: name(cell.rival), record: cell.record, rate: rateView(cell.rate) })),
      }
    }
    const ranking = [...job.rows]
      .filter((row) => row.rate !== null)
      .sort((a, b) => (b.rate?.value ?? 0) - (a.rate?.value ?? 0))
    return {
      ...base,
      decks: ranking.length,
      ranking: ranking.slice(0, limit).map((row, at) => ({
        position: at + 1,
        deck: name(row.snapshot),
        record: row.total,
        rate: rateView(row.rate),
      })),
      ...(skipped.length > 0 ? { skippedNotSimulable: skipped } : {}),
    }
  }
}

/** Editions grouped by tracker row (twins such as A1-1 and A4b-1 share one quantity). */
function stockUnits(detail: GroupDetail): { cardIds: string[]; rarity: string; owned: number }[] {
  const units = new Map<string, { cardIds: string[]; rarity: string; owned: number }>()
  for (const edition of detail.editions) {
    const key = edition.card.stockCardId
    const unit = units.get(key)
    if (unit) unit.cardIds.push(edition.card.id)
    else units.set(key, { cardIds: [edition.card.id], rarity: edition.card.rarity, owned: edition.owned })
  }
  return [...units.values()]
}
