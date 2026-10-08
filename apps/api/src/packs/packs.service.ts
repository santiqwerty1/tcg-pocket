/**
 * Packs (PLAN §3.4, M4; Fase 4): the owner's switches per pack («disponible», «tiempo limitado» with its last day),
 * the rarity rules (points, trade) and the recommendation. Goals come from the decks with `packPriority` > 0 and the
 * collection goal; defaults from `app_settings` (`alpha`, `packModel`, `rarityFilter`, `limitedBoost`). The
 * model lives in @tcg/domain.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  type CollectionGoal,
  DEFAULT_LIMITED_BOOST,
  DEFAULT_RARITY_RULES,
  type DeckGoal,
  type PackModel,
  playableCopies,
  RARITIES,
  type Rarity,
  type RarityRule,
  recommendPacks,
} from '@tcg/domain'
import { z } from 'zod'
import { CatalogService } from '../catalog/catalog.service.js'
import { CollectionRepository } from '../collection/collection.repository.js'
import { dateOnly, todayInOwnerZone } from '../config/time-zone.js'
import { idToString } from '../http/ids.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { DeckVersionView } from '../tournaments/tournament-views.js'
import { TournamentsService } from '../tournaments/tournaments.service.js'
import type { DeckTarget, PackRef, PackView, RarityRuleView, RecommendationView } from './pack-views.js'

export interface RecommendBody {
  model?: PackModel | undefined
  alpha?: number | undefined
  /** null = no collection goal; undefined = the saved one (or all rarities, 1 copy). */
  collection?: CollectionGoal | null | undefined
  onlyAvailable?: boolean | undefined
  /** 1…5: weight of the cards only a limited-time pack gives; undefined = the saved one (or 2). */
  limitedBoost?: number | undefined
  /** undefined = the saved one (or `saved`). */
  deckTarget?: DeckTarget | undefined
}

export interface PackPatch {
  available?: boolean | undefined
  limited?: boolean | undefined
  /** YYYY-MM-DD, the last day on sale; null = unknown. */
  limitedUntil?: string | null | undefined
}

export const DEFAULT_ALPHA = 0.7
export const DEFAULT_COLLECTION_GOAL: CollectionGoal = { rarities: [], copies: 1 }

const settingSchemas = {
  alpha: z.number().min(0).max(1),
  packModel: z.enum(['corrected', 'tracker']),
  rarityFilter: z.object({ rarities: z.array(z.enum(RARITIES)), copies: z.number().int().min(1).max(5) }).nullable(),
  limitedBoost: z.number().min(1).max(5),
  packDeckTarget: z.enum(['saved', 'tournament']),
}

const ASSUMPTIONS = [
  'Tasas por posición constantes (tablas oficiales), sin «pity» ni rachas.',
  'Las posiciones de un sobre son independientes y una carta puede repetirse en el mismo sobre.',
  'Sobre raro (0,05 %) con cartas uniformes entre las elegibles; los Deluxe sin sobre raro.',
  'En sets con bebés, 8,33 % de sobres de 6 cartas con la sexta para bebés.',
  'Los puntos de sobre son de la expansión: 5 por sobre abierto. Costos ✵/✵✵ sin verificar.',
  'Cada sobre se evalúa solo; la mejor política es volver a mirar después de cada importación.',
  'Sobres por tiempo limitado: lo que solo ellos dan (otra carta funcional para los mazos, otra versión para la colección) pesa más hasta su último día; después dejan de estar a la venta.',
  'Versiones: dos números con el mismo internal_id del tracker son la misma versión (A1-1 = A4b-1); un arte u holo nuevo es otra versión de la misma carta funcional.',
  'Versión de torneo de un mazo: la lista exacta de su arquetipo jugada al menos 5 veces en la era con la mejor cota inferior del intervalo; sin datos de torneo se usa la lista guardada.',
]

