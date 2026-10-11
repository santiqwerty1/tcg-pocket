/**
 * Decks (PLAN §3.3, invariants I5–I8): CRUD with revisions and change log, validation and completeness against the
 * whole collection, built-in-game limit, duplicate/restore, text formats. The rules live in @tcg/domain; this
 * service persists (`decks`, `deck_revisions`, `deck_changes`, `deck_cards`) and shapes responses.
 */
import { randomInt } from 'node:crypto'
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import {
  aggregateEntries,
  type CatalogIndex,
  type ComparableDeck,
  canMarkBuiltInGame,
  closestDecks,
  countCards,
  type DeckCardEntry,
  type DeckDraft,
  DeckFormatError,
  DRAW_ODDS_TURNS,
  deckCompleteness,
  deckDrawBase,
  deckDrawGroup,
  defaultKeyCards,
  diffDeckDrafts,
  drawOdds,
  energyZoneOdds,
  pickRandomDeck,
  playableCopies,
  recommendBestVersions,
  type SelectableEnergy,
  searchDeckCards,
  searchOdds,
  validateDeck,
  writeDeckgymText,
  writeDeckJson,
  writeLimitlessClipboardText,
  writeSpanishDeckText,
} from '@tcg/domain'
import { CatalogService } from '../catalog/catalog.service.js'
import type { GroupDeckUsage } from '../catalog/catalog-views.js'
import { toCardSummary, toGroupSummary } from '../catalog/catalog-views.js'
import { deckUsageOfCards } from '../catalog/deck-usage.js'
import { CollectionRepository } from '../collection/collection.repository.js'
import type { Deck, DeckChange, DeckRevision, Prisma } from '../generated/prisma/client.js'
import type { DeckSource } from '../generated/prisma/enums.js'
import { idToString, parseNumericId } from '../http/ids.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { type DeckImportFormat, parseDeckText } from './deck-formats.js'
import {
  type BestVersionsView,
  type ClosestDecksResult,
  type DeckCardView,
  type DeckDetail,
  type DeckSummary,
  DrawOddsView,
  type ImportedCardView,
  type ImportedDeckDraft,
  type RandomDeckResult,
  toIssueView,
  type ValidateResult,
  type ValidationView,
} from './deck-views.js'

export interface DeckInput {
  name: string
  energies: SelectableEnergy[]
  cards: DeckCardEntry[]
  tags?: string[] | undefined
  notes?: string | undefined
  /** Id (string) of the deck this one is a variant of; null clears it. */
  variantOfId?: string | null | undefined
  packPriority?: number | undefined
  tournamentArchetypeId?: string | null | undefined
}

export interface DeckPatch extends Partial<DeckInput> {
  builtInGame?: boolean | undefined
  archived?: boolean | undefined
  /** Note of the revision created when cards or energies change. */
  note?: string | undefined
}

export interface DeckListQuery {
  tag?: string | undefined
  archived?: boolean | undefined
  builtInGame?: boolean | undefined
}

export type DeckExportFormat = 'spanish' | 'deckgym' | 'limitless' | 'json'

export interface DeckExport {
  body: string
  contentType: string
  fileName: string
}

export interface ValidateBody {
  text?: string | undefined
  format?: DeckImportFormat | undefined
  cards?: DeckCardEntry[] | undefined
  energies?: SelectableEnergy[] | undefined
}

export interface ClosestBody {
  /** The target is a saved deck (excluded from the candidates)… */
  deckId?: string | undefined
  /** …or a pasted list (first deck of the text)… */
  text?: string | undefined
  format?: DeckImportFormat | undefined
  /** …or explicit cards. */
  cards?: DeckCardEntry[] | undefined
  energies?: SelectableEnergy[] | undefined
  /** `built` (default): decks marked as built in the game; `all`: every active deck. */
  scope?: 'built' | 'all' | undefined
  limit?: number | undefined
}

export interface RandomQuery {
  builtInGame?: boolean | undefined
  tag?: string | undefined
  leastPlayed?: boolean | undefined
  /** Previous pick, so «otro» gives a different deck when there is one. */
  exclude?: string | undefined
}

/** Uniform [0, 1) from the OS CSPRNG (Math.random is fine too, but this one is not seedable by accident). */
function cryptoRandom(): number {
  // randomInt needs max - min < 2^48.
  return randomInt(0, 2 ** 47) / 2 ** 47
}

type DeckRecord = Deck & { revisions: DeckRevision[]; changes: DeckChange[] }
type Tx = Prisma.TransactionClient

/**
 * Deck writes that read-then-write (the built-in-game count of I8, the next revision number) take this
 * transaction-scoped advisory lock first, so two concurrent PATCHes cannot both see 24 built decks and commit 26.
 */
