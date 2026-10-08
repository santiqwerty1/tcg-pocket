/**
 * Engine status and deck snapshots (PLAN §3.7, §4): what the engine implements (reported by the worker from
 * `engine-cli status`, or the Fase 0 list for fb792ebf until then) and the frozen deckgym text of each deck a job
 * plays. Snapshots of the same list from the same source are reused.
 */
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import {
  buildSnapshot,
  type DeckCardEntry,
  type DeckSnapshotDraft,
  type EngineStatus,
  energyFromNameEn,
  FALLBACK_ENGINE_REV,
  fallbackEngineStatus,
  type SelectableEnergy,
  type SnapshotCard,
  type SnapshotProblem,
  type TournamentFormat,
  UNIMPLEMENTED_AT_FB792EBF,
} from '@tcg/domain'
import { CatalogService } from '../catalog/catalog.service.js'
import { ENV, type Env } from '../config/env.js'
import type { Prisma } from '../generated/prisma/client.js'
import { idToString, parseNumericId } from '../http/ids.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { TournamentsService } from '../tournaments/tournaments.service.js'
import type { SnapshotView } from './simulation-views.js'

/**
 * A deck to play: one of mine (current revision), an exact tournament list (with an optional energy choice) or a list
 * given card by card (pasted text, or a variant of the Laboratorio, T-008).
 */
export type SnapshotSource =
  | { deckId: string; energies?: SelectableEnergy[] | undefined }
  | { cards: DeckCardEntry[]; energies: SelectableEnergy[]; label: string; origin: 'text' | 'lab' }
  | {
      listKey: string
      era?: string | undefined
      format?: TournamentFormat | undefined
      kind?: 'group' | 'name' | undefined
      energies?: SelectableEnergy[] | undefined
    }

@Injectable()
export class EngineStatusService {
  /** `from`: the engine revision the map was uploaded for (another one right after an engine update). */
  private cache: { rev: string; from: string | null; map: Map<string, boolean> } | null = null

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {}

  engineRev(): string {
    return this.env.engineRev
  }

  /**
   * The card status of the current engine; right after an engine update, before a worker with the new engine
   * uploads it, the one of the engine a worker used last (deckgym rarely changes which cards are implemented).
   */
  private async load(): Promise<{ from: string | null; map: Map<string, boolean> }> {
    const rev = this.env.engineRev
    if (this.cache?.rev !== rev) {
      const read = async (engineRev: string) =>
        this.prisma.engineCard.findMany({ where: { engineRev }, select: { engineId: true, complete: true } })
      let from: string | null = rev
      let rows = await read(rev)
      if (rows.length === 0) {
        const worker = await this.prisma.workerNode.findFirst({
          where: { engineRev: { not: rev } },
          orderBy: { lastSeenAt: 'desc' },
          select: { engineRev: true },
        })
        const other =
          worker?.engineRev ??
          (await this.prisma.engineCard.findFirst({ where: { engineRev: { not: rev } }, select: { engineRev: true } }))
            ?.engineRev ??
          null
        from = other
        rows = other ? await read(other) : []
      }
      this.cache = {
        rev,
        from: rows.length > 0 ? from : null,
        map: new Map(rows.map((row) => [row.engineId, row.complete])),
      }
    }
    return this.cache
  }

  async status(): Promise<EngineStatus> {
    const { map } = await this.load()
    if (map.size > 0) return (engineId) => map.get(engineId)
    // Nothing uploaded by any worker yet: the Fase 0 list (46 B4b reprints at fb792eb).
    return fallbackEngineStatus
  }

  async summary(): Promise<{
    cards: number
    incomplete: number
    source: 'worker' | 'previous' | 'fallback' | 'none'
    statusRev: string | null
  }> {
    const { from, map } = await this.load()
    if (map.size > 0) {
      return {
        cards: map.size,
        incomplete: [...map.values()].filter((complete) => !complete).length,
        source: from === this.env.engineRev ? 'worker' : 'previous',
        statusRev: from,
      }
    }
    return { cards: 0, incomplete: UNIMPLEMENTED_AT_FB792EBF.size, source: 'fallback', statusRev: FALLBACK_ENGINE_REV }
  }

  /** Forgets the cached status (tests; an upload does it by itself). */
  invalidate(): void {
    this.cache = null
  }

  /** Replaces the status of one engine revision with what `engine-cli status` printed. */
  async upload(
    engineRev: string,
    cards: { id: string; name: string; status: string; complete: boolean }[],
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.engineCard.deleteMany({ where: { engineRev } }),
      this.prisma.engineCard.createMany({
        data: cards.map((card) => ({
          engineRev,
          engineId: card.id,
          name: card.name,
          status: card.status,
          complete: card.complete,
        })),
        skipDuplicates: true,
      }),
    ])
    this.cache = null
  }
}

function view(row: {
  id: number
  key: string
  label: string
  sourceType: string
  sourceId: string | null
  deckId: number | null
  energies: string[]
  simulable: boolean
  problems: Prisma.JsonValue
  cards: Prisma.JsonValue
  deckgymText: string
}): SnapshotView {
  const cards = row.cards as unknown as SnapshotCard[]
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    sourceType: row.sourceType as SnapshotView['sourceType'],
    sourceId: row.sourceId,
    deckId: row.deckId === null ? null : idToString(row.deckId),
    energies: row.energies,
    simulable: row.simulable,
    problems: row.problems as unknown as SnapshotProblem[],
    remapped: cards
      .filter((card) => card.cardId !== card.playedAs)
      .map((card) => ({ cardId: card.cardId, playedAs: card.playedAs })),
    deckgymText: row.deckgymText,
  }
}

