/**
 * Write tools of the MCP server (PLAN §7 Fase 7, Apéndice D): decks, matches and simulations. Registered only for a
 * token with `mcp:write` (McpToolsService.buildServer). Every write goes through the same services as the PWA and is
 * tagged `mcp` where the data model keeps a source (deck revisions and changes, matches).
 */
import type { McpServer, StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import {
  type DeckCardEntry,
  foldText,
  formatWinRateEs,
  MATCH_MODE_LABEL_ES,
  MATCH_RESULT_LABEL_ES,
  MCP_WRITE_TOOLS,
  OPTIMIZE_CONFIRM_GAMES,
  type SelectableEnergy,
  type WinRate,
} from '@tcg/domain'
import { CatalogService } from '../catalog/catalog.service.js'
import { CollectionService } from '../collection/collection.service.js'
import type { DeckDetail } from '../decks/deck-views.js'
import { DecksService } from '../decks/decks.service.js'
import type { MatchView, RowView } from '../matches/match-views.js'
import { MatchesService } from '../matches/matches.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { RivalNotesService } from '../rivals/rival-notes.service.js'
import type { CreateJobInput } from '../simulation/simulations.service.js'
import { SimulationsService } from '../simulation/simulations.service.js'
import { EngineStatusService, type SnapshotSource } from '../simulation/snapshots.service.js'
import { TournamentsService } from '../tournaments/tournaments.service.js'
import { resolveCardRef } from './card-ref.js'
import { DeckRefResolver } from './deck-ref.js'
import { type AuditNote, type AuditUndo, McpAuditService } from './mcp-audit.service.js'
import { jobSummaryJson } from './mcp-json.js'
import type { WriteRun } from './mcp-run.js'

type Json = Record<string, unknown>

/** Fase 43: above this estimate, simulations_enqueue asks for confirmLong (R-010: a long job Claude cannot stop). */
const LONG_JOB_MINUTES = 30
/** The optimize job's own limit (SimulationsService refuses more combinations). */
const MAX_OPTIMIZE_COMBINATIONS = 200

interface ToolDefinition<S extends StandardSchemaWithJSON> {
  name: string
  title: string
  description: string
  input: S
}

/** Writes that add or change data: not read-only, not idempotent (logging twice logs two matches). */
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const
const DELETE = { ...WRITE, destructiveHint: true } as const

function config<S extends StandardSchemaWithJSON>(def: ToolDefinition<S>, annotations: typeof WRITE | typeof DELETE) {
  return { title: def.title, description: def.description, inputSchema: def.input, annotations }
}

function rateView(rate: WinRate | null): Json | null {
  return rate ? { text: formatWinRateEs(rate), value: Math.round(rate.value * 100) / 100, games: rate.games } : null
}

function recordView(row: RowView): Json {
  return { record: row.record, rate: rateView(row.rate) }
}

function matchView(match: MatchView): Json {
  return {
    id: match.id,
    deck: `${match.deck.name} (id ${match.deck.id})`,
    deckRevision: match.deckRevision,
    result: MATCH_RESULT_LABEL_ES[match.result],
    opponent: match.opponent,
    wentFirst: match.wentFirst === null ? null : match.wentFirst ? 'empecé yo' : 'empezó el rival',
    mode: MATCH_MODE_LABEL_ES[match.mode],
    note: match.note || null,
    playedAt: match.playedAt.toISOString(),
  }
}

function deckView(detail: DeckDetail): Json {
  return {
    id: detail.id,
    name: detail.name,
    revision: detail.revisionNumber,
    energies: detail.energies,
    cardCount: detail.cardCount,
    cards: detail.cards.map((entry) => `${entry.count} ${entry.card.nameEs} (${entry.card.id})`),
    valid: detail.validation.ok,
    errors: detail.validation.errors.map((issue) => issue.message),
    warnings: detail.validation.warnings.map((issue) => issue.message),
    complete: detail.completeness.complete,
    missing: detail.completeness.missing.map((item) => ({ nameEs: item.nameEs, need: item.need, have: item.have })),
    tags: detail.tags,
    packPriority: detail.packPriority ?? 0,
    builtInGame: detail.builtInGame,
    archived: detail.archivedAt !== null,
  }
}

@Injectable()
export class McpWriteToolsService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly decks: DecksService,
    private readonly matches: MatchesService,
    private readonly simulations: SimulationsService,
    private readonly tournaments: TournamentsService,
    private readonly deckRefs: DeckRefResolver,
    private readonly rivalNotes: RivalNotesService,
    private readonly collection: CollectionService,
    private readonly prisma: PrismaService,
    private readonly audit: McpAuditService,
    private readonly engineStatus: EngineStatusService,
  ) {}

  register(server: McpServer, run: WriteRun): void {
    const t = MCP_WRITE_TOOLS
    server.registerTool(t.decksCreate.name, config(t.decksCreate, WRITE), (args) =>
      run(t.decksCreate.name, args, () => this.decksCreate(args)),
    )
    server.registerTool(t.decksUpdate.name, config(t.decksUpdate, WRITE), (args) =>
      run(t.decksUpdate.name, args, () => this.decksUpdate(args)),
    )
    server.registerTool(t.matchesLog.name, config(t.matchesLog, WRITE), (args) =>
      run(t.matchesLog.name, args, () => this.matchesLog(args)),
    )
    server.registerTool(t.rivalsNoteSet.name, config(t.rivalsNoteSet, WRITE), (args) =>
      run(t.rivalsNoteSet.name, args, (note) => this.rivalsNoteSet(args, note)),
    )
    server.registerTool(t.matchesUpdate.name, config(t.matchesUpdate, WRITE), (args) =>
      run(t.matchesUpdate.name, args, () => this.matchesUpdate(args)),
    )
    server.registerTool(t.matchesDelete.name, config(t.matchesDelete, DELETE), (args) =>
      run(t.matchesDelete.name, args, (note) => this.matchesDelete(args.id, note)),
    )
    server.registerTool(t.matchesRestore.name, config(t.matchesRestore, WRITE), (args) =>
      run(t.matchesRestore.name, args, () => this.matchesRestore(args.id)),
    )
    server.registerTool(t.collectionSet.name, config(t.collectionSet, WRITE), (args) =>
      run(t.collectionSet.name, args, (note) => this.collectionSet(args, note)),
    )
    server.registerTool(t.simulationsEnqueue.name, config(t.simulationsEnqueue, WRITE), (args) =>
      run(t.simulationsEnqueue.name, args, () => this.simulationsEnqueue(args)),
    )
    server.registerTool(t.simulationsCancel.name, config(t.simulationsCancel, DELETE), (args) =>
      run(t.simulationsCancel.name, args, () => this.simulationsCancel(args)),
    )
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Decks
  // ---------------------------------------------------------------------------------------------------------------

  /** The first deck of a pasted text, or the parse errors to show. */
  private async parseText(
    text: string,
  ): Promise<{ cards: DeckCardEntry[]; energies: SelectableEnergy[]; title: string | null } | { errors: Json[] }> {
    const drafts = await this.decks.importPreview(text, 'auto')
    const first = drafts[0]
    if (!first) return { errors: [{ message: 'No encontré ningún mazo en el texto.' }] }
    if (!first.draft) {
      return {
        errors: first.errors.map((issue) => ({
          message: issue.message,
          ...(issue.line === undefined ? {} : { line: issue.line }),
          ...(issue.candidates ? { candidates: issue.candidates } : {}),
        })),
      }
    }
    return { cards: first.draft.cards, energies: first.draft.energies, title: first.title }
  }

  /** Validation of a list before saving it: null when it can be saved, the reason otherwise. */
  private async check(cards: DeckCardEntry[], energies: SelectableEnergy[]): Promise<Json | null> {
    const result = await this.decks.validate({ cards, energies })
    if (result.validation.ok) return null
    const index = this.catalog.requireIndex()
    return {
      valid: false,
      errors: result.validation.errors.map((issue) => issue.message),
      warnings: result.validation.warnings.map((issue) => issue.message),
      cards: cards.map(
        (entry) => `${entry.count} ${index.cardById(entry.cardId)?.nameEs ?? entry.cardId} (${entry.cardId})`,
      ),
      energies,
    }
  }

  private async decksCreate(args: {
    text?: string
    cards?: DeckCardEntry[]
    energies?: SelectableEnergy[]
    name?: string
    tags?: string[]
    notes?: string
    saveInvalid?: boolean
  }): Promise<Json> {
    let cards: DeckCardEntry[]
    let energies: SelectableEnergy[]
    let title: string | null = null
    if (args.text !== undefined && args.text.trim() !== '') {
      const parsed = await this.parseText(args.text)
      if ('errors' in parsed) return { saved: false, parseErrors: parsed.errors }
      cards = parsed.cards
      energies = args.energies ?? parsed.energies
      title = parsed.title
    } else if (args.cards !== undefined) {
      cards = args.cards
      energies = args.energies ?? []
    } else {
      throw new BadRequestException('Mandá la lista: `text` (pegada) o `cards` (con códigos).')
    }
    const problem = args.saveInvalid ? null : await this.check(cards, energies)
    if (problem) {
      return { saved: false, message: 'La lista no valida: no la guardé. Corregila o mandá saveInvalid.', ...problem }
    }
    const created = await this.decks.create(
      {
        name: args.name ?? title ?? 'Mazo nuevo',
        energies,
        cards,
        ...(args.tags ? { tags: args.tags } : {}),
        ...(args.notes !== undefined ? { notes: args.notes } : {}),
      },
      'mcp',
    )
    return { saved: true, deck: deckView(created) }
  }

  /** A Limitless archetype by id or (part of) its name, in the current era. */
  private async archetypeId(ref: string): Promise<string> {
    const { rows } = await this.tournaments.archetypes({})
    const key = foldText(ref)
    const exact = rows.find((row) => row.archetype.id === ref || foldText(row.archetype.name) === key)
    if (exact?.archetype.id) return exact.archetype.id
    const partial = rows.filter((row) => row.archetype.id !== null && foldText(row.archetype.name).includes(key))
    if (partial.length === 1 && partial[0]?.archetype.id) return partial[0].archetype.id
    if (partial.length > 1) {
      throw new BadRequestException(
        `«${ref}» coincide con varios arquetipos: ${partial
          .slice(0, 8)
          .map((row) => row.archetype.name)
          .join('; ')}. Indicá cuál.`,
      )
    }
    throw new NotFoundException(`No encontré el arquetipo «${ref}» en la era vigente.`)
  }

  private async decksUpdate(args: {
    deck: string
    text?: string
    cards?: DeckCardEntry[]
    energies?: SelectableEnergy[]
    name?: string
    tags?: string[]
    notes?: string
    revisionNote?: string
    packPriority?: number
    tournamentArchetype?: string | null
    builtInGame?: boolean
    archived?: boolean
    saveInvalid?: boolean
  }): Promise<Json> {
    const ref = await this.deckRefs.resolve(args.deck)
    let cards: DeckCardEntry[] | undefined
    let energies = args.energies
    if (args.text !== undefined && args.text.trim() !== '') {
      const parsed = await this.parseText(args.text)
      if ('errors' in parsed) return { saved: false, parseErrors: parsed.errors }
      cards = parsed.cards
      if (energies === undefined && parsed.energies.length > 0) energies = parsed.energies
    } else if (args.cards !== undefined) {
      cards = args.cards
    }
    if ((cards !== undefined || energies !== undefined) && !args.saveInvalid) {
      const current = await this.decks.detail(ref.id)
      const problem = await this.check(
        cards ?? current.cards.map((entry) => ({ cardId: entry.card.id, count: entry.count })),
        energies ?? current.energies,
      )
      if (problem) {
        return { saved: false, message: 'La lista nueva no valida: no cambié el mazo.', deck: ref.name, ...problem }
      }
    }
    const tournamentArchetypeId =
      args.tournamentArchetype === undefined
        ? undefined
        : args.tournamentArchetype === null
          ? null
          : await this.archetypeId(args.tournamentArchetype)
    const updated = await this.decks.patch(
      ref.id,
      {
        ...(cards !== undefined ? { cards } : {}),
        ...(energies !== undefined ? { energies } : {}),
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.tags !== undefined ? { tags: args.tags } : {}),
        ...(args.notes !== undefined ? { notes: args.notes } : {}),
        ...(args.revisionNote !== undefined ? { note: args.revisionNote } : {}),
        ...(args.packPriority !== undefined ? { packPriority: args.packPriority } : {}),
        ...(tournamentArchetypeId !== undefined ? { tournamentArchetypeId } : {}),
        ...(args.builtInGame !== undefined ? { builtInGame: args.builtInGame } : {}),
        ...(args.archived !== undefined ? { archived: args.archived } : {}),
      },
      'mcp',
    )
    return { saved: true, deck: deckView(updated) }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Matches
  // ---------------------------------------------------------------------------------------------------------------

  /** The text before the write stays in the log: replacing or deleting a note can be undone (Fase 43). */
  private async rivalsNoteSet(
    args: { opponent: string; text: string; append?: boolean },
    audit: AuditNote,
  ): Promise<Json> {
    // The note it replaced comes from the same locked read as the write.
    const { note, previous } = await this.rivalNotes.write({
      opponent: args.opponent,
      text: args.text,
      append: args.append ?? true,
    })
    const after = note?.text ?? null
    const key = note?.key ?? previous?.key
    // A new text, or the same one under another spelling of the rival: both can be undone.
    if (key && ((previous?.text ?? null) !== after || (note && previous && note.label !== previous.label))) {
      const opponent = note?.label ?? previous?.label ?? args.opponent
      audit.undo = {
        kind: 'rival_note',
        key,
        opponent,
        before: previous
          ? {
              label: previous.label,
              archetypeId: previous.archetypeId,
              text: previous.text,
              createdAt: previous.createdAt.toISOString(),
            }
          : null,
        after,
        ...(note ? { afterUpdatedAt: note.updatedAt.toISOString() } : {}),
        label: `Nota sobre «${opponent}»: ${after === null ? 'borrada' : previous === null ? 'nueva' : 'cambiada'}`,
      }
    }
    return note
      ? { saved: true, rival: note.label, text: note.text, updatedAt: note.updatedAt.toISOString() }
      : { saved: true, deleted: true, rival: args.opponent }
  }

  private async matchesLog(args: {
    deck: string
    result: 'win' | 'loss' | 'tie'
    opponent?: string
    wentFirst?: boolean
    mode?: 'competitive' | 'casual' | 'beginner' | 'event' | 'friend'
    note?: string
    playedAt?: string
  }): Promise<Json> {
    const deck = await this.deckRefs.resolve(args.deck)
    const match = await this.matches.create(
      {
        deckId: deck.id,
        result: args.result,
        opponent: args.opponent ?? null,
        wentFirst: args.wentFirst ?? null,
        ...(args.mode ? { mode: args.mode } : {}),
        ...(args.note !== undefined ? { note: args.note } : {}),
        ...(args.playedAt ? { playedAt: args.playedAt } : {}),
      },
      'mcp',
    )
    const stats = await this.matches.stats({ deckId: deck.id })
    return { logged: true, match: matchView(match), deckRecord: recordView(stats.overall) }
  }

  private async matchesUpdate(args: {
    id: string
    deck?: string
    result?: 'win' | 'loss' | 'tie'
    opponent?: string | null
    wentFirst?: boolean | null
    mode?: 'competitive' | 'casual' | 'beginner' | 'event' | 'friend'
    note?: string
    playedAt?: string
  }): Promise<Json> {
    const deckId = args.deck === undefined ? undefined : (await this.deckRefs.resolve(args.deck)).id
    const before = await this.matches.get(args.id)
    const after = await this.matches.patch(args.id, {
      ...(deckId !== undefined ? { deckId } : {}),
      ...(args.result !== undefined ? { result: args.result } : {}),
      ...(args.opponent !== undefined ? { opponent: args.opponent } : {}),
      ...(args.wentFirst !== undefined ? { wentFirst: args.wentFirst } : {}),
      ...(args.mode !== undefined ? { mode: args.mode } : {}),
      ...(args.note !== undefined ? { note: args.note } : {}),
      ...(args.playedAt !== undefined ? { playedAt: args.playedAt } : {}),
    })
    return { updated: true, before: matchView(before), match: matchView(after) }
  }

  /** Fase 43: the row is kept in the audit log, so matches_restore (or «Deshacer» in the app) brings it back. */
  private async matchesDelete(id: string, note: AuditNote): Promise<Json> {
    const match = await this.matches.get(id)
    const row = await this.prisma.match.findUnique({ where: { id: Number(match.id) } })
    if (!row) throw new NotFoundException(`Partida ${id} no encontrada.`)
    // The copy is in the log before the row goes: undoing never depends on what happens after the delete.
    const undo: AuditUndo = {
      kind: 'match_delete',
      match: {
        id: row.id,
        deckId: row.deckId,
        deckRevisionId: row.deckRevisionId,
        result: row.result,
        opponentText: row.opponentText,
        wentFirst: row.wentFirst,
        mode: row.mode,
        note: row.note,
        playedAt: row.playedAt.toISOString(),
        source: row.source,
        clientRef: row.clientRef,
        createdAt: row.createdAt.toISOString(),
      },
      label: `${MATCH_RESULT_LABEL_ES[match.result]} con ${match.deck.name}${match.opponent ? ` contra ${match.opponent}` : ''} (${match.playedAt.toISOString().slice(0, 10)})`,
    }
    await note.keep(undo)
    await this.prisma.$transaction(async (tx) => {
      // Only the version that was copied: if it changed in between, nothing is deleted.
      const deleted = await tx.match.deleteMany({ where: { id: row.id, updatedAt: row.updatedAt } })
      if (deleted.count === 0) {
        throw new ConflictException(`La partida ${id} cambió (o ya no está) mientras la borraba: no borré nada.`)
      }
      // That it was deleted goes in the log with the delete itself: a «Sin terminar» entry is undoable only with it.
      await note.keepIn(tx, { ...undo, deletedAt: new Date().toISOString() })
    })
    return {
      deleted: true,
      match: matchView(match),
      note: 'Quedó en el registro de Claude: matches_restore la devuelve.',
    }
  }

  private async matchesRestore(id: string): Promise<Json> {
    const undone = await this.audit.restoreMatch(Number(id))
    const restoredId = undone.restoredMatchId ?? Number(id)
    const match = await this.matches.get(String(restoredId))
    const stats = await this.matches.stats({ deckId: match.deck.id })
    return {
      restored: true,
      match: matchView(match),
      deckRecord: recordView(stats.overall),
      ...(restoredId !== Number(id)
        ? { note: `Su id ya lo usaba otra partida: volvió como la partida ${restoredId}.` }
        : {}),
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Collection (Fase 43)
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * «Saqué 2 Hoopa ex»: one edition's quantity, by code or by name. A name with several editions is only resolved
   * when it is unambiguous (one edition, or, to subtract, the only one owned); otherwise nothing changes and the
   * editions come back so Claude can ask.
   */
  private async collectionSet(
    args: { card: string; add?: number; amount?: number; collected?: boolean },
    note: AuditNote,
  ): Promise<Json> {
    if (args.add === undefined && args.amount === undefined && args.collected === undefined) {
      throw new BadRequestException('Indicá add (sumar o restar), amount (cantidad final) o collected.')
    }
    if (args.add !== undefined && args.amount !== undefined) {
      throw new BadRequestException('Mandá add o amount, no los dos.')
    }
    const index = this.catalog.requireIndex()
    const query = args.card.trim()
    const byCode = codeCandidates(query)
      .map((code) => index.cardById(code))
      .find((card) => card !== undefined)
    let cardId: string | null = byCode?.id ?? null
    if (!cardId) {
      const hits = index.searchGroups(query, { limit: 10 }).filter((hit) => hit.matchedOn !== 'text')
      const best = hits[0]
      if (!best) throw new NotFoundException(`No encontré ninguna carta «${query}» en el catálogo.`)
      const groups = hits.filter((hit) => hit.score === best.score).map((hit) => hit.group)
      const stock = await this.prisma.collectionStock.findMany({
        where: {
          cardId: { in: groups.flatMap((group) => index.cardsOfGroup(group.id).map((card) => card.stockCardId)) },
        },
      })
      const owned = new Map(stock.map((row) => [row.cardId, row.amountOwned]))
      const editions = groups.flatMap((group) => index.cardsOfGroup(group.id))
      const units = [...new Map(editions.map((card) => [card.stockCardId, card])).values()]
      const ownedUnits = units.filter((card) => (owned.get(card.stockCardId) ?? 0) > 0)
      const pick = units.length === 1 ? units[0] : (args.add ?? 0) < 0 && ownedUnits.length === 1 ? ownedUnits[0] : null
      if (!pick) {
        return {
          changed: false,
          message: `«${query}» tiene varias ediciones: preguntale a Santi cuál y mandá su código.`,
          editions: units.map((card) => ({
            cardId: card.id,
            nameEs: card.nameEs,
            rarity: card.rarity,
            expansion: card.expansionId,
            owned: owned.get(card.stockCardId) ?? 0,
          })),
        }
      }
      cardId = pick.id
    }
    const current = await this.prisma.collectionStock.findUnique({
      where: { cardId: index.cardById(cardId)?.stockCardId ?? cardId },
    })
    const before = current?.amountOwned ?? 0
    const amountOwned = args.amount ?? (args.add !== undefined ? before + args.add : undefined)
    if (amountOwned !== undefined && amountOwned < 0) {
      return { changed: false, message: `Hay ${before} de ${cardId}: no se pueden restar ${-(args.add ?? 0)}.` }
    }
    const result = await this.collection.patchStock(cardId, {
      ...(amountOwned !== undefined ? { amountOwned } : {}),
      ...(args.collected !== undefined ? { collected: args.collected } : {}),
    })
    const card = index.cardById(cardId)
    const [group, written] = await Promise.all([
      card ? this.catalog.groupDetail(card.functionalGroupId) : null,
      this.prisma.collectionStock.findUnique({ where: { cardId: result.stockCardId }, select: { updatedAt: true } }),
    ])
    note.undo = {
      kind: 'collection_stock',
      cardId: result.stockCardId,
      before: result.before,
      after: result.after,
      ...(written ? { afterUpdatedAt: written.updatedAt.toISOString() } : {}),
      // Only when the row read before is the one this write replaced: an edit landing in between breaks the chain.
      ...(current === null
        ? { beforeUpdatedAt: null }
        : current.amountOwned === result.before?.amountOwned && current.collected === result.before?.collected
          ? { beforeUpdatedAt: current.updatedAt.toISOString() }
          : {}),
      label: `${card?.nameEs ?? cardId} (${cardId}): de ${result.before?.amountOwned ?? 0} a ${result.after.amountOwned}`,
    }
    return {
      changed: true,
      card: { cardId, nameEs: card?.nameEs ?? null, rarity: card?.rarity ?? null },
      ...(result.affectedTwinIds.length > 0 ? { sameRowAs: result.affectedTwinIds } : {}),
      before: result.before,
      after: result.after,
      playableCopies: group?.playable ?? null,
      ...(result.activeAdjustment
        ? {
            warning: `Hay un ajuste manual activo para esta carta (${result.activeAdjustment.playableCopies} copias jugables): manda sobre la suma hasta que se resuelva en Colección → Ajustes.`,
          }
        : {}),
      note: 'Si después se importa un CSV del tracker que no tiene este cambio, el CSV lo pisa.',
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Simulations
  // ---------------------------------------------------------------------------------------------------------------

  /** A card of the catalog by code («B4-103») or Spanish/English name; the deck's own edition when it plays one. */
  private resolveCard(query: string, preferred: readonly string[] = []): string {
    return resolveCardRef(this.catalog.requireIndex(), query, preferred)
  }

  private async simulationsEnqueue(args: {
    kind: 'compare' | 'matrix' | 'optimize'
    decksA?: string[]
    listsA?: { key: string; era?: string; format?: 'STANDARD' | 'NOEX'; energies?: SelectableEnergy[] }[]
    decksB?: string[]
    listsB?: { key: string; era?: string; format?: 'STANDARD' | 'NOEX'; energies?: SelectableEnergy[] }[]
    games?: number
    bots?: [string, string]
    seed?: number
    replaySample?: number
    bothOrders?: boolean
    label?: string
    skipNotSimulable?: boolean
    cache?: boolean
    remove?: { card: string; count: number }[]
    candidates?: string[]
    dryRun?: boolean
    confirmLong?: boolean
  }): Promise<Json> {
    const side = async (
      decks: readonly string[] | undefined,
      lists: NonNullable<typeof args.listsA> | undefined,
    ): Promise<SnapshotSource[]> => [
      ...(await Promise.all((decks ?? []).map(async (ref) => ({ deckId: (await this.deckRefs.resolve(ref)).id })))),
      ...(lists ?? []).map((list) => ({
        listKey: list.key,
        ...(list.era ? { era: list.era } : {}),
        ...(list.format ? { format: list.format } : {}),
        kind: 'group' as const,
        ...(list.energies ? { energies: list.energies } : {}),
      })),
    ]
    const sideA = await side(args.decksA, args.listsA)
    const sideB = await side(args.decksB, args.listsB)
    if (sideA.length === 0) throw new BadRequestException('Indicá al menos un mazo del lado A (decksA o listsA).')
    let optimize: CreateJobInput['optimize']
    if (args.kind === 'optimize') {
      const deck = sideA[0]
      if (sideA.length !== 1 || !deck || !('deckId' in deck)) {
        throw new BadRequestException('Optimizar va con un solo mazo mío en decksA.')
      }
      const detail = await this.decks.detail(deck.deckId)
      const own = detail.cards.map((entry) => entry.card.id)
      optimize = {
        remove: (args.remove ?? []).map((item) => ({ cardId: this.resolveCard(item.card, own), count: item.count })),
        candidates: (args.candidates ?? []).map((card) => this.resolveCard(card)),
      }
      // Checked here too, so a dry run or a «too long» answer never shows a plan that creating would refuse.
      const copies = new Map<string, number>()
      for (const entry of detail.cards) copies.set(entry.card.id, (copies.get(entry.card.id) ?? 0) + entry.count)
      const asked = new Map<string, number>()
      for (const item of optimize.remove) asked.set(item.cardId, (asked.get(item.cardId) ?? 0) + item.count)
      for (const [cardId, count] of asked) {
        const have = copies.get(cardId) ?? 0
        if (have < count) {
          const nameEs = this.catalog.requireIndex().cardById(cardId)?.nameEs ?? cardId
          throw new BadRequestException(
            `El mazo ${detail.name} lleva ${have} ${nameEs} (${cardId}): no se pueden sacar ${count}.`,
          )
        }
      }
      if (asked.size === 0) throw new BadRequestException('Optimizar necesita al menos una carta para sacar (remove).')
      if (optimize.candidates.length === 0) {
        throw new BadRequestException('Optimizar necesita cartas candidatas (candidates).')
      }
      // The same limits creating the job applies, so a dry run never shows a plan that would be refused.
      const status = await this.engineStatus.status()
      const index = this.catalog.requireIndex()
      for (const cardId of optimize.candidates) {
        const card = index.cardById(cardId)
        const playable =
          card !== undefined &&
          (status(card.engineId) === true ||
            index.cardsOfGroup(card.functionalGroupId).some((other) => status(other.engineId) === true))
        if (!playable) {
          throw new BadRequestException(`${card?.nameEs ?? cardId} (${cardId}) no está implementada en el motor.`)
        }
      }
      const combinations = multisetCount(
        optimize.candidates.length,
        [...asked.values()].reduce((a, b) => a + b, 0),
      )
      if (combinations > MAX_OPTIMIZE_COMBINATIONS) {
        throw new BadRequestException(
          `${combinations} combinaciones posibles superan el límite de ${MAX_OPTIMIZE_COMBINATIONS}: elegí menos candidatas o sacá menos cartas.`,
        )
      }
    }
    const engine = await this.simulations.engineView()
    const online = engine.workers.filter((worker) => worker.online)
    const input: CreateJobInput = {
      kind: args.kind,
      ...(args.label ? { label: args.label } : {}),
      sideA,
      sideB,
      gamesPerPair: args.games ?? 200,
      players: args.bots ?? ['e2', 'e2'],
      ...(args.seed !== undefined ? { seed: args.seed } : {}),
      ...(args.bothOrders !== undefined ? { bothOrders: args.bothOrders } : {}),
      ...(args.replaySample !== undefined ? { replaySample: args.replaySample } : {}),
      ...(args.skipNotSimulable ? { skipNotSimulable: true } : {}),
      // Phase 42: false plays it all again, even what the exact cache has.
      ...(args.cache === false ? { cache: false } : {}),
      ...(optimize ? { optimize } : {}),
    }
    const preview = await this.simulations.preview({ ...input, cores: online[0]?.cores ?? 8 })
    const notSimulable = [...preview.sideA, ...preview.sideB]
      .filter((snapshot) => !snapshot.simulable)
      .map((snapshot) => ({ deck: snapshot.label, reasons: snapshot.problems.map((problem) => problem.message) }))
    if (notSimulable.length > 0 && !args.skipNotSimulable) {
      return {
        queued: false,
        message: 'Hay mazos que no se pueden simular: no encolé nada. Corregilos o mandá skipNotSimulable.',
        notSimulable,
      }
    }
    // An optimize plays every combination against every rival, and then its confirmation (H-011.5): the preview
    // counts both.
    const totalGames = preview.totalGames
    const minutes = Math.max(1, Math.round(preview.estimatedSeconds / 60))
    const plan = {
      kind: args.kind,
      pairings: preview.pairings,
      totalGames,
      ...(optimize
        ? {
            confirmationGames: preview.confirmationGames,
            confirmation: `Incluye la confirmación: al terminar, las 3 mejores combinaciones (hasta 5 si hay empate en el tercer puesto) se juegan otra vez contra los mismos rivales con semillas nuevas y al menos ${OPTIMIZE_CONFIRM_GAMES} partidas por rival (${preview.confirmationGames} partidas).`,
          }
        : {}),
      gamesPerPairing: input.gamesPerPair,
      bots: input.players,
      estimatedMinutes: minutes,
      estimate: `~${minutes < 90 ? `${minutes} min` : `${Math.round((minutes / 60) * 10) / 10} h`} con ${online[0]?.cores ?? 8} núcleos${online.length === 0 ? ' (ningún worker en línea)' : ''}`,
      notSimulable,
      workerOnline: online.length > 0,
    }
    if (args.dryRun) return { queued: false, dryRun: true, plan }
    if (minutes > LONG_JOB_MINUTES && !args.confirmLong) {
      return {
        queued: false,
        message: `La estimación es de ${plan.estimate}: más de ${LONG_JOB_MINUTES} minutos. Contale a Santi cuánto tarda y, si está de acuerdo, repetí con confirmLong: true (o bajá games).`,
        plan,
      }
    }
    const job = await this.simulations.create(input)
    return {
      queued: true,
      jobId: job.id,
      label: job.label,
      kind: job.kind,
      bots: job.playersEs,
      gamesPerPairing: job.gamesPerPair,
      seed: job.baseSeed,
      engineRev: job.engineRev.slice(0, 7),
      pairings: job.progress.chunks.total,
      totalGames: job.progress.totalGames,
      estimatedMinutes: minutes,
      notSimulable,
      workerOnline: online.length > 0,
      note:
        online.length > 0
          ? 'En cola: el worker de la PC la empieza en su próximo chunk libre (los trabajos chicos pasan primero). Leé los resultados con simulations_results.'
          : 'En cola, pero ningún worker está en línea: empieza cuando Santi prenda la PC.',
    }
  }
  /** Fase 43: stop a job Claude (or Santi) queued; optionally archive it. */
  private async simulationsCancel(args: { job: number; archive?: boolean }): Promise<Json> {
    const before = await this.simulations.progressOf(String(args.job))
    const wasActive = before.status === 'queued' || before.status === 'running'
    let job = wasActive ? await this.simulations.cancel(String(args.job)) : before
    if (args.archive) job = await this.simulations.archive(String(args.job), true)
    return {
      cancelled: wasActive,
      archived: job.archived,
      job: jobSummaryJson(job),
      message: wasActive
        ? 'Cancelada: los cruces sin terminar no se juegan; lo ya jugado queda en sus resultados.'
        : `No estaba en cola ni corriendo (${job.status}): no había nada que cancelar.`,
    }
  }
}

/** «b4 103», «a4b-1», «A4b-1»: the ways a code may be typed, as the catalog writes it (A4b keeps its lowercase b). */
export function codeCandidates(query: string): string[] {
  const trimmed = query.trim()
  const match = /^([a-z]+\d*)([a-z]?)[-\s]+(\d+)$/i.exec(trimmed)
  if (!match) return [trimmed]
  const [, set = '', suffix = '', number = ''] = match
  return [
    trimmed,
    `${set.toUpperCase()}${suffix.toLowerCase()}-${number}`,
    `${set.toUpperCase()}${suffix.toUpperCase()}-${number}`,
  ]
}

/** Multisets of size k from n candidates: C(n + k − 1, k) (the optimize job's combinations). */
function multisetCount(n: number, k: number): number {
  let result = 1
  for (let i = 1; i <= k; i++) result = (result * (n + i - 1)) / i
  return Math.round(result)
}
