/**
 * Persistence of a built `Catalog`. Writes are bulk upserts in one SQL transaction over the `pg` pool (4.3 k cards
 * in a handful of statements); reads go through Prisma and rebuild the domain `Catalog` in catalog order.
 * Rows that disappeared from the catalog are deleted; a card still referenced by the collection or a deck makes the
 * transaction fail (the remap of invariant I12 is a TODO: the sync is then recorded as failed).
 */
import { Injectable } from '@nestjs/common'
import type {
  Ability,
  Attack,
  BuildCounts,
  CardEdition,
  CardType,
  Catalog,
  CraftingCost,
  EnergyType,
  EvolutionType,
  Expansion,
  FunctionalGroup,
  NameEsSource,
  Pack,
  Rarity,
  StockUnit,
} from '@tcg/domain'
import { DEFAULT_RARITY_RULES, PACKS_LIMITED_BY_DEFAULT, PACKS_OFF_BY_DEFAULT } from '@tcg/domain'
import type { CatalogSync } from '../generated/prisma/client.js'
import type { CatalogSyncStatus } from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { deleteNotIn, insertMany, upsertMany } from '../prisma/sql.js'

/** Rarities tradeable by default (PLAN §8 B9); ✵/✵✵ costs stay "unverified" until confirmed in game. */
const DEFAULT_TRADEABLE: ReadonlySet<string> = new Set(['◊', '◊◊', '◊◊◊', '◊◊◊◊', '☆'])
/** Printed evolution exceptions (DECISIONES 0.15). */
const EVOLUTION_ALIASES: ReadonlyArray<{ nameEn: string; countsAs: string }> = [
  { nameEn: 'Eevee ex', countsAs: 'Eevee' },
]

function json(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value)
}

export interface LoadedCatalog {
  catalog: Catalog
  sync: CatalogSync
}

export interface ReplaceResult {
  deleted: { cards: number; groups: number; packs: number; expansions: number }
}

export interface SyncChangeRow {
  cardId: string
  field: string
  old: unknown
  new: unknown
}

/** What gets recorded on the `catalog_syncs` row (and `catalog_sync_changes`) together with the catalog itself. */
export interface SyncOutcome {
  syncId: number
  status: Extract<CatalogSyncStatus, 'applied' | 'needs_review'>
  counts: BuildCounts
  craftingCost: CraftingCost
  report: unknown
  changes: readonly SyncChangeRow[]
}

