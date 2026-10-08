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
  type WinRate,
} from '@tcg/domain'
import { PinoLogger } from 'nestjs-pino'
import { CatalogService } from '../catalog/catalog.service.js'
import type { GroupDetail } from '../catalog/catalog-views.js'
import { CollectionService } from '../collection/collection.service.js'
import { ENV, type Env } from '../config/env.js'
import type { DeckImportFormat } from '../decks/deck-formats.js'
import { DecksService } from '../decks/decks.service.js'
import type { RowView } from '../matches/match-views.js'
import { MatchesService } from '../matches/matches.service.js'
import { PacksService } from '../packs/packs.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { JobSummaryView } from '../simulation/simulation-views.js'
import { SimulationsService } from '../simulation/simulations.service.js'
import type {
  ArchetypeRowView,
  ListAgainstCollectionView,
  ListRowView,
  RecordRowView,
  ScopeView,
} from '../tournaments/tournament-views.js'
import { TournamentsService } from '../tournaments/tournaments.service.js'
import { type DeckRef, DeckRefResolver } from './deck-ref.js'
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

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** A rate as the tools return it: rounded numbers plus the canonical Spanish text. */
function rateView(rate: WinRate | null): Json | null {
  if (!rate) return null
  return {
    text: formatWinRateEs(rate),
    value: round(rate.value),
    games: rate.games,
    ci95: [round(rate.ci95[0]), round(rate.ci95[1])],
    orientative: rate.orientative,
    source: rate.source,
  }
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
    private readonly writeTools: McpWriteToolsService,
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
    server.registerTool(t.tournamentsBuildable.name, config(t.tournamentsBuildable), (args) =>
      run(t.tournamentsBuildable.name, () => this.tournamentsBuildable(args)),
    )
    server.registerTool(t.tournamentsUnlockCards.name, config(t.tournamentsUnlockCards), (args) =>
      run(t.tournamentsUnlockCards.name, () => this.tournamentsUnlock(args)),
    )
    server.registerTool(t.simulationsResults.name, config(t.simulationsResults), (args) =>
      run(t.simulationsResults.name, () => this.simulationsResults(args)),
    )
    if (canWrite) this.writeTools.register(server, run)
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
          item.advice === 'buy'
            ? 'conviene comprarla con puntos'
            : item.advice === 'open'
              ? 'conviene abrir sobres'
              : item.advice === 'trade'
                ? 'ningún sobre a la venta la da ni se compra con puntos que se puedan ganar: conseguirla por intercambio'
                : null,
      })),
      deckCompletion: result.decks.map((deck) => ({
        deck: deck.name,
        missingCopies: deck.missingCopies,
        notInPacks: deck.notInPacks,
        bestPacks: deck.bestPacks.map(
          (pack) =>
            `${packName(pack)}: cubre ${pack.covered} de ${deck.missingCopies} copias en ~${Math.round(pack.expectedPacks)} sobres${pack.method === 'simulation' ? ' (simulación)' : ''}${pack.limited ? ' (tiempo limitado)' : ''}`,
        ),
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

  private async tournamentsBuildable(args: { era?: string; format?: TournamentFormat; limit?: number }): Promise<Json> {
    const limit = args.limit ?? 10
    const view = await this.tournaments.buildable({ era: args.era, format: args.format, limit })
    return {
      scope: this.scopeJson(view.scope),
      buildable: view.buildable.map((row) => this.againstJson(row)),
      nearlyBuildable: view.near.map((row) => this.againstJson(row)),
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
      const jobs = await this.simulations.list(limit)
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

/** A job as the tools return it: what was played, with which bots, n, seed and engine, and how far it got. */
function jobSummaryJson(job: JobSummaryView): Json {
  return {
    id: job.id,
    label: job.label,
    kind: { matrix: 'matriz', compare: 'comparar', optimize: 'optimizar' }[job.kind],
    status: { queued: 'en cola', running: 'corriendo', done: 'terminada', failed: 'falló', cancelled: 'cancelada' }[
      job.status
    ],
    bots: job.playersEs,
    gamesPerPairing: job.gamesPerPair,
    seed: job.baseSeed,
    engineRev: job.engineRev.slice(0, 7),
    progress: {
      games: job.progress.gamesDone,
      totalGames: job.progress.totalGames,
      pairingsDone: job.progress.chunks.done,
      pairings: job.progress.chunks.total,
      failed: job.progress.chunks.failed,
    },
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  }
}
