/**
 * Laboratorio de mazos tools of the MCP server (T-008): the meta bank and results for every token; tests against the
 * meta and automatic searches only for a token with `mcp:write` (they queue work on Santi's PC). Every number comes
 * from bots: the tools say so next to it.
 */
import type { CallToolResult, McpServer, StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  estimateSeconds,
  exploreConfig,
  exploreGames,
  foldText,
  MCP_READ_TOOLS,
  MCP_WRITE_TOOLS,
  type SelectableEnergy,
} from '@tcg/domain'
import { CatalogService } from '../catalog/catalog.service.js'
import { DecksService } from '../decks/decks.service.js'
import { EventsService } from '../events/events.service.js'
import { LAB_NOTE, type LabDeckInput, LabService } from '../lab/lab.service.js'
import type { CardLineView, LabDeckView } from '../lab/lab-views.js'
import { SimulationsService } from '../simulation/simulations.service.js'
import { LIMITLESS_ATTRIBUTION } from '../tournaments/tournaments.service.js'
import { resolveCardRef } from './card-ref.js'
import { DeckRefResolver } from './deck-ref.js'
import { jobSummaryJson, rateView } from './mcp-json.js'
import type { WriteRun } from './mcp-run.js'

type Json = Record<string, unknown>
type Run = (name: string, work: () => Promise<Json>) => Promise<CallToolResult>

interface ToolDefinition<S extends StandardSchemaWithJSON> {
  name: string
  title: string
  description: string
  input: S
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const

function config<S extends StandardSchemaWithJSON>(
  def: ToolDefinition<S>,
  annotations: typeof READ_ONLY | typeof WRITE,
) {
  return { title: def.title, description: def.description, inputSchema: def.input, annotations }
}

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits
const cardLine = (card: CardLineView) => `${card.count} ${card.nameEs} (${card.cardId})`

const ROLE_ES: Record<LabDeckView['role'], string> = {
  base: 'lista de partida',
  best: 'mejor encontrada',
  variant: 'variante probada',
  deck: 'mazo probado',
}

interface TournamentListArg {
  key: string
  era?: string
  format?: 'STANDARD' | 'NOEX'
  energies?: SelectableEnergy[]
}

@Injectable()
export class McpLabToolsService {
  constructor(
    private readonly lab: LabService,
    private readonly catalog: CatalogService,
    private readonly decks: DecksService,
    private readonly simulations: SimulationsService,
    private readonly deckRefs: DeckRefResolver,
    private readonly events: EventsService,
  ) {}

  registerRead(server: McpServer, run: Run): void {
    const t = MCP_READ_TOOLS
    server.registerTool(t.labMetaBank.name, config(t.labMetaBank, READ_ONLY), (args) =>
      run(t.labMetaBank.name, () => this.metaBank(args)),
    )
    server.registerTool(t.labResults.name, config(t.labResults, READ_ONLY), (args) =>
      run(t.labResults.name, () => this.results(args)),
    )
    server.registerTool(t.labBuildFromCore.name, config(t.labBuildFromCore, READ_ONLY), (args) =>
      run(t.labBuildFromCore.name, () => this.buildFromCore(args)),
    )
  }

  registerWrite(server: McpServer, run: WriteRun): void {
    const t = MCP_WRITE_TOOLS
    server.registerTool(t.labTest.name, config(t.labTest, WRITE), (args) =>
      run(t.labTest.name, args, () => this.test(args)),
    )
    server.registerTool(t.labExplore.name, config(t.labExplore, WRITE), (args) =>
      run(t.labExplore.name, args, () => this.explore(args)),
    )
  }