const DECK_WRITES_LOCK_KEY = 1001

async function lockDeckWrites(tx: Tx): Promise<void> {
  // `$executeRaw`, not `$queryRaw`: the function returns `void`, which Prisma cannot deserialize as a result column.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DECK_WRITES_LOCK_KEY})`
}

interface EvalContext {
  index: CatalogIndex
  playableByGroup: Map<string, number>
  /** Copies per tracker row, for the best-print recommendation. */
  ownedByStock: Map<string, number>
}

const EXPORT_FILE_EXTENSION: Record<DeckExportFormat, string> = {
  spanish: 'txt',
  deckgym: 'txt',
  limitless: 'txt',
  json: 'json',
}

function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, at) => value === b[at])
}

/** Entries as stored in deck_revisions.cards (plain JSON). */
function cardsJson(entries: readonly DeckCardEntry[]): Prisma.InputJsonValue {
  return entries.map((entry) => ({ cardId: entry.cardId, count: entry.count }))
}

function revisionCards(revision: DeckRevision): DeckCardEntry[] {
  return (revision.cards as { cardId: string; count: number }[]).map((entry) => ({
    cardId: entry.cardId,
    count: entry.count,
  }))
}

function currentRevision(record: DeckRecord): DeckRevision {
  const current = record.revisions.find((revision) => revision.id === record.currentRevisionId)
  const last = record.revisions[record.revisions.length - 1]
  const revision = current ?? last
  if (!revision) throw new Error(`deck ${record.id} has no revisions`)
  return revision
}

function draftOf(record: DeckRecord): DeckDraft {
  const revision = currentRevision(record)
  return {
    name: record.name,
    energies: revision.energies as SelectableEnergy[],
    cards: revisionCards(revision),
    notes: record.notes,
    source: 'ui',
  }
}

const SEARCH_ODDS_NOTE =
  'Con búsqueda: mientras la carta no está en la mano, cada turno se juegan las Poké Ball (un Pokémon Básico al azar del mazo), las Comunicación Pokémon si la carta es un Pokémon y hay otro Pokémon en la mano, y una Investigación de Profesores (roba 2). Simulación con semilla fija: los mismos números cada vez.'
const ENERGY_ZONE_NOTE =
  'Zona de Energía: una energía por turno propio de uno de los tipos del mazo al azar, salvo el primer turno de quien empieza. Supone que toda la energía va al atacante: es el mejor caso.'
const DRAW_ODDS_NOTE =
  'Mano inicial de 5 con al menos un Pokémon Básico (se reparte de nuevo si no hay) y una carta por turno propio, también en el primero. Solo robo natural: no cuenta cartas que roban o buscan.'

