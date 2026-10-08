/**
 * Write tools of the MCP server (PLAN §7 Fase 7, Apéndice D): decks, matches and simulations. Registered only for a
 * token with `mcp:write` (McpToolsService.buildServer). Every write goes through the same services as the PWA and is
 * tagged `mcp` where the data model keeps a source (deck revisions and changes, matches).
 */
import type { CallToolResult, McpServer, StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  type DeckCardEntry,
  foldText,
  formatWinRateEs,
  MATCH_MODE_LABEL_ES,
  MATCH_RESULT_LABEL_ES,
  MCP_WRITE_TOOLS,
  type SelectableEnergy,
  type WinRate,
} from '@tcg/domain'
import { CatalogService } from '../catalog/catalog.service.js'
import type { DeckDetail } from '../decks/deck-views.js'
import { DecksService } from '../decks/decks.service.js'
import type { MatchView, RowView } from '../matches/match-views.js'
import { MatchesService } from '../matches/matches.service.js'
import type { CreateJobInput } from '../simulation/simulations.service.js'
import { SimulationsService } from '../simulation/simulations.service.js'
import type { SnapshotSource } from '../simulation/snapshots.service.js'
import { TournamentsService } from '../tournaments/tournaments.service.js'
import { resolveCardRef } from './card-ref.js'
import { DeckRefResolver } from './deck-ref.js'

type Json = Record<string, unknown>
type Run = (name: string, work: () => Promise<Json>) => Promise<CallToolResult>

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
  ) {}

  register(server: McpServer, run: Run): void {
    const t = MCP_WRITE_TOOLS
    server.registerTool(t.decksCreate.name, config(t.decksCreate, WRITE), (args) =>
      run(t.decksCreate.name, () => this.decksCreate(args)),
    )
    server.registerTool(t.decksUpdate.name, config(t.decksUpdate, WRITE), (args) =>
      run(t.decksUpdate.name, () => this.decksUpdate(args)),
    )
    server.registerTool(t.matchesLog.name, config(t.matchesLog, WRITE), (args) =>
      run(t.matchesLog.name, () => this.matchesLog(args)),
    )
    server.registerTool(t.matchesUpdate.name, config(t.matchesUpdate, WRITE), (args) =>
      run(t.matchesUpdate.name, () => this.matchesUpdate(args)),
    )
    server.registerTool(t.matchesDelete.name, config(t.matchesDelete, DELETE), (args) =>
      run(t.matchesDelete.name, () => this.matchesDelete(args.id)),
    )
    server.registerTool(t.simulationsEnqueue.name, config(t.simulationsEnqueue, WRITE), (args) =>
      run(t.simulationsEnqueue.name, () => this.simulationsEnqueue(args)),
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

  private async matchesDelete(id: string): Promise<Json> {
    const match = await this.matches.get(id)
    await this.matches.delete(id)
    return { deleted: true, match: matchView(match) }
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
    remove?: { card: string; count: number }[]
    candidates?: string[]
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
      estimatedMinutes: args.kind === 'optimize' ? null : Math.max(1, Math.round(preview.estimatedSeconds / 60)),
      notSimulable,
      workerOnline: online.length > 0,
      note:
        online.length > 0
          ? 'En cola: el worker de la PC la empieza en su próximo chunk libre (los trabajos chicos pasan primero). Leé los resultados con simulations_results.'
          : 'En cola, pero ningún worker está en línea: empieza cuando Santi prenda la PC.',
    }
  }
}