  private async metaBank(args: { era?: string; format?: 'STANDARD' | 'NOEX'; size?: number }): Promise<Json> {
    const bank = await this.lab.bank(args)
    return {
      era: bank.era,
      format: bank.format,
      lists: bank.lists,
      coverage: `${round(bank.coverage)} % de las listas de la era`,
      rivals: bank.rivals.map((rival) => ({
        archetype: rival.archetypeName,
        share: round(rival.share, 2),
        weight: round(rival.weight, 3),
        listKey: rival.listKey,
        listPlayed: rival.listLists,
        listRate: rateView(rival.listRate),
        replacement: rival.rank > 0,
        energies: rival.energies,
        cards: rival.cards.map(cardLine),
      })),
      skipped: bank.skipped.map((skip) => ({
        archetype: skip.archetypeName,
        share: round(skip.share, 2),
        reason: skip.reason,
      })),
      note: LIMITLESS_ATTRIBUTION,
    }
  }

  private async buildFromCore(args: {
    cards: string[]
    energies?: SelectableEnergy[]
    pool?: 'collection' | 'all'
    era?: string
    format?: 'STANDARD' | 'NOEX'
    event?: string
  }): Promise<Json> {
    const index = this.catalog.requireIndex()
    const cards = args.cards.map((query) => resolveCardRef(index, query))
    let eventId: string | undefined
    if (args.event) {
      const events = await this.events.list()
      const wanted = foldText(args.event)
      const hit =
        events.find((event) => event.id === args.event || foldText(event.name) === wanted) ??
        events.find((event) => foldText(event.name).includes(wanted))
      if (!hit) throw new NotFoundException(`No hay un evento «${args.event}».`)
      eventId = hit.id
    }
    const view = await this.lab.core({ ...args, cards, eventId })
    const REASON_ES = { core: 'núcleo', line: 'línea evolutiva', usage: 'la juegan' } as const
    return {
      era: view.era,
      format: view.format,
      pool: view.pool === 'collection' ? 'solo la colección' : 'cualquier carta',
      event: view.event?.name ?? null,
      basis: view.basis.text,
      energies: view.energies,
      total: view.total,
      valid: view.problems.length === 0,
      problems: view.problems,
      cards: view.cards.map((card) => ({
        line: cardLine(card),
        why:
          card.reason === 'usage' && card.share !== null
            ? `la juegan el ${round(card.share)} % de esas listas`
            : REASON_ES[card.reason],
      })),
      left: view.left.map((item) => `${item.nameEs} (${item.cardId}): ${item.reason}`),
      note: `Punto de partida armado con listas de torneo, no un mazo probado: probalo con lab_test o mejoralo con lab_explore. ${view.attribution}`,
    }
  }

