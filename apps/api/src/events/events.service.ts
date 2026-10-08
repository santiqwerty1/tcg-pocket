/**
 * Eventos con restricciones (Fase 16): the owner types an event's deck rules; the app says which of the decks comply
 * (and what breaks the rules in the others, with another edition when that fixes it) and which tournament lists of
 * the era comply and can be built, the ones to send to the Laboratorio under the same rules.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  type CatalogIndex,
  checkEventDeck,
  type DeckCardEntry,
  describeEventRulesEs,
  type EventRules,
  eventRulesSchema,
  listsAgainstCollection,
  type WinRate,
} from '@tcg/domain'
import { CatalogService } from '../catalog/catalog.service.js'
import type { Event, Prisma } from '../generated/prisma/client.js'
import { idToString, parseNumericId } from '../http/ids.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { TournamentsService } from '../tournaments/tournaments.service.js'

export interface EventInput {
  name: string
  startsOn?: string | null | undefined
  endsOn?: string | null | undefined
  rules: EventRules
  notes?: string | undefined
}

export interface EventView {
  id: string
  name: string
  startsOn: string | null
  endsOn: string | null
  rules: EventRules
  rulesEs: string[]
  notes: string
  createdAt: Date
  updatedAt: Date
}

export interface EventDetailView extends EventView {
  /** Active decks: the ones that comply first. */
  decks: { id: string; name: string; builtInGame: boolean; ok: boolean; problems: string[] }[]
  /** Exact tournament lists of the era that comply (any edition), buildable ones first. */
  lists: {
    key: string
    archetype: string | null
    lists: number
    rate: WinRate | null
    missingCopies: number
    pokemon: string[]
  }[]
  era: string | null
}

const LIST_LIMIT = 20

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null
}

function toDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined
  return value === null ? null : new Date(`${value}T00:00:00Z`)
}

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly tournaments: TournamentsService,
  ) {}

  private view(event: Event, index: CatalogIndex): EventView {
    const rules = eventRulesSchema.parse(event.rules)
    return {
      id: idToString(event.id),
      name: event.name,
      startsOn: dateOnly(event.startsOn),
      endsOn: dateOnly(event.endsOn),
      rules,
      rulesEs: describeEventRulesEs(rules, index),
      notes: event.notes,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    }
  }

  private assertCards(rules: EventRules, index: CatalogIndex): EventRules {
    const banned = rules.banned?.map((id) => index.cardById(id)?.functionalGroupId ?? index.groupById(id)?.id ?? null)
    if (banned?.some((id) => id === null)) {
      throw new BadRequestException({ code: 'validation', message: 'Una carta prohibida no existe en el catálogo.' })
    }
    const expansions = rules.expansions?.filter((id) => !index.expansionById(id))
    if (expansions && expansions.length > 0) {
      throw new BadRequestException({ code: 'validation', message: `Expansión desconocida: ${expansions.join(', ')}.` })
    }
    return banned ? { ...rules, banned: [...new Set(banned as string[])] } : rules
  }

  async list(): Promise<EventView[]> {
    const index = this.catalog.requireIndex()
    const events = await this.prisma.event.findMany({ orderBy: [{ startsOn: 'desc' }, { id: 'desc' }] })
    return events.map((event) => this.view(event, index))
  }

  private async requireEvent(rawId: string): Promise<Event> {
    const event = await this.prisma.event.findUnique({ where: { id: parseNumericId(rawId, 'Evento') } })
    if (!event) throw new NotFoundException(`Evento ${rawId} no encontrado.`)
    return event
  }

  /** The rules of an event (for the Laboratorio). */
  async rulesOf(rawId: string): Promise<{ name: string; rules: EventRules }> {
    const event = await this.requireEvent(rawId)
    return { name: event.name, rules: eventRulesSchema.parse(event.rules) }
  }

  async create(input: EventInput): Promise<EventView> {
    const index = this.catalog.requireIndex()
    const rules = this.assertCards(input.rules, index)
    const created = await this.prisma.event.create({
      data: {
        name: input.name.trim(),
        startsOn: toDate(input.startsOn) ?? null,
        endsOn: toDate(input.endsOn) ?? null,
        rules: rules as Prisma.InputJsonValue,
        notes: input.notes?.trim() ?? '',
      },
    })
    return this.view(created, index)
  }

  async patch(rawId: string, input: Partial<EventInput>): Promise<EventView> {
    const index = this.catalog.requireIndex()
    const event = await this.requireEvent(rawId)
    const data: Prisma.EventUpdateInput = {}
    if (input.name !== undefined) data.name = input.name.trim()
    if (input.startsOn !== undefined) data.startsOn = toDate(input.startsOn)
    if (input.endsOn !== undefined) data.endsOn = toDate(input.endsOn)
    if (input.rules !== undefined) data.rules = this.assertCards(input.rules, index) as Prisma.InputJsonValue
    if (input.notes !== undefined) data.notes = input.notes.trim()
    const updated = await this.prisma.event.update({ where: { id: event.id }, data })
    return this.view(updated, index)
  }

  async remove(rawId: string): Promise<void> {
    const event = await this.requireEvent(rawId)
    await this.prisma.event.delete({ where: { id: event.id } })
  }

  async detail(rawId: string): Promise<EventDetailView> {
    const index = this.catalog.requireIndex()
    const event = await this.requireEvent(rawId)
    const base = this.view(event, index)
    const rules = base.rules
    const decks = await this.prisma.deck.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true, builtInGame: true, currentRevisionId: true },
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
    const deckRows = decks.map((deck) => {
      const cards = deck.currentRevisionId === null ? [] : (revisions.get(deck.currentRevisionId) ?? [])
      const check = checkEventDeck(cards, rules, index)
      return {
        id: idToString(deck.id),
        name: deck.name,
        builtInGame: deck.builtInGame,
        ok: check.ok,
        problems: check.problems.map((problem) => problem.message),
      }
    })
    deckRows.sort((a, b) => Number(b.ok) - Number(a.ok) || Number(b.builtInGame) - Number(a.builtInGame))

    let era: string | null = null
    let lists: EventDetailView['lists'] = []
    const scoped = await this.tournaments.scopedDataset({}).catch(() => null)
    if (scoped) {
      era = scoped.scope.era
      const playable = await this.tournaments.playable(index)
      lists = listsAgainstCollection(scoped.dataset, playable)
        .filter(
          (row) =>
            checkEventDeck(
              row.list.cards
                .filter((card) => card.cardId !== null)
                .map((card) => ({ cardId: card.cardId as string, count: card.count })),
              rules,
              index,
              { anyEdition: true },
            ).ok,
        )
        .sort((a, b) => a.missingCopies - b.missingCopies || b.list.lists - a.list.lists)
        .slice(0, LIST_LIMIT)
        .map((row) => ({
          key: row.list.key,
          archetype: row.list.archetypeId ? (scoped.dataset.archetypes.get(row.list.archetypeId)?.name ?? null) : null,
          lists: row.list.lists,
          rate: row.list.rate,
          missingCopies: row.missingCopies,
          pokemon: [
            ...new Set(
              row.list.cards
                .map((card) => (card.cardId ? index.cardById(card.cardId) : undefined))
                .filter((card) => card?.cardType === 'pokemon')
                .map((card) => card?.nameEs ?? ''),
            ),
          ],
        }))
    }
    return { ...base, decks: deckRows, lists, era }
  }
}
