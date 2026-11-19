/**
 * Reads the owner's collection as the domain objects of @tcg/domain (`StockQuantities`, `CollectionAdjustment`).
 * Writes of single rows go through Prisma; the import apply is one SQL transaction over the `pg` pool.
 */
import { Injectable } from '@nestjs/common'
import type { CollectionAdjustment, StockQuantities, StockValue } from '@tcg/domain'
import { type CollectionAdjustment as AdjustmentRow, type CollectionStock, Prisma } from '../generated/prisma/client.js'
import { idToString } from '../http/ids.js'
import { PrismaService } from '../prisma/prisma.service.js'

type StockRow = Pick<CollectionStock, 'cardId' | 'amountOwned' | 'collected'>

/**
 * R-014: a fingerprint of everything `loadStock` returns (card, copies, collected), computed by the database. It changes
 * with any write that changes those, from this process or another (a catalog sync's remap in a CLI, raw SQL, a restore
 * that brings older `updated_at` back), whatever the writer does with `updated_at`. The card id goes with its length,
 * so the text is one stock and only one.
 */
const STOCK_FINGERPRINT = Prisma.sql`
  SELECT md5(coalesce(string_agg(
    length(card_id)::text || ':' || card_id || ':' || amount_owned::text || ':' || (CASE WHEN collected THEN '1' ELSE '0' END),
    ',' ORDER BY card_id), '')) AS fingerprint
  FROM collection_stock`

export function toDomainAdjustment(row: AdjustmentRow): CollectionAdjustment {
  return {
    id: idToString(row.id),
    functionalGroupId: row.functionalGroupId,
    playableCopies: row.playableCopies,
    reason: row.reason,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    resolution: row.resolution,
  }
}

export function stockFromRows(rows: readonly Pick<CollectionStock, 'cardId' | 'amountOwned' | 'collected'>[]) {
  const stock: StockQuantities = {}
  for (const row of rows) {
    stock[row.cardId] = { stockCardId: row.cardId, amountOwned: row.amountOwned, collected: row.collected }
  }
  return stock
}

@Injectable()
export class CollectionRepository {
  /**
   * R-014: the whole stock (~2,540 rows, ~200 KB of egress per read, ~80 reads a day by 19/11/2026) with the fingerprint
   * of exactly those rows, read in one snapshot. Never stale: it is served only while the database's fingerprint now is
   * the same, that is, while the stock is the same.
   */
  private held: { fingerprint: string; rows: readonly StockRow[] } | null = null

  constructor(private readonly prisma: PrismaService) {}

  /** The whole stock, as it is now; read again only when it changed (a fresh object every call, as before). */
  async loadStock(): Promise<StockQuantities> {
    const now = readFingerprint(await this.prisma.$queryRaw<{ fingerprint: string }[]>(STOCK_FINGERPRINT))
    const held = this.held
    if (held && held.fingerprint === now) return stockFromRows(held.rows)
    // The rows and their fingerprint in the same snapshot, so the pair always matches.
    const [rows, fingerprint] = await this.prisma.$transaction(
      [
        this.prisma.collectionStock.findMany({ select: { cardId: true, amountOwned: true, collected: true } }),
        this.prisma.$queryRaw<{ fingerprint: string }[]>(STOCK_FINGERPRINT),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    )
    this.held = { fingerprint: readFingerprint(fingerprint), rows }
    return stockFromRows(rows)
  }

  async loadAdjustments(options: { active?: boolean | undefined } = {}): Promise<CollectionAdjustment[]> {
    const rows = await this.prisma.collectionAdjustment.findMany({
      where: options.active === undefined ? {} : { active: options.active },
      orderBy: { id: 'asc' },
    })
    return rows.map(toDomainAdjustment)
  }

  loadActiveAdjustments(): Promise<CollectionAdjustment[]> {
    return this.loadAdjustments({ active: true })
  }

  /** Both at once (every view needs the pair). */
  async loadState(): Promise<{ stock: StockQuantities; adjustments: CollectionAdjustment[] }> {
    const [stock, adjustments] = await Promise.all([this.loadStock(), this.loadActiveAdjustments()])
    return { stock, adjustments }
  }

  /** Upserts one stock unit edited by hand (source `manual`). */
  writeManualStock(stockCardId: string, value: StockValue): Promise<CollectionStock> {
    return this.prisma.collectionStock.upsert({
      where: { cardId: stockCardId },
      create: { cardId: stockCardId, amountOwned: value.amountOwned, collected: value.collected, source: 'manual' },
      update: { amountOwned: value.amountOwned, collected: value.collected, source: 'manual', importId: null },
    })
  }
}

function readFingerprint(rows: readonly { fingerprint: string }[]): string {
  const fingerprint = rows[0]?.fingerprint
  if (typeof fingerprint !== 'string') throw new Error('collection_stock fingerprint missing')
  return fingerprint
}