  private async results(args: { job?: number; limit?: number }): Promise<Json> {
    if (args.job === undefined) {
      const jobs = await this.lab.jobs(15)
      return {
        note: LAB_NOTE,
        jobs: jobs.items.map((job) => ({
          ...jobSummaryJson(job),
          mode: job.mode === 'test' ? 'prueba contra el meta' : 'búsqueda automática',
          era: job.era,
        })),
      }
    }
    const view = await this.lab.job(String(args.job))
    const rivalName = new Map(view.rivals.map((rival) => [rival.snapshot, rival.archetypeName]))
    const labelOf = new Map(view.decks.map((deck) => [deck.snapshot, deck.label]))
    const explore = view.explore
    return {
      note: view.note,
      job: jobSummaryJson(view.job),
      mode: view.mode === 'test' ? 'prueba contra el meta' : 'búsqueda automática',
      era: view.era,
      format: view.format,
      bank: view.rivals.map((rival) => ({ archetype: rival.archetypeName, weight: round(rival.weight, 3) })),
      ...(explore
        ? {
            search: {
              pool: explore.poolEs,
              phase: { search: 'buscando', confirm: 'confirmando', done: 'terminada' }[explore.phase],
              stopReason: explore.stopReasonEs,
              roundsDone: explore.roundsDone,
              locked: explore.locked.map((card) => card.nameEs),
              // H-010: what the confirmation says of the list found (null without one).
              confirmation: explore.confirmation
                ? `${explore.confirmation.differenceText}: ${explore.confirmation.verdictEs}`
                : null,
              rounds: explore.rounds.map((round) => ({
                kind: { search: 'búsqueda', verify: 'verificación', confirm: 'confirmación' }[round.kind],
                best: labelOf.get(round.incumbent) ?? round.incumbent,
                tried: round.candidates.length,
                winner: round.accepted === null ? null : (labelOf.get(round.accepted) ?? round.accepted),
                decided: round.decided,
              })),
            },
          }
        : {}),
      decks: view.decks.slice(0, args.limit ?? 10).map((deck) => ({
        deck: deck.label,
        role: ROLE_ES[deck.role],
        ...(deck.round === null ? {} : { round: deck.round }),
        score: deck.confirm?.score ? deck.confirm.text : deck.search.text,
        ...(deck.confirm?.score ? { searchScore: deck.search.text } : {}),
        perRival: deck.perRival
          .filter((row) => row.record.wins + row.record.losses + row.record.ties > 0)
          .map((row) => ({
            rival: rivalName.get(row.rival) ?? row.rival,
            record: row.record,
            rate: rateView(row.rate),
          })),
        ...(deck.changes
          ? { changes: { in: deck.changes.add.map(cardLine), out: deck.changes.remove.map(cardLine) } }
          : {}),
        novelty:
          deck.novelty.swaps === null
            ? deck.novelty.label
            : `${deck.novelty.label}: a ${deck.novelty.swaps} cambios de una lista de ${deck.novelty.closestArchetype ?? 'sin arquetipo'} (${deck.novelty.nearbyLists} listas de la era a 6 cambios o menos)`,
        energies: deck.energies,
        cards: deck.cards.map(cardLine),
      })),
    }
  }

  private listSource(list: TournamentListArg): LabDeckInput {
    return {
      listKey: list.key,
      ...(list.era ? { era: list.era } : {}),
      ...(list.format ? { format: list.format } : {}),
      ...(list.energies ? { energies: list.energies } : {}),
    }
  }

  private async onlineCores(): Promise<{ online: boolean; cores: number }> {
    const engine = await this.simulations.engineView()
    const worker = engine.workers.find((item) => item.online)
    return { online: !!worker, cores: worker?.cores ?? 8 }
  }

  private queuedNote(online: boolean): string {
    return online
      ? 'En cola: el worker de la PC la empieza en su próximo chunk libre. Leé los resultados con lab_results.'
      : 'En cola, pero ningún worker está en línea: empieza cuando Santi prenda la PC.'
  }

  private async test(args: {
    decks?: string[]
    lists?: TournamentListArg[]
    texts?: { text: string; name?: string; energies?: SelectableEnergy[] }[]
    size?: number
    era?: string
    format?: 'STANDARD' | 'NOEX'
    games?: number
    bots?: [string, string]
    seed?: number
    label?: string
  }): Promise<Json> {
    const decks: LabDeckInput[] = [
      ...(await Promise.all(
        (args.decks ?? []).map(async (ref) => ({ deckId: (await this.deckRefs.resolve(ref)).id })),
      )),
      ...(args.lists ?? []).map((list) => this.listSource(list)),
      ...(args.texts ?? []).map((item) => ({ text: item.text, name: item.name, energies: item.energies })),
    ]
    if (decks.length === 0) throw new BadRequestException('Indicá al menos un mazo: decks, lists o texts.')
    const job = await this.lab.test({
      decks,
      size: args.size,
      era: args.era,
      format: args.format,
      gamesPerRival: args.games,
      players: args.bots,
      seed: args.seed,
      label: args.label,
    })
    if ('preview' in job) throw new Error('unexpected preview')
    const { online, cores } = await this.onlineCores()
    return {
      queued: true,
      jobId: job.id,
      label: job.label,
      bots: job.playersEs,
      gamesPerRival: job.gamesPerPair,
      pairings: job.progress.chunks.total,
      totalGames: job.progress.totalGames,
      seed: job.baseSeed,
      estimatedMinutes: Math.max(1, Math.round(estimateSeconds(job.progress.totalGames, job.players, cores) / 60)),
      workerOnline: online,
      note: this.queuedNote(online),
    }
  }

