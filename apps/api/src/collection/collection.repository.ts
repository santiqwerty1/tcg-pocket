/**
 * Reads the owner's collection as the domain objects of @tcg/domain (`StockQuantities`, `CollectionAdjustment`).
 * Writes of single rows go through Prisma; the import apply is one SQL transaction over the `pg` pool.
 */
import { Injectable } from '@nestjs/common'
import type { CollectionAdjustment, StockQuantities, StockValue } from '@tcg/domain'
import type { CollectionAdjustment as AdjustmentRow, CollectionStock } from '../generated/prisma/client.js'
import { idToString } from '../http/ids.js'
import { PrismaService } from '../prisma/prisma.service.js'

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
  constructor(private readonly prisma: PrismaService) {}

  async loadStock(): Promise<StockQuantities> {
    return stockFromRows(await this.prisma.collectionStock.findMany())
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