@Injectable()
export class CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Full upsert of every catalog table plus the sync record (`catalog_syncs` status/report and its change rows) in
   * one transaction: the tables and the row that says which commit they hold can never disagree.
   */
  async replaceCatalog(catalog: Catalog, outcome: SyncOutcome): Promise<ReplaceResult> {
    const client = await this.prisma.pool.connect()
    try {
      await client.query('BEGIN')

      await upsertMany(
        client,
        'expansions',
        [
          'id',
          'tracker_internal_id',
          'slug',
          'name_en',
          'name_es',
          'sort_order',
          'is_promo',
          'tradeable',
          'openable_tracker',
          'cards_per_pack',
          'contains_shinies',
          'contains_babies',
          'contains_linked_cards',
        ],
        catalog.expansions.map((expansion) => [
          expansion.id,
          expansion.trackerInternalId,
          expansion.slug,
          expansion.nameEn,
          expansion.nameEs,
          expansion.sortOrder,
          expansion.isPromo,
          expansion.tradeable,
          expansion.openableTracker,
          expansion.packStructure?.cardsPerPack ?? null,
          expansion.packStructure?.containsShinies ?? false,
          expansion.packStructure?.containsBabies ?? false,
          expansion.packStructure?.containsLinkedCards ?? false,
        ]),
        ['id'],
      )

      await upsertMany(
        client,
        'packs',
        ['id', 'expansion_id', 'name', 'name_es', 'color', 'sort_order', 'available', 'limited', 'limited_until'],
        catalog.packs.map((pack, index) => [
          pack.id,
          pack.expansionId,
          pack.name,
          pack.nameEs,
          pack.color,
          index,
          !PACKS_OFF_BY_DEFAULT.has(pack.id),
          PACKS_LIMITED_BY_DEFAULT.has(pack.id),
          PACKS_LIMITED_BY_DEFAULT.get(pack.id) ?? null,
        ]),
        ['id'],
        // «Disponible» and «tiempo limitado» are the owner's switches: a new pack gets the default, a known pack keeps
        // what was chosen.
        { insertOnly: ['available', 'limited', 'limited_until'], casts: { limited_until: '$n::date' } },
      )

      await upsertMany(
        client,
        'functional_groups',
        ['id', 'display_card_id', 'name_en', 'name_es', 'card_type', 'rules_hash', 'edition_count', 'sort_order'],
        catalog.groups.map((group, index) => [
          group.id,
          group.displayCardId,
          group.nameEn,
          group.nameEs,
          group.cardType,
          group.rulesHash,
          group.cardIds.length,
          index,
        ]),
        ['id'],
      )

      await upsertMany(
        client,
        'cards',
        [
          'id',
          'expansion_id',
          'number',
          'internal_id',
          'stock_card_id',
          'functional_group_id',
          'is_display_edition',
          'name_en',
          'name_es',
          'name_es_source',
          'hp',
          'energy',
          'card_type',
          'evolution_type',
          'evolves_from',
          'is_fossil',
          'ex',
          'prize_points',
          'baby',
          'rarity',
          'pack',
          'artist',
          'attacks',
          'ability',
          'weakness',
          'retreat',
          'image_url',
          'engine_id',
          'search_text',
          'alternate_versions_raw',
          'sort_order',
        ],
        catalog.cards.map((card, index) => [
          card.id,
          card.expansionId,
          card.number,
          card.internalId,
          card.stockCardId,
          card.functionalGroupId,
          card.isDisplayEdition,
          card.nameEn,
          card.nameEs,
          card.nameEsSource,
          card.hp,
          card.energy,
          card.cardType,
          card.evolutionType,
          card.evolvesFrom,
          card.isFossil,
          card.ex,
          card.prizePoints,
          card.baby,
          card.rarity,
          card.pack,
          card.artist,
          json(card.attacks),
          json(card.ability),
          card.weakness,
          card.retreat,
          card.imageUrl,
          card.engineId,
          card.searchText,
          card.alternateVersionsRaw,
          index,
        ]),
        ['id'],
      )

      // Materializations are rebuilt from scratch (nothing references them).
      await client.query('DELETE FROM "pack_cards"')
      await upsertMany(
        client,
        'pack_cards',
        ['pack_id', 'card_id', 'position'],
        catalog.packs.flatMap((pack) => pack.cardIds.map((cardId, position) => [pack.id, cardId, position])),
        ['pack_id', 'card_id'],
      )
      await client.query('DELETE FROM "evolution_aliases"')
      await upsertMany(
        client,
        'evolution_aliases',
        ['card_id', 'counts_as'],
        catalog.cards.flatMap((card) =>
          EVOLUTION_ALIASES.filter((alias) => alias.nameEn === card.nameEn).map((alias) => [card.id, alias.countsAs]),
        ),
        ['card_id'],
      )
      // Rarity rules are owner configuration (DECISIONES 1.10): new rarities are seeded, existing rows are never
      // overwritten (`points_verified` and `tradeable` are the owner's, and `points` may have been corrected by hand).
      await upsertMany(
        client,
        'rarity_rules',
        ['rarity', 'points', 'points_verified', 'tradeable'],
        // Tracker craftingCost first; rarities it lacks (✵, ✵✵) come from the domain defaults, unverified.
        Object.entries({
          ...Object.fromEntries(
            Object.entries(DEFAULT_RARITY_RULES)
              .filter(([, rule]) => rule.points !== null)
              .map(([rarity, rule]) => [rarity, rule.points]),
          ),
          ...catalog.craftingCost,
        }).map(([rarity, points]) => [rarity, points, false, DEFAULT_TRADEABLE.has(rarity)]),
        ['rarity'],
        { action: 'nothing' },
      )

      const deleted = {
        cards: await deleteNotIn(
          client,
          'cards',
          'id',
          catalog.cards.map((card) => card.id),
        ),
        groups: await deleteNotIn(
          client,
          'functional_groups',
          'id',
          catalog.groups.map((group) => group.id),
        ),
        packs: await deleteNotIn(
          client,
          'packs',
          'id',
          catalog.packs.map((pack) => pack.id),
        ),
        expansions: await deleteNotIn(
          client,
          'expansions',
          'id',
          catalog.expansions.map((expansion) => expansion.id),
        ),
      }

      await insertMany(
        client,
        'catalog_sync_changes',
        ['sync_id', 'card_id', 'field', 'old', 'new'],
        outcome.changes.map((change) => [
          outcome.syncId,
          change.cardId,
          change.field,
          json(change.old),
          json(change.new),
        ]),
      )
      await client.query(
        `UPDATE "catalog_syncs"
           SET "status" = $2::"catalog_sync_status", "applied_at" = now(), "counts" = $3, "crafting_cost" = $4, "report" = $5
         WHERE "id" = $1`,
        [
          outcome.syncId,
          outcome.status,
          json({ ...outcome.counts, deleted }),
          json(outcome.craftingCost),
          json(outcome.report),
        ],
      )

      await client.query('COMMIT')
      return { deleted }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  /** True when the owner's data references the catalog (collection stock, adjustments or deck cards). */
  async hasOwnerData(): Promise<boolean> {
    const [stock, adjustments, deckCards] = await Promise.all([
      this.prisma.collectionStock.count(),
      this.prisma.collectionAdjustment.count(),
      this.prisma.deckCard.count(),
    ])
    return stock + adjustments + deckCards > 0
  }

  latestAppliedSync(): Promise<CatalogSync | null> {
    return this.prisma.catalogSync.findFirst({
      where: { status: { in: ['applied', 'needs_review'] } },
      orderBy: { id: 'desc' },
    })
  }

  /** Rebuilds the domain `Catalog` from the tables (null before the first sync). */
  async loadCatalog(): Promise<LoadedCatalog | null> {
    const sync = await this.latestAppliedSync()
    if (!sync) return null
    const [expansionRows, packRows, packCardRows, groupRows, cardRows] = await Promise.all([
      this.prisma.expansion.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.pack.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.packCard.findMany({ orderBy: [{ packId: 'asc' }, { position: 'asc' }] }),
      this.prisma.functionalGroup.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.card.findMany({ orderBy: { sortOrder: 'asc' } }),
    ])
    if (cardRows.length === 0) return null

    const cards: CardEdition[] = cardRows.map((row) => ({
      id: row.id,
      expansionId: row.expansionId,
      number: row.number,
      internalId: row.internalId,
      stockCardId: row.stockCardId,
      functionalGroupId: row.functionalGroupId,
      isDisplayEdition: row.isDisplayEdition,
      nameEn: row.nameEn,
      nameEs: row.nameEs,
      nameEsSource: row.nameEsSource as NameEsSource,
      hp: row.hp,
      energy: row.energy as EnergyType | 'trainer',
      cardType: row.cardType as CardType,
      evolutionType: row.evolutionType as EvolutionType,
      evolvesFrom: row.evolvesFrom,
      isFossil: row.isFossil,
      ex: row.ex,
      prizePoints: row.prizePoints as 0 | 1 | 2 | 3,
      baby: row.baby,
      rarity: row.rarity as Rarity,
      pack: row.pack,
      artist: row.artist,
      attacks: row.attacks as unknown as Attack[],
      ability: row.ability as unknown as Ability | null,
      weakness: row.weakness as EnergyType | null,
      retreat: row.retreat,
      imageUrl: row.imageUrl,
      engineId: row.engineId,
      searchText: row.searchText,
      alternateVersionsRaw: row.alternateVersionsRaw,
    }))

    const cardIdsByGroup = new Map<string, string[]>()
    const stockIdsByGroup = new Map<string, string[]>()
    const stockUnitsById = new Map<string, StockUnit>()
    for (const card of cards) {
      const groupCards = cardIdsByGroup.get(card.functionalGroupId)
      if (groupCards) groupCards.push(card.id)
      else cardIdsByGroup.set(card.functionalGroupId, [card.id])
      const unit = stockUnitsById.get(card.stockCardId)
      if (unit) unit.cardIds.push(card.id)
      else {
        stockUnitsById.set(card.stockCardId, {
          id: card.stockCardId,
          internalId: card.internalId,
          functionalGroupId: card.functionalGroupId,
          cardIds: [card.id],
        })
        const groupStocks = stockIdsByGroup.get(card.functionalGroupId)
        if (groupStocks) groupStocks.push(card.stockCardId)
        else stockIdsByGroup.set(card.functionalGroupId, [card.stockCardId])
      }
    }
    const groups: FunctionalGroup[] = groupRows.map((row) => ({
      id: row.id,
      displayCardId: row.displayCardId,
      nameEn: row.nameEn,
      nameEs: row.nameEs,
      cardType: row.cardType as CardType,
      rulesHash: row.rulesHash,
      cardIds: cardIdsByGroup.get(row.id) ?? [],
      stockCardIds: stockIdsByGroup.get(row.id) ?? [],
    }))

    const cardIdsByPack = new Map<string, string[]>()
    for (const row of packCardRows) {
      const list = cardIdsByPack.get(row.packId)
      if (list) list.push(row.cardId)
      else cardIdsByPack.set(row.packId, [row.cardId])
    }
    const packs: Pack[] = packRows.map((row) => ({
      id: row.id,
      expansionId: row.expansionId,
      name: row.name,
      nameEs: row.nameEs,
      color: row.color,
      cardIds: cardIdsByPack.get(row.id) ?? [],
    }))
    const packIdsByExpansion = new Map<string, string[]>()
    for (const pack of packs) {
      const list = packIdsByExpansion.get(pack.expansionId)
      if (list) list.push(pack.id)
      else packIdsByExpansion.set(pack.expansionId, [pack.id])
    }
    const expansions: Expansion[] = expansionRows.map((row) => ({
      id: row.id,
      trackerInternalId: row.trackerInternalId,
      slug: row.slug,
      nameEn: row.nameEn,
      nameEs: row.nameEs,
      sortOrder: row.sortOrder,
      isPromo: row.isPromo,
      tradeable: row.tradeable,
      openableTracker: row.openableTracker,
      packStructure: row.isPromo
        ? null
        : {
            cardsPerPack: (row.cardsPerPack ?? 5) as 4 | 5,
            containsShinies: row.containsShinies,
            containsBabies: row.containsBabies,
            containsLinkedCards: row.containsLinkedCards,
          },
      packIds: packIdsByExpansion.get(row.id) ?? [],
    }))

    const catalog: Catalog = {
      trackerCommit: sync.commitSha,
      engineRev: sync.engineRev,
      expansions,
      packs,
      cards,
      groups,
      stockUnits: [...stockUnitsById.values()],
      craftingCost: (sync.craftingCost ?? {}) as CraftingCost,
    }
    return { catalog, sync }
  }
}