@Injectable()
export class PacksService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly prisma: PrismaService,
    private readonly collection: CollectionRepository,
    private readonly tournaments: TournamentsService,
  ) {}

  /** Packs that can be opened (with a pack structure; the set-wide «everypack» of multi-pack sets is not one). */
  async list(): Promise<PackView[]> {
    const index = this.catalog.requireIndex()
    const rows = await this.prisma.pack.findMany({
      select: { id: true, available: true, limited: true, limitedUntil: true },
    })
    const byId = new Map(rows.map((row) => [row.id, row]))
    const views: PackView[] = []
    for (const expansion of index.catalog.expansions) {
      const structure = expansion.packStructure
      if (!structure) continue
      for (const pack of index.packsOfExpansion(expansion.id)) {
        if (pack.name === 'everypack' && expansion.packIds.length > 1) continue
        views.push({
          id: pack.id,
          expansionId: expansion.id,
          expansionNameEs: expansion.nameEs,
          name: pack.name,
          nameEs: pack.nameEs,
          available: byId.get(pack.id)?.available ?? true,
          limited: byId.get(pack.id)?.limited ?? false,
          limitedUntil: dateOnly(byId.get(pack.id)?.limitedUntil ?? null),
          cardsPerPack: structure.cardsPerPack,
          cardCount: pack.cardIds.length,
          containsShinies: structure.containsShinies,
          containsBabies: structure.containsBabies,
          inTrackerOverview: expansion.openableTracker,
        })
      }
    }
    return views
  }

  async updatePack(packId: string, patch: PackPatch): Promise<PackView> {
    const pack = (await this.list()).find((item) => item.id === packId)
    if (!pack) throw new NotFoundException(`Sobre ${packId} no encontrado.`)
    await this.prisma.pack.update({
      where: { id: packId },
      data: {
        ...(patch.available === undefined ? {} : { available: patch.available }),
        ...(patch.limited === undefined ? {} : { limited: patch.limited }),
        ...(patch.limitedUntil === undefined
          ? {}
          : { limitedUntil: patch.limitedUntil === null ? null : new Date(`${patch.limitedUntil}T00:00:00Z`) }),
      },
    })
    return {
      ...pack,
      available: patch.available ?? pack.available,
      limited: patch.limited ?? pack.limited,
      limitedUntil: patch.limitedUntil === undefined ? pack.limitedUntil : patch.limitedUntil,
    }
  }

  async rarityRules(): Promise<RarityRuleView[]> {
    const rows = await this.prisma.rarityRule.findMany()
    const byRarity = new Map(rows.map((row) => [row.rarity, row]))
    return RARITIES.map((rarity) => {
      const row = byRarity.get(rarity)
      const fallback = DEFAULT_RARITY_RULES[rarity]
      return row
        ? { rarity, points: row.points, verified: row.pointsVerified, tradeable: row.tradeable }
        : { rarity, points: fallback.points, verified: fallback.verified, tradeable: fallback.tradeable }
    })
  }

  async setRarityRule(
    rarity: string,
    patch: { points?: number | null | undefined; verified?: boolean | undefined; tradeable?: boolean | undefined },
  ): Promise<RarityRuleView> {
    if (!(RARITIES as readonly string[]).includes(rarity)) throw new NotFoundException(`Rareza ${rarity} desconocida.`)
    const current = (await this.rarityRules()).find((rule) => rule.rarity === rarity) as RarityRuleView
    const next = {
      points: patch.points === undefined ? current.points : patch.points,
      pointsVerified: patch.verified ?? current.verified,
      tradeable: patch.tradeable ?? current.tradeable,
    }
    await this.prisma.rarityRule.upsert({ where: { rarity }, create: { rarity, ...next }, update: next })
    return { rarity, points: next.points, verified: next.pointsVerified, tradeable: next.tradeable }
  }

  async recommend(body: RecommendBody): Promise<RecommendationView> {
    const index = this.catalog.requireIndex()
    const settings = await this.savedSettings()
    const model = body.model ?? settings.packModel ?? 'corrected'
    const alpha = body.alpha ?? settings.alpha ?? DEFAULT_ALPHA
    const collection =
      body.collection === undefined
        ? settings.rarityFilter === undefined
          ? DEFAULT_COLLECTION_GOAL
          : settings.rarityFilter
        : body.collection
    const onlyAvailable = body.onlyAvailable ?? false
    const limitedBoost = body.limitedBoost ?? settings.limitedBoost ?? DEFAULT_LIMITED_BOOST
    const deckTarget = body.deckTarget ?? settings.packDeckTarget ?? 'saved'
    const today = todayInOwnerZone()

    const [{ stock, adjustments }, packRows, rules, goals] = await Promise.all([
      this.collection.loadState(),
      this.prisma.pack.findMany({ select: { id: true, available: true, limited: true, limitedUntil: true } }),
      this.rarityRules(),
      this.deckGoals(deckTarget),
    ])
    const playable = new Map(
      [...playableCopies(index, stock, adjustments)].map(([groupId, copies]) => [groupId, copies.playable]),
    )
    const available = new Map(packRows.map((row) => [row.id, row.available]))
    const limited = new Map(
      packRows.filter((row) => row.limited).map((row) => [row.id, { until: dateOnly(row.limitedUntil) }]),
    )
    const ruleByRarity = new Map(rules.map((rule) => [rule.rarity, rule]))
    const result = recommendPacks({
      index,
      decks: goals.map((goal) => goal.goal),
      collection,
      alpha,
      playable: (groupId) => playable.get(groupId) ?? 0,
      owned: (stockCardId) => stock[stockCardId]?.amountOwned ?? 0,
      available: (packId) => available.get(packId) ?? true,
      model,
      onlyAvailable,
      limited: (packId) => limited.get(packId) ?? null,
      today,
      limitedBoost,
      rarityRule: (rarity: Rarity): RarityRule => {
        const rule = ruleByRarity.get(rarity)
        return rule
          ? { points: rule.points, verified: rule.verified, tradeable: rule.tradeable }
          : DEFAULT_RARITY_RULES[rarity]
      },
    })

    const ref = (packId: string): PackRef => {
      const pack = index.packById(packId)
      const expansion = pack ? index.expansionById(pack.expansionId) : undefined
      return {
        packId,
        nameEs: pack?.nameEs ?? packId,
        expansionId: pack?.expansionId ?? '',
        expansionNameEs: expansion?.nameEs ?? '',
      }
    }
    const percent = (value: number) => value * 100
    return {
      model,
      alpha,
      collection,
      onlyAvailable,
      limitedBoost,
      today,
      deckTarget,
      goals: {
        decks: goals.map(({ goal, name, target, list }) => ({
          id: goal.deckId,
          name,
          priority: goal.priority,
          target,
          list,
        })),
      },
      rows: result.rows.map((row) => ({
        ...ref(row.packId),
        available: row.available,
        cardsPerPack: row.cardsPerPack,
        wanted: row.wanted,
        probability: percent(row.probability),
        expected: row.expected,
        expectedValue: row.expectedValue,
        packsFor50: row.packsFor50,
        packsFor90: row.packsFor90,
        decks: row.decks ? { probability: percent(row.decks.probability), expected: row.decks.expected } : null,
        collection: row.collection
          ? { probability: percent(row.collection.probability), expected: row.collection.expected }
          : null,
        otherModel: { ...row.otherModel, probability: percent(row.otherModel.probability) },
        limited: row.limited,
      })),
      missing: result.missing.map((item) => ({
        groupId: item.groupId,
        nameEs: item.nameEs,
        missing: item.missing,
        weight: item.weight,
        decks: item.decks,
        cheapest: item.cheapest,
        retiredCheapest: item.retiredCheapest,
        tradeable: item.tradeable,
        bestPack: item.bestPack
          ? {
              ...ref(item.bestPack.packId),
              probability: percent(item.bestPack.probability),
              packsPerCopy: item.bestPack.packsPerCopy,
              limited: item.bestPack.limited,
            }
          : null,
        afterLimited: item.afterLimited
          ? {
              ...ref(item.afterLimited.packId),
              probability: percent(item.afterLimited.probability),
              packsPerCopy: item.afterLimited.packsPerCopy,
            }
          : null,
        pointsInPacks: item.pointsInPacks,
        advice: item.advice,
      })),
      decks: result.decks.map((deck) => ({
        ...deck,
        bestPacks: deck.bestPacks.map((pack) => ({ ...ref(pack.packId), ...pack })),
      })),
      collectionOutOfPacks: result.collectionOutOfPacks,
      assumptions: ASSUMPTIONS,
    }
  }

  /**
   * Active decks with a pack priority, with the cards of their current revision or, aimed at the tournament, the
   * cards of their «versión de torneo» (decks without one keep their saved list).
   */
  private async deckGoals(
    target: DeckTarget,
  ): Promise<{ goal: DeckGoal; name: string; target: DeckTarget; list: { key: string; lists: number } | null }[]> {
    const decks = await this.prisma.deck.findMany({
      where: { archivedAt: null, packPriority: { gt: 0 } },
      select: { id: true, name: true, packPriority: true, currentRevisionId: true },
      orderBy: { id: 'asc' },
    })
    const revisionIds = decks.map((deck) => deck.currentRevisionId).filter((id): id is number => id !== null)
    const revisions = new Map(
      (
        await this.prisma.deckRevision.findMany({
          where: { id: { in: revisionIds } },
          select: { id: true, cards: true },
        })
      ).map((revision) => [revision.id, revision.cards as { cardId: string; count: number }[]]),
    )
    type Version = DeckVersionView['version']
    const versions: Map<string, Version> =
      target === 'tournament' && decks.length > 0
        ? await this.tournaments
            .deckVersions(
              {},
              decks.map((deck) => deck.id),
            )
            .then((view) => new Map(view.decks.map((deck) => [deck.deckId, deck.version])))
            .catch(() => new Map<string, Version>())
        : new Map<string, Version>()
    return decks.map((deck) => {
      const id = idToString(deck.id)
      const saved = deck.currentRevisionId === null ? [] : (revisions.get(deck.currentRevisionId) ?? [])
      const version = versions.get(id)
      const cards = version
        ? version.list.cards
            .filter((card) => card.cardId !== null)
            .map((card) => ({ cardId: card.cardId as string, count: card.count }))
        : saved
      return {
        // The missing-card rows and «Sobres para completar cada mazo» say which list is aimed at.
        goal: {
          deckId: id,
          name: version ? `${deck.name} (versión de torneo)` : deck.name,
          priority: deck.packPriority,
          cards,
        },
        name: deck.name,
        target: version ? ('tournament' as const) : ('saved' as const),
        list: version ? { key: version.list.key, lists: version.list.lists } : null,
      }
    })
  }

  /** Saved knobs, ignoring values that do not parse (a bad setting must not break the page). */
  private async savedSettings(): Promise<SavedSettings> {
    const rows = await this.prisma.appSetting.findMany({
      where: { key: { in: ['alpha', 'packModel', 'rarityFilter', 'limitedBoost', 'packDeckTarget'] } },
    })
    const out: SavedSettings = {}
    for (const row of rows) {
      if (row.key === 'alpha') {
        const parsed = settingSchemas.alpha.safeParse(row.value)
        if (parsed.success) out.alpha = parsed.data
      } else if (row.key === 'packModel') {
        const parsed = settingSchemas.packModel.safeParse(row.value)
        if (parsed.success) out.packModel = parsed.data
      } else if (row.key === 'rarityFilter') {
        const parsed = settingSchemas.rarityFilter.safeParse(row.value)
        if (parsed.success) out.rarityFilter = parsed.data
      } else if (row.key === 'limitedBoost') {
        const parsed = settingSchemas.limitedBoost.safeParse(row.value)
        if (parsed.success) out.limitedBoost = parsed.data
      } else if (row.key === 'packDeckTarget') {
        const parsed = settingSchemas.packDeckTarget.safeParse(row.value)
        if (parsed.success) out.packDeckTarget = parsed.data
      }
    }
    return out
  }
}

interface SavedSettings {
  alpha?: number
  packModel?: PackModel
  rarityFilter?: CollectionGoal | null
  limitedBoost?: number
  packDeckTarget?: DeckTarget
}

export function assertPackId(expansionId: string, name: string): string {
  if (!/^[A-Za-z0-9-]{1,10}$/.test(expansionId) || !/^[a-z0-9-]{1,60}$/.test(name)) {
    throw new BadRequestException({ code: 'validation', message: 'Sobre inválido.' })
  }
  return `${expansionId}/${name}`
}