@Injectable()
export class DecksService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly prisma: PrismaService,
    private readonly collection: CollectionRepository,
  ) {}

  // ---------------------------------------------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------------------------------------------

  async list(query: DeckListQuery): Promise<DeckSummary[]> {
    const context = await this.context()
    const records = await this.prisma.deck.findMany({
      where: {
        archivedAt: (query.archived ?? false) ? { not: null } : null,
        ...(query.builtInGame === undefined ? {} : { builtInGame: query.builtInGame }),
        ...(query.tag ? { tags: { has: query.tag } } : {}),
      },
      include: { revisions: { orderBy: { number: 'asc' } }, changes: { take: 0 } },
      orderBy: { id: 'asc' },
    })
    return records.map((record) => this.summary(context, record))
  }

  async detail(rawId: string): Promise<DeckDetail> {
    const record = await this.requireDeck(rawId)
    return this.toDetail(await this.context(), record)
  }

  /**
   * Fase 10: the chance of having a card of the deck (any edition of its functional group; several cards = any of
   * them) by each own turn, and of two groups at once. Without cards: the deck's key attacker (most prize points).
   */
  async drawOdds(
    rawId: string,
    input: {
      cards?: readonly string[] | undefined
      cards2?: readonly string[] | undefined
      turns?: number | undefined
    },
  ): Promise<DrawOddsView> {
    const index = this.catalog.requireIndex()
    const detail = await this.detail(rawId)
    const entries = detail.cards.map((entry) => ({ cardId: entry.card.id, count: entry.count }))
    const base = deckDrawBase(entries, index)
    if (base.basics === 0) {
      throw new BadRequestException({ code: 'validation', message: 'El mazo no tiene ningún Pokémon Básico.' })
    }
    const inDeck = new Set(detail.cards.map((entry) => entry.card.functionalGroupId))
    const groupIds = (ids: readonly string[]) => {
      const groups = [
        ...new Set(ids.map((id) => index.cardById(id)?.functionalGroupId ?? index.groupById(id)?.id ?? id)),
      ]
      const missing = groups.filter((id) => !inDeck.has(id))
      if (missing.length > 0) {
        throw new BadRequestException({
          code: 'validation',
          message: `Esas cartas no están en el mazo: ${missing.join(', ')}.`,
        })
      }
      return groups
    }
    const first = groupIds(input.cards && input.cards.length > 0 ? input.cards : defaultKeyCards(entries, index))
    const second = input.cards2 && input.cards2.length > 0 ? groupIds(input.cards2) : null
    if (second?.some((id) => first.includes(id))) {
      throw new BadRequestException({ code: 'validation', message: 'Las dos cartas tienen que ser distintas.' })
    }
    const sets = second ? [first, second] : [first]
    const groups = sets.map((ids) => deckDrawGroup(entries, ids, index))
    const turns = input.turns ?? DRAW_ODDS_TURNS
    const odds = drawOdds({ ...base, groups, turns })
    // Fase 44: the same first card counting Poké Ball, Investigación de Profesores and Comunicación Pokémon.
    const searchCards = searchDeckCards(entries, index)
    const search = searchCards.some((card) => card.search !== null)
      ? searchOdds({ cards: searchCards, targets: first, turns })
      : null
    return {
      deck: { id: detail.id, name: detail.name },
      ...base,
      groups: sets.map((ids, at) => ({
        cards: ids.map((groupId) => ({ groupId, nameEs: index.groupById(groupId)?.nameEs ?? groupId })),
        copies: (groups[at]?.basic ?? 0) + (groups[at]?.other ?? 0),
        basicCopies: groups[at]?.basic ?? 0,
      })),
      rows: odds.rows,
      basicsInHand: odds.basicsInHand,
      search: search
        ? { cards: search.searchCards, runs: search.runs, seed: search.seed, rows: search.rows, note: SEARCH_ODDS_NOTE }
        : null,
      energy: this.energyOdds(detail.energies, entries, first, turns),
      note: DRAW_ODDS_NOTE,
    }
  }

  /**
   * Fase 44: the Energy Zone for the first card's attacks when it is a Pokémon that attacks (else the deck's key
   * attacker): the chance of paying each attack by own turn, going first and going second.
   */
  private energyOdds(
    deckTypes: readonly SelectableEnergy[],
    entries: readonly DeckCardEntry[],
    firstGroups: readonly string[],
    turns: number,
  ): DrawOddsView['energy'] {
    // A saved deck can repeat a type: the zone gives each type once, and the chips show it once.
    const types = [...new Set(deckTypes)]
    if (types.length === 0 || types.length > 3) return null
    const index = this.catalog.requireIndex()
    const attackerOf = (groupIds: readonly string[]) =>
      entries
        .map((entry) => index.cardById(entry.cardId))
        .find(
          (card) =>
            card !== undefined &&
            card.cardType === 'pokemon' &&
            card.attacks.length > 0 &&
            groupIds.includes(card.functionalGroupId),
        )
    const attacker =
      attackerOf(firstGroups) ??
      attackerOf(defaultKeyCards(entries, index).map((id) => index.cardById(id)?.functionalGroupId ?? id))
    if (!attacker) return null
    return {
      attacker: {
        groupId: attacker.functionalGroupId,
        nameEs: index.groupById(attacker.functionalGroupId)?.nameEs ?? attacker.nameEs,
      },
      types,
      attacks: attacker.attacks.map((attack) => {
        const odds = energyZoneOdds(types, attack.cost, turns)
        return {
          name: attack.name,
          cost: attack.cost,
          payable: odds.payable,
          first: odds.first,
          second: odds.second,
          likelyTurn: odds.likelyTurn,
        }
      }),
      note: ENERGY_ZONE_NOTE,
    }
  }

  /** Fase 10: the same odds from counts typed by hand (no deck). */
  manualDrawOdds(input: {
    deckSize: number
    basics: number
    groups: { basic: number; other: number }[]
    turns?: number | undefined
  }): DrawOddsView {
    let odds: ReturnType<typeof drawOdds>
    try {
      odds = drawOdds({ ...input, turns: input.turns ?? DRAW_ODDS_TURNS })
    } catch (error) {
      throw new BadRequestException({ code: 'validation', message: (error as Error).message })
    }
    return {
      deck: null,
      deckSize: input.deckSize,
      basics: input.basics,
      groups: input.groups.map((group) => ({ cards: [], copies: group.basic + group.other, basicCopies: group.basic })),
      rows: odds.rows,
      basicsInHand: odds.basicsInHand,
      search: null,
      energy: null,
      note: DRAW_ODDS_NOTE,
    }
  }

  /**
   * The saved decks that need the fewest card swaps to become the target (pedido del 7/10/2026). Counted by
   * functional card; the Energy Zone is reported apart. Candidates: decks built in the game, or every active deck.
   */
  async closest(body: ClosestBody): Promise<ClosestDecksResult> {
    const index = this.catalog.requireIndex()
    let target: ComparableDeck
    let targetName: string | null = null
    let excludeId: string | null = null
    if (body.deckId !== undefined) {
      const record = await this.requireDeck(body.deckId)
      target = draftOf(record)
      targetName = record.name
      excludeId = idToString(record.id)
    } else if (body.text !== undefined && body.text.trim() !== '') {
      const parsed = parseDeckText(body.text, body.format ?? 'auto', index)
      const first = parsed.find((item) => item.draft !== null)
      if (!first?.draft) {
        const messages = parsed.flatMap((item) => item.errors.map((issue) => issue.message))
        throw new BadRequestException({
          code: 'invalid_deck_text',
          message: messages.length > 0 ? messages.slice(0, 5).join(' · ') : 'No encontré ningún mazo en el texto.',
        })
      }
      target = first.draft
      targetName = first.title ?? first.draft.name ?? null
    } else if (body.cards !== undefined) {
      this.assertKnownCards(index, body.cards)
      target = { cards: body.cards, energies: body.energies ?? [] }
    } else {
      throw new BadRequestException({ code: 'validation', message: 'Mandá deckId, text o cards.' })
    }
    const scope = body.scope ?? 'built'
    const records = await this.prisma.deck.findMany({
      where: { archivedAt: null, ...(scope === 'built' ? { builtInGame: true } : {}) },
      include: { revisions: { orderBy: { number: 'asc' } }, changes: { take: 0 } },
      orderBy: { id: 'asc' },
    })
    const builtInGameDecks = scope === 'built' ? records.length : records.filter((record) => record.builtInGame).length
    const candidates = records.map((record) => {
      const draft = draftOf(record)
      return {
        id: idToString(record.id),
        name: record.name,
        builtInGame: record.builtInGame,
        cards: draft.cards,
        energies: draft.energies,
      }
    })
    return {
      target: { deckId: excludeId, name: targetName, cardCount: countCards({ cards: [...target.cards] }) },
      scope,
      candidates: candidates.filter((candidate) => candidate.id !== excludeId).length,
      builtInGameDecks,
      results: closestDecks(target, candidates, index, { limit: body.limit ?? 3, excludeId }),
    }
  }

  /** A random active deck, optionally among the built ones, a tag, or the least played (pedido del 7/10/2026). */
  async random(query: RandomQuery, random: () => number = cryptoRandom): Promise<RandomDeckResult> {
    const items = await this.list({ archived: false, builtInGame: query.builtInGame, tag: query.tag })
    const counts = await this.prisma.match.groupBy({ by: ['deckId'], _count: { _all: true } })
    const games = new Map(counts.map((row) => [idToString(row.deckId), row._count._all]))
    const picked = pickRandomDeck(
      items.map((deck) => ({ ...deck, games: games.get(deck.id) ?? 0 })),
      { leastPlayed: query.leastPlayed ?? false, excludeId: query.exclude ?? null, random },
    )
    if (!picked) {
      throw new NotFoundException({ code: 'no_decks', message: 'No hay mazos activos que cumplan el filtro.' })
    }
    const { games: played, ...deck } = picked.deck
    return { deck, games: played, candidates: picked.candidates }
  }

  async byGroup(groupId: string): Promise<GroupDeckUsage[]> {
    const group = this.catalog.requireIndex().groupById(groupId)
    if (!group) throw new NotFoundException(`Carta funcional ${groupId} no encontrada.`)
    return deckUsageOfCards(this.prisma, group.cardIds)
  }

  async export(rawId: string, format: DeckExportFormat): Promise<DeckExport> {
    const index = this.catalog.requireIndex()
    const record = await this.requireDeck(rawId)
    const draft = draftOf(record)
    const fileName = `${record.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'mazo'}.${EXPORT_FILE_EXTENSION[format]}`
    try {
      switch (format) {
        case 'spanish':
          return { body: writeSpanishDeckText(draft, index, { heading: true }), contentType: 'text/plain', fileName }
        case 'deckgym':
          return { body: writeDeckgymText(draft, index), contentType: 'text/plain', fileName }
        case 'limitless':
          return { body: writeLimitlessClipboardText(draft, index), contentType: 'text/plain', fileName }
        case 'json':
          return {
            body: writeDeckJson(draft, {
              tags: record.tags,
              ...(record.variantOfId === null ? {} : { variantOf: idToString(record.variantOfId) }),
              ...(index.catalog.trackerCommit ? { catalogCommit: index.catalog.trackerCommit } : {}),
            }),
            contentType: 'application/json',
            fileName,
          }
      }
    } catch (error) {
      if (error instanceof DeckFormatError) throw new BadRequestException({ code: error.code, message: error.message })
      throw error
    }
  }

  /** Validation + completeness of a text or of an explicit card list, without saving. */
  async validate(body: ValidateBody): Promise<ValidateResult> {
    const context = await this.context()
    let draft: DeckDraft | null
    let parseErrors: { code: string; message: string }[] = []
    if (body.text !== undefined) {
      const parsed = parseDeckText(body.text, body.format ?? 'auto', context.index)
      const first = parsed[0]
      draft = first?.draft ?? null
      parseErrors = (first?.errors ?? []).map((issue) => ({ code: issue.code, message: issue.message }))
      if (parsed.length === 0) parseErrors = [{ code: 'empty', message: 'No encontré ningún mazo en el texto' }]
    } else if (body.cards !== undefined) {
      draft = { energies: body.energies ?? [], cards: body.cards, source: 'ui' }
    } else {
      throw new BadRequestException({ code: 'validation', message: 'Mandá `text` o `cards` (+ `energies`).' })
    }
    if (!draft) {
      return {
        draft: null,
        validation: { ok: false, errors: parseErrors, warnings: [], infos: [] },
        completeness: { complete: false, missing: [], missingCount: 0 },
      }
    }
    const evaluated = this.evaluate(context, draft)
    return { draft, ...evaluated }
  }

  /** Preview of an import: one entry per deck found in the text, each with its validation when it parsed. */
  async importPreview(text: string, format: DeckImportFormat): Promise<ImportedDeckDraft[]> {
    const context = await this.context()
    return parseDeckText(text, format, context.index).map((parsed) => {
      const evaluated = parsed.draft ? this.evaluate(context, parsed.draft) : null
      const cards: ImportedCardView[] = (parsed.draft?.cards ?? []).map((entry) => {
        const card = context.index.cardById(entry.cardId)
        return {
          cardId: entry.cardId,
          count: entry.count,
          nameEs: card?.nameEs ?? entry.cardId,
          nameEn: card?.nameEn ?? entry.cardId,
          cardType: card?.cardType ?? null,
        }
      })
      return {
        number: parsed.number,
        title: parsed.title,
        draft: parsed.draft,
        cards,
        errors: parsed.errors,
        warnings: parsed.warnings,
        validation: evaluated?.validation ?? null,
        completeness: evaluated?.completeness ?? null,
      }
    })
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------------------------------------------

  async create(input: DeckInput, source: DeckSource = 'ui'): Promise<DeckDetail> {
    const index = this.catalog.requireIndex()
    this.assertKnownCards(index, input.cards)
    const variantOfId = await this.resolveVariantOf(input.variantOfId, null)
    const id = await this.prisma.$transaction((tx) => this.insertDeck(tx, { ...input, variantOfId }, source))
    return this.detail(idToString(id))
  }

  /** Creates every deck or none (one transaction); source `import`. */
  async importCommit(inputs: DeckInput[]): Promise<DeckSummary[]> {
    const index = this.catalog.requireIndex()
    for (const input of inputs) this.assertKnownCards(index, input.cards)
    const ids = await this.prisma.$transaction(async (tx) => {
      const created: number[] = []
      for (const input of inputs) {
        const variantOfId = await this.resolveVariantOf(input.variantOfId, null, tx)
        created.push(await this.insertDeck(tx, { ...input, variantOfId }, 'import'))
      }
      return created
    })
    const context = await this.context()
    const records = await this.prisma.deck.findMany({
      where: { id: { in: ids } },
      include: { revisions: { orderBy: { number: 'asc' } }, changes: { take: 0 } },
      orderBy: { id: 'asc' },
    })
    return records.map((record) => this.summary(context, record))
  }

  /** `source`: who made the change (the PWA, or Claude through the MCP write tools). */
  async patch(rawId: string, patch: DeckPatch, source: DeckSource = 'ui'): Promise<DeckDetail> {
    const index = this.catalog.requireIndex()
    if (patch.cards) this.assertKnownCards(index, patch.cards)
    await this.prisma.$transaction(async (tx) => {
      await lockDeckWrites(tx)
      const record = await this.requireDeck(rawId, tx)
      const variantOfId =
        patch.variantOfId === undefined ? undefined : await this.resolveVariantOf(patch.variantOfId, record.id, tx)
      const data: Prisma.DeckUpdateInput = {}
      const changes: { field: string; old: unknown; new: unknown }[] = []
      if (patch.name !== undefined && patch.name !== record.name) {
        changes.push({ field: 'name', old: record.name, new: patch.name })
        data.name = patch.name
      }
      if (patch.tags !== undefined && !sameStringArray(patch.tags, record.tags)) {
        changes.push({ field: 'tags', old: record.tags, new: patch.tags })
        data.tags = patch.tags
      }
      if (patch.notes !== undefined && patch.notes !== record.notes) {
        changes.push({ field: 'notes', old: record.notes, new: patch.notes })
        data.notes = patch.notes
      }
      if (patch.packPriority !== undefined && patch.packPriority !== record.packPriority) {
        changes.push({ field: 'packPriority', old: record.packPriority, new: patch.packPriority })
        data.packPriority = patch.packPriority
      }
      if (patch.tournamentArchetypeId !== undefined && patch.tournamentArchetypeId !== record.tournamentArchetypeId) {
        changes.push({
          field: 'tournamentArchetype',
          old: record.tournamentArchetypeId,
          new: patch.tournamentArchetypeId,
        })
        data.tournamentArchetypeId = patch.tournamentArchetypeId
      }
      if (variantOfId !== undefined && variantOfId !== record.variantOfId) {
        changes.push({
          field: 'variantOf',
          old: record.variantOfId === null ? null : idToString(record.variantOfId),
          new: variantOfId === null ? null : idToString(variantOfId),
        })
        data.variantOf = variantOfId === null ? { disconnect: true } : { connect: { id: variantOfId } }
      }
      // I8 counts the non-archived decks marked as built in the game. Archiving keeps the mark, so the limit is
      // re-checked whenever the deck ends up in that set: marked while active, un-archived while marked, or both.
      const wasArchived = record.archivedAt !== null
      const wasCounted = record.builtInGame && !wasArchived
      const willBeCounted = (patch.builtInGame ?? record.builtInGame) && !(patch.archived ?? wasArchived)
      if (willBeCounted && !wasCounted) await this.assertCanBuild(tx, record.id)
      if (patch.builtInGame !== undefined && patch.builtInGame !== record.builtInGame) {
        changes.push({ field: 'builtInGame', old: record.builtInGame, new: patch.builtInGame })
        data.builtInGame = patch.builtInGame
        data.builtInGameSince = patch.builtInGame ? new Date() : null
      }
      if (patch.archived !== undefined && patch.archived !== wasArchived) {
        changes.push({ field: 'archived', old: wasArchived, new: patch.archived })
        data.archivedAt = patch.archived ? new Date() : null
      }
      if (patch.cards !== undefined || patch.energies !== undefined) {
        const current = draftOf(record)
        const next: DeckDraft = {
          ...current,
          cards: patch.cards ?? current.cards,
          energies: patch.energies ?? current.energies,
        }
        if (diffDeckDrafts(current, next, index).changed) {
          const revision = await this.insertRevision(tx, record.id, next, source, patch.note ?? '')
          data.currentRevisionId = revision.id
        }
      }
      if (changes.length > 0) {
        await tx.deckChange.createMany({
          data: changes.map((change) => ({
            deckId: record.id,
            field: change.field,
            old: change.old === null || change.old === undefined ? undefined : (change.old as Prisma.InputJsonValue),
            new: change.new === null || change.new === undefined ? undefined : (change.new as Prisma.InputJsonValue),
            source,
          })),
        })
      }
      if (Object.keys(data).length > 0) await tx.deck.update({ where: { id: record.id }, data })
    })
    return this.detail(rawId)
  }

  async delete(rawId: string): Promise<void> {
    const record = await this.requireDeck(rawId)
    if (record.archivedAt === null) {
      throw new ConflictException({
        code: 'deck_not_archived',
        message: 'Archivá el mazo antes de borrarlo (los mazos activos no se borran).',
      })
    }
    // Own matches keep the deck alive: deleting it would silently drop them from the statistics.
    const matches = await this.prisma.match.count({ where: { deckId: record.id } })
    if (matches > 0) {
      throw new ConflictException({
        code: 'deck_has_matches',
        message: `El mazo tiene ${matches === 1 ? '1 partida registrada' : `${matches} partidas registradas`}: queda archivado para no perderlas de las estadísticas.`,
        details: { matches },
      })
    }
    await this.prisma.deck.delete({ where: { id: record.id } })
  }

  async duplicate(rawId: string, name: string | undefined): Promise<DeckDetail> {
    const record = await this.requireDeck(rawId)
    const draft = draftOf(record)
    const id = await this.prisma.$transaction((tx) =>
      this.insertDeck(
        tx,
        {
          name: name ?? `${record.name} (copia)`,
          energies: draft.energies,
          cards: draft.cards,
          tags: record.tags,
          notes: record.notes,
          variantOfId: record.id,
          packPriority: record.packPriority,
          tournamentArchetypeId: record.tournamentArchetypeId,
        },
        'duplicate',
      ),
    )
    return this.detail(idToString(id))
  }

  /** Makes revision `number` current again through a new revision (`source: restore`); a no-op when identical. */
  async restoreRevision(rawId: string, number: number): Promise<DeckDetail> {
    const index = this.catalog.requireIndex()
    const record = await this.requireDeck(rawId)
    const target = record.revisions.find((revision) => revision.number === number)
    if (!target) throw new NotFoundException(`El mazo no tiene la revisión ${number}.`)
    const current = draftOf(record)
    const next: DeckDraft = {
      ...current,
      energies: target.energies as SelectableEnergy[],
      cards: revisionCards(target),
    }
    if (diffDeckDrafts(current, next, index).changed) {
      await this.prisma.$transaction(async (tx) => {
        await lockDeckWrites(tx)
        const revision = await this.insertRevision(tx, record.id, next, 'restore', `Restaurada la revisión ${number}`)
        await tx.deck.update({ where: { id: record.id }, data: { currentRevisionId: revision.id } })
      })
    }
    return this.detail(rawId)
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------------------------

  private async context(): Promise<EvalContext> {
    const index = this.catalog.requireIndex()
    const { stock, adjustments } = await this.collection.loadState()
    const playableByGroup = new Map<string, number>()
    for (const [groupId, copies] of playableCopies(index, stock, adjustments))
      playableByGroup.set(groupId, copies.playable)
    const ownedByStock = new Map(Object.values(stock).map((unit) => [unit.stockCardId, unit.amountOwned]))
    return { index, playableByGroup, ownedByStock }
  }

  private evaluate(context: EvalContext, draft: DeckDraft) {
    const validation = validateDeck(draft, context.index)
    const view: ValidationView = {
      ok: validation.ok,
      errors: validation.errors.map(toIssueView),
      warnings: validation.warnings.map(toIssueView),
      infos: validation.infos.map(toIssueView),
    }
    return { validation: view, completeness: deckCompleteness(draft, context.index, context.playableByGroup) }
  }

  private summary(context: EvalContext, record: DeckRecord): DeckSummary {
    const draft = draftOf(record)
    const { validation, completeness } = this.evaluate(context, draft)
    return {
      id: idToString(record.id),
      name: record.name,
      energies: draft.energies,
      tags: record.tags,
      builtInGame: record.builtInGame,
      variantOfId: record.variantOfId === null ? null : idToString(record.variantOfId),
      packPriority: record.packPriority,
      tournamentArchetypeId: record.tournamentArchetypeId,
      archivedAt: record.archivedAt,
      valid: validation.ok,
      errorCount: validation.errors.length,
      complete: completeness.complete,
      missingCount: completeness.missingCount,
      cardCount: countCards(draft),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      revisionNumber: currentRevision(record).number,
    }
  }

  private toDetail(context: EvalContext, record: DeckRecord): DeckDetail {
    const draft = draftOf(record)
    const { validation, completeness } = this.evaluate(context, draft)
    const missingByGroup = new Map(
      completeness.missing.map((missing) => [missing.groupId, missing.need - missing.have]),
    )
    const cards: DeckCardView[] = []
    for (const entry of aggregateEntries(draft.cards)) {
      const card = context.index.cardById(entry.cardId)
      const group = card ? context.index.groupById(card.functionalGroupId) : undefined
      if (!card || !group) continue
      cards.push({
        card: toCardSummary(card),
        count: entry.count,
        group: toGroupSummary(group),
        playable: context.playableByGroup.get(group.id) ?? 0,
        missing: missingByGroup.get(group.id) ?? 0,
      })
    }
    return {
      ...this.summary(context, record),
      notes: record.notes,
      cards,
      validation,
      completeness,
      revisions: record.revisions.map((revision) => ({
        number: revision.number,
        createdAt: revision.createdAt,
        source: revision.source,
        note: revision.note,
        cardCount: countCards({ cards: revisionCards(revision) }),
        energies: revision.energies as SelectableEnergy[],
      })),
      changes: record.changes.map((change) => ({
        field: change.field,
        old: change.old ?? null,
        new: change.new ?? null,
        at: change.at,
        source: change.source,
      })),
      bestVersions: this.bestVersions(context, draft),
    }
  }

  /** Which owned prints to put in the game deck: same functional card, best rarity, holographic over plain. */
  private bestVersions(context: EvalContext, draft: DeckDraft): BestVersionsView {
    const result = recommendBestVersions(
      draft.cards,
      context.index,
      (stockCardId) => context.ownedByStock.get(stockCardId) ?? 0,
    )
    return {
      changed: result.changed,
      groups: result.groups
        .filter((group) => group.improves)
        .map((group) => ({
          groupId: group.groupId,
          nameEs: group.nameEs,
          need: group.need,
          current: group.current,
          recommended: group.recommended.map((pick) => ({
            cardId: pick.cardId,
            nameEs: context.index.cardById(pick.cardId)?.nameEs ?? pick.cardId,
            rarity: pick.rarity,
            holo: pick.holo,
            count: pick.count,
          })),
        })),
      cards: result.cards,
    }
  }

  private async requireDeck(rawId: string, client: Tx | PrismaService = this.prisma): Promise<DeckRecord> {
    const id = parseNumericId(rawId, 'Mazo')
    const record = await client.deck.findUnique({
      where: { id },
      include: { revisions: { orderBy: { number: 'asc' } }, changes: { orderBy: [{ at: 'asc' }, { id: 'asc' }] } },
    })
    if (!record) throw new NotFoundException(`Mazo ${rawId} no encontrado.`)
    return record
  }

  private assertKnownCards(index: CatalogIndex, cards: readonly DeckCardEntry[]): void {
    const unknown = [...new Set(cards.map((entry) => entry.cardId).filter((cardId) => !index.cardById(cardId)))]
    if (unknown.length > 0) {
      throw new BadRequestException({
        code: 'unknown_card',
        message: `No existe${unknown.length === 1 ? '' : 'n'} en el catálogo: ${unknown.join(', ')}.`,
        details: unknown,
      })
    }
  }

  /** `variantOfId` as a database id (null clears it); it must exist and differ from `selfId`. */
  private async resolveVariantOf(
    raw: string | null | undefined,
    selfId: number | null,
    tx: Tx | PrismaService = this.prisma,
  ): Promise<number | null> {
    if (raw === undefined || raw === null || raw === '') return null
    const id = parseNumericId(raw, 'Mazo')
    if (id === selfId)
      throw new BadRequestException({ code: 'validation', message: 'Un mazo no puede ser variante de sí mismo.' })
    const exists = await tx.deck.findUnique({ where: { id }, select: { id: true } })
    if (!exists) throw new NotFoundException(`Mazo ${raw} no encontrado (variantOfId).`)
    return id
  }

  private async assertCanBuild(tx: Tx, deckId: number): Promise<void> {
    const decks = await tx.deck.findMany({ select: { id: true, builtInGame: true, archivedAt: true } })
    const check = canMarkBuiltInGame(
      decks.map((deck) => ({ id: idToString(deck.id), builtInGame: deck.builtInGame, archivedAt: deck.archivedAt })),
      idToString(deckId),
    )
    if (!check.ok) {
      throw new ConflictException({
        code: 'built_in_game_limit',
        message: check.message ?? 'Ya hay 25 mazos armados en el juego.',
        details: { built: check.built, max: check.max },
      })
    }
  }

  private async insertDeck(
    tx: Tx,
    input: Omit<DeckInput, 'variantOfId'> & { variantOfId: number | null },
    source: DeckSource,
  ): Promise<number> {
    const entries = aggregateEntries(input.cards)
    const deck = await tx.deck.create({
      data: {
        name: input.name,
        energies: input.energies,
        tags: input.tags ?? [],
        notes: input.notes ?? '',
        packPriority: input.packPriority ?? 0,
        tournamentArchetypeId: input.tournamentArchetypeId ?? null,
        ...(input.variantOfId === null ? {} : { variantOf: { connect: { id: input.variantOfId } } }),
      },
    })
    const revision = await tx.deckRevision.create({
      data: { deckId: deck.id, number: 1, cards: cardsJson(entries), energies: input.energies, note: '', source },
    })
    await tx.deck.update({ where: { id: deck.id }, data: { currentRevisionId: revision.id } })
    await this.materialize(tx, deck.id, entries)
    return deck.id
  }

  /** Appends a revision; the number comes from the database inside the (locked) transaction, never from a stale read. */
  private async insertRevision(
    tx: Tx,
    deckId: number,
    draft: DeckDraft,
    source: DeckSource,
    note: string,
  ): Promise<DeckRevision> {
    const entries = aggregateEntries(draft.cards)
    const latest = await tx.deckRevision.aggregate({ where: { deckId }, _max: { number: true } })
    const number = (latest._max.number ?? 0) + 1
    const revision = await tx.deckRevision.create({
      data: { deckId, number, cards: cardsJson(entries), energies: draft.energies, note, source },
    })
    await this.materialize(tx, deckId, entries)
    return revision
  }

  /** `deck_cards` mirrors the current revision ("which decks use X"). */
  private async materialize(tx: Tx, deckId: number, entries: readonly DeckCardEntry[]): Promise<void> {
    await tx.deckCard.deleteMany({ where: { deckId } })
    if (entries.length === 0) return
    await tx.deckCard.createMany({
      data: entries.map((entry, position) => ({ deckId, cardId: entry.cardId, count: entry.count, position })),
    })
  }
}
