/**
 * Pull-rate tables of the tracker's `frontend/src/lib/stats.ts` @ 3ab58f1 (GPL-3.0, ported: docs/LICENCIAS.md),
 * checked against the official rates in docs/fase0/sobres.md §6. Percentages per position of the pack.
 */
import type { PackStructure, Rarity } from '../catalog/types.js'

export type RarityTable = Readonly<Partial<Record<Rarity, number>>>

export const STANDARD_POSITIONS_1_3: RarityTable = { '◊': 100 }
export const STANDARD_POSITION_4: RarityTable = {
  '◊◊': 90,
  '◊◊◊': 5,
  '◊◊◊◊': 1.666,
  '☆': 2.572,
  '☆☆': 0.5,
  '☆☆☆': 0.222,
  'Crown Rare': 0.04,
}
export const STANDARD_POSITION_5: RarityTable = {
  '◊◊': 60,
  '◊◊◊': 20,
  '◊◊◊◊': 6.664,
  '☆': 10.288,
  '☆☆': 2,
  '☆☆☆': 0.888,
  'Crown Rare': 0.16,
}
export const SHINY_POSITION_4: RarityTable = {
  '◊◊': 89,
  '◊◊◊': 4.9525,
  '◊◊◊◊': 1.666,
  '☆': 2.572,
  '☆☆': 0.5,
  '☆☆☆': 0.222,
  '✵': 0.71425,
  '✵✵': 0.33325,
  'Crown Rare': 0.04,
}
export const SHINY_POSITION_5: RarityTable = {
  '◊◊': 56,
  '◊◊◊': 19.81,
  '◊◊◊◊': 6.664,
  '☆': 10.288,
  '☆☆': 2,
  '☆☆☆': 0.888,
  '✵': 2.857,
  '✵✵': 1.333,
  'Crown Rare': 0.16,
}
/** Deluxe packs (4 cards). Position 3 adds up to 99.999 %, as published; kept as is (DECISIONES 4.x). */
export const DELUXE_POSITIONS: readonly RarityTable[] = [
  { '◊': 100 },
  { '◊': 17.73, '◊◊': 82.27 },
  { '◊': 23.021, '◊◊': 17.985, '◊◊◊': 40.659, '☆': 12.858, '☆☆': 2.5, '☆☆☆': 1.111, '✵✵': 1.667, 'Crown Rare': 0.198 },
  { '◊◊◊◊': 100 },
]

/** Rarities that can appear in a rare pack (5-card sets); the tracker draws them uniformly per card. */
export const RARE_PACK_RARITIES: ReadonlySet<Rarity> = new Set(['☆', '☆☆', '☆☆☆', '✵', '✵✵', 'Crown Rare'])

/** Sixth card of the 6-card packs of sets with babies (A4, A4a). */
export const BABY_SLOT: RarityTable = { '◊◊◊': 87.1, '☆': 12.9 }

/** Mix of pack kinds: regular, rare pack (5 uniform rare cards) and 6-card pack (sets with babies). */
export const PACK_MIX = {
  regular: 0.9995,
  regularWithBabies: 0.9162,
  rare: 0.0005,
  sixCards: 0.0833,
} as const

/** Rarity table of `position` (1-based) for a pack structure (tracker `getPositionProbability`). */
export function positionTable(structure: PackStructure, position: number): RarityTable {
  if (structure.cardsPerPack === 4) return DELUXE_POSITIONS[position - 1] ?? STANDARD_POSITIONS_1_3
  if (position <= 3) return STANDARD_POSITIONS_1_3
  if (position === 4) return structure.containsShinies ? SHINY_POSITION_4 : STANDARD_POSITION_4
  if (position === 5) return structure.containsShinies ? SHINY_POSITION_5 : STANDARD_POSITION_5
  throw new RangeError(`position ${position} out of a ${structure.cardsPerPack}-card pack`)
}

/** Σ of a table, in percent. */
export function tableSum(table: RarityTable): number {
  return Object.values(table).reduce<number>((sum, value) => sum + (value ?? 0), 0)
}
