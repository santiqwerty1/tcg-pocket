/**
 * Packs (PLAN §3.4, M4; Fase 4): the owner's «disponible» switch per pack, the rarity rules (points, trade) and the
 * recommendation. Goals come from the decks with `packPriority` > 0 and the collection goal; defaults from
 * `app_settings` (`alpha`, `packModel`, `rarityFilter`). The model lives in @tcg/domain.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  type CollectionGoal,
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
import { idToString } from '../http/ids.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { PackRef, PackView, RarityRuleView, RecommendationView } from './pack-views.js'

export interface RecommendBody {
  model?: PackModel | undefined
  alpha?: number | undefined
  /** null = no collection goal; undefined = the saved one (or all rarities, 1 copy). */
  collection?: CollectionGoal | null | undefined
  onlyAvailable?: boolean | undefined
}

export const DEFAULT_ALPHA = 0.7
export const DEFAULT_COLLECTION_GOAL: CollectionGoal = { rarities: [], copies: 1 }

const settingSchemas = {
  alpha: z.number().min(0).max(1),
  packModel: z.enum(['corrected', 'tracker']),
  rarityFilter: z.object({ rarities: z.array(z.enum(RARITIES)), copies: z.number().int().min(1).max(5) }).nullable(),
}

const ASSUMPTIONS = [
  'Tasas por posición constantes (tablas oficiales), sin «pity» ni rachas.',
  'Las posiciones de un sobre son independientes y una carta puede repetirse en el mismo sobre.',
  'Sobre raro (0,05 %) con cartas uniformes entre las elegibles; los Deluxe sin sobre raro.',
  'En sets con bebés, 8,33 % de sobres de 6 cartas con la sexta para bebés.',
  'Los puntos de sobre son de la expansión: 5 por sobre abierto. Costos ✵/✵✵ sin verificar.',
  'Cada sobre se evalúa solo; la mejor política es volver a mirar después de cada importación.',
]

@Injectable()
export class PacksService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly prisma: PrismaService,
    private readonly collection: CollectionRepository,
  ) {}

  /** Packs that can be opened (with a pack structure; the set-wide «everypack» of multi-pack sets is not one). */
  async list(): Promise<PackView[]> {
    const index = this.catalog.requireIndex()
    const rows = await this.prisma.pack.findMany({ select: { id: true, available: true } })
    const available = new Map(rows.map((row) => [row.id, row.available]))
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
          available: available.get(pack.id) ?? true,
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

  async setAvailable(packId: string, available: boolean): Promise<PackView> {
    const pack = (await this.list()).find((item) => item.id === packId)
    if (!pack) throw new NotFoundException(`Sobre ${packId} no encontrado.`)
    await this.prisma.pack.update({ where: { id: packId }, data: { available } })
    return { ...pack, available }
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

    const [{ stock, adjustments }, packRows, rules, goals] = await Promise.all([
      this.collection.loadState(),
      this.prisma.pack.findMany({ select: { id: true, available: true } }),
      this.rarityRules(),
      this.deckGoals(),
    ])
    const playable = new Map(
      [...playableCopies(index, stock, adjustments)].map(([groupId, copies]) => [groupId, copies.playable]),
    )
    const available = new Map(packRows.map((row) => [row.id, row.available]))
    const ruleByRarity = new Map(rules.map((rule) => [rule.rarity, rule]))
    const result = recommendPacks({
      index,
      decks: goals,
      collection,
      alpha,
      playable: (groupId) => playable.get(groupId) ?? 0,
      owned: (stockCardId) => stock[stockCardId]?.amountOwned ?? 0,
      available: (packId) => available.get(packId) ?? true,
      model,
      onlyAvailable,
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
      goals: { decks: goals.map((goal) => ({ id: goal.deckId, name: goal.name, priority: goal.priority })) },
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
      })),
      missing: result.missing.map((item) => ({
        groupId: item.groupId,
        nameEs: item.nameEs,
        missing: item.missing,
        weight: item.weight,
        decks: item.decks,
        cheapest: item.cheapest,
        bestPack: item.bestPack
          ? {
              ...ref(item.bestPack.packId),
              probability: percent(item.bestPack.probability),
              packsPerCopy: item.bestPack.packsPerCopy,
            }
          : null,
        pointsInPacks: item.pointsInPacks,
        advice: item.advice,
      })),
      decks: result.decks.map((deck) => ({
        ...deck,
        bestPacks: deck.bestPacks.map((pack) => ({ ...ref(pack.packId), ...pack })),
      })),
      assumptions: ASSUMPTIONS,
    }
  }

  /** Active decks with a pack priority, with the cards of their current revision. */
  private async deckGoals(): Promise<DeckGoal[]> {
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
    return decks.map((deck) => ({
      deckId: idToString(deck.id),
      name: deck.name,
      priority: deck.packPriority,
      cards: deck.currentRevisionId === null ? [] : (revisions.get(deck.currentRevisionId) ?? []),
    }))
  }

  /** Saved knobs, ignoring values that do not parse (a bad setting must not break the page). */
  private async savedSettings(): Promise<{
    alpha?: number
    packModel?: PackModel
    rarityFilter?: CollectionGoal | null
  }> {
    const rows = await this.prisma.appSetting.findMany({
      where: { key: { in: ['alpha', 'packModel', 'rarityFilter'] } },
    })
    const out: { alpha?: number; packModel?: PackModel; rarityFilter?: CollectionGoal | null } = {}
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
      }
    }
    return out
  }
}

export function assertPackId(expansionId: string, name: string): string {
  if (!/^[A-Za-z0-9-]{1,10}$/.test(expansionId) || !/^[a-z0-9-]{1,60}$/.test(name)) {
    throw new BadRequestException({ code: 'validation', message: 'Sobre inválido.' })
  }
  return `${expansionId}/${name}`
}