export { view as snapshotView }

@Injectable()
export class SnapshotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly engine: EngineStatusService,
    private readonly tournaments: TournamentsService,
  ) {}

  /** The draft of a source, not saved: what the confirmation screen shows. */
  async draft(source: SnapshotSource): Promise<{ draft: DeckSnapshotDraft; meta: SnapshotMeta }> {
    const index = this.catalog.requireIndex()
    const engine = await this.engine.status()
    if ('deckId' in source) {
      const id = parseNumericId(source.deckId, 'Mazo')
      const deck = await this.prisma.deck.findUnique({
        where: { id },
        select: { id: true, name: true, energies: true, currentRevisionId: true },
      })
      if (!deck) throw new NotFoundException(`Mazo ${source.deckId} no encontrado.`)
      const revision =
        deck.currentRevisionId === null
          ? null
          : await this.prisma.deckRevision.findUnique({
              where: { id: deck.currentRevisionId },
              select: { id: true, number: true, cards: true, energies: true },
            })
      const cards = (revision?.cards ?? []) as unknown as DeckCardEntry[]
      const declared = (revision?.energies ?? deck.energies) as SelectableEnergy[]
      const energies = source.energies && source.energies.length > 0 ? source.energies : declared
      // «13. Hoopa ex» already carries its number (the 40 lists were imported in order); others get «#id».
      const number = idToString(deck.id)
      const numbered = deck.name.trim().startsWith(`${number}.`) || deck.name.trim().startsWith(`${number} `)
      const draft = buildSnapshot({
        label: `${numbered ? '' : `#${number} `}${deck.name}${revision ? ` (rev. ${revision.number})` : ''}`,
        cards,
        energies,
        index,
        engine,
      })
      return {
        draft,
        meta: {
          sourceType: 'deck_revision',
          sourceId: revision ? String(revision.id) : null,
          deckId: deck.id,
          energySource: source.energies && source.energies.length > 0 ? 'chosen' : 'declared',
        },
      }
    }
    if ('cards' in source) {
      return {
        draft: buildSnapshot({ label: source.label, cards: source.cards, energies: source.energies, index, engine }),
        meta: { sourceType: source.origin, sourceId: null, deckId: null, energySource: 'declared' },
      }
    }
    const detail = await this.tournaments.list(source.listKey, {
      era: source.era,
      format: source.format,
      kind: source.kind,
    })
    const unknown = detail.list.cards.filter((card) => card.cardId === null)
    if (unknown.length > 0) {
      throw new BadRequestException({
        code: 'unknown_card',
        message: `La lista tiene cartas que el catálogo no conoce: ${unknown.map((card) => `${card.set}-${card.number}`).join(', ')}.`,
      })
    }
    const declared = detail.energies
      .map((word) => energyFromNameEn(word))
      .filter((energy): energy is SelectableEnergy => energy !== undefined)
    const energies = source.energies && source.energies.length > 0 ? source.energies : declared
    const draft = buildSnapshot({
      label: `${detail.list.archetype.name} · lista ${source.listKey.slice(0, 6)} (${detail.list.lists} en torneo)`,
      cards: detail.list.cards.map((card) => ({ cardId: card.cardId as string, count: card.count })),
      energies,
      index,
      engine,
    })
    return {
      draft,
      meta: {
        sourceType: 'tournament_list',
        sourceId: source.listKey,
        deckId: null,
        energySource: source.energies && source.energies.length > 0 ? 'chosen' : 'declared',
      },
    }
  }

  /** Saves (or reuses) the snapshot of a source. */
  async save(source: SnapshotSource): Promise<SnapshotView> {
    const { draft, meta } = await this.draft(source)
    const existing = await this.prisma.deckSnapshot.findFirst({
      where: { key: draft.key, sourceType: meta.sourceType, sourceId: meta.sourceId },
      orderBy: { id: 'desc' },
    })
    if (existing && existing.simulable === draft.simulable) return view(existing)
    const row = await this.prisma.deckSnapshot.create({
      data: {
        key: draft.key,
        label: draft.label,
        sourceType: meta.sourceType,
        sourceId: meta.sourceId,
        deckId: meta.deckId,
        deckgymText: draft.deckgymText,
        energies: draft.energies,
        energySource: meta.energySource,
        cards: draft.cards as unknown as Prisma.InputJsonValue,
        problems: draft.problems as unknown as Prisma.InputJsonValue,
        simulable: draft.simulable,
      },
    })
    return view(row)
  }

  async preview(source: SnapshotSource): Promise<Omit<SnapshotView, 'id'>> {
    const { draft, meta } = await this.draft(source)
    return {
      key: draft.key,
      label: draft.label,
      sourceType: meta.sourceType,
      sourceId: meta.sourceId,
      deckId: meta.deckId === null ? null : idToString(meta.deckId),
      energies: draft.energies,
      simulable: draft.simulable,
      problems: draft.problems,
      remapped: draft.cards
        .filter((card) => card.cardId !== card.playedAs)
        .map((card) => ({ cardId: card.cardId, playedAs: card.playedAs })),
      deckgymText: draft.deckgymText,
    }
  }

  async byIds(ids: readonly number[]): Promise<SnapshotView[]> {
    const rows = await this.prisma.deckSnapshot.findMany({ where: { id: { in: [...ids] } } })
    return rows.map(view)
  }
}

export interface SnapshotMeta {
  sourceType: 'deck_revision' | 'tournament_list' | 'text' | 'lab'
  sourceId: string | null
  deckId: number | null
  energySource: 'declared' | 'chosen'
}