  private async explore(args: {
    deck?: string
    list?: TournamentListArg
    text?: string
    energies?: SelectableEnergy[]
    pool?: 'collection' | 'all'
    locked?: string[]
    rounds?: number
    variants?: number
    games?: number
    patience?: number
    confirmGames?: number
    size?: number
    era?: string
    format?: 'STANDARD' | 'NOEX'
    bots?: [string, string]
    seed?: number
    label?: string
    dryRun?: boolean
  }): Promise<Json> {
    const given = [args.deck, args.list, args.text].filter((item) => item !== undefined)
    if (given.length !== 1) throw new BadRequestException('Indicá una sola lista de partida: deck, list o text.')
    let deck: LabDeckInput
    let own: string[] = []
    if (args.deck !== undefined) {
      const ref = await this.deckRefs.resolve(args.deck)
      deck = { deckId: ref.id, ...(args.energies ? { energies: args.energies } : {}) }
      own = (await this.decks.detail(ref.id)).cards.map((entry) => entry.card.id)
    } else if (args.list !== undefined) {
      deck = this.listSource({ ...args.list, ...(args.energies ? { energies: args.energies } : {}) })
    } else {
      deck = { text: args.text as string, ...(args.energies ? { energies: args.energies } : {}) }
    }
    const index = this.catalog.requireIndex()
    const locked = (args.locked ?? []).map((card) => resolveCardRef(index, card, own))
    const settings = {
      pool: args.pool,
      maxRounds: args.rounds,
      variantsPerRound: args.variants,
      gamesPerRival: args.games,
      patience: args.patience,
      confirmGames: args.confirmGames,
    }
    const { online, cores } = await this.onlineCores()
    const result = await this.lab.explore({
      deck,
      locked,
      size: args.size,
      era: args.era,
      format: args.format,
      players: args.bots,
      seed: args.seed,
      label: args.label,
      cores: undefined,
      config: settings,
      dryRun: args.dryRun,
    })
    if ('base' in result) {
      return {
        queued: false,
        start: result.base.label,
        simulable: result.base.simulable,
        problems: result.base.problems.map((problem) => problem.message),
        bank: result.bank.rivals.map((rival) => rival.archetypeName),
        poolCards: result.pool,
        config: result.config,
        firstRound: result.firstRound.map((variant) => ({
          in: variant.add.map(cardLine),
          out: variant.remove.map(cardLine),
        })),
        gamesPerRound: result.games.perRound,
        maxGames: result.games.max,
        estimatedMinutes: {
          perRound: Math.max(
            1,
            Math.round(estimateSeconds(result.games.perRound, args.bots ?? ['e2', 'e2'], cores) / 60),
          ),
          max: Math.max(1, Math.round(estimateSeconds(result.games.max, args.bots ?? ['e2', 'e2'], cores) / 60)),
        },
      }
    }
    const resolved = exploreConfig(settings)
    const rivals = (await this.lab.job(String(result.id))).rivals.length
    const games = exploreGames(resolved, rivals)
    return {
      queued: true,
      jobId: result.id,
      label: result.label,
      bots: result.playersEs,
      seed: result.baseSeed,
      config: resolved,
      rivals,
      gamesPerRound: games.perRound,
      maxGames: games.max,
      estimatedMinutes: {
        perRound: Math.max(1, Math.round(estimateSeconds(games.perRound, result.players, cores) / 60)),
        max: Math.max(1, Math.round(estimateSeconds(games.max, result.players, cores) / 60)),
      },
      workerOnline: online,
      note: this.queuedNote(online),
    }
  }
}
