/**
 * Extracts the `expansions` and `craftingCost` literals from the source text of the tracker's
 * `frontend/src/lib/CardsDB.ts`, and `expansionIds` from `frontend/src/types/index.ts`
 * (docs/fase0/catalogo.md §5). Both literals are plain JavaScript (objects, strings, numbers, booleans and
 * `//` comments), so the text is evaluated with `new Function` and then validated with zod. The regexes only
 * depend on the declaration name and on the closing bracket sitting at column 0, not on the type annotation.
 */
import { z } from 'zod'
import { type CraftingCost, type ExpansionId, type PackStructure, RARITIES } from './types.js'

export interface TrackerPack {
  name: string
  color: string
}

/** One entry of the tracker's `expansions` array, with optional fields made explicit. */
export interface TrackerExpansion {
  id: ExpansionId
  internalId: number
  /** Tracker slug, e.g. 'geneticapex'; key of the locale files. */
  name: string
  packs: TrackerPack[]
  tradeable: boolean
  openable: boolean
  promo: boolean
  /** `cardsPerPack` as the tracker writes it: the catalog keeps only the sizes with known rates (H-008). */
  packStructure: (Omit<PackStructure, 'cardsPerPack'> & { cardsPerPack: number }) | null
}

const trackerExpansionSchema = z.object({
  name: z.string().min(1),
  id: z.string().min(1),
  internalId: z.number().int().positive(),
  packs: z.array(z.object({ name: z.string().min(1), color: z.string() })).min(1),
  tradeable: z.boolean(),
  openable: z.boolean(),
  promo: z.boolean().optional(),
  packStructure: z
    .object({
      containsShinies: z.boolean(),
      containsBabies: z.boolean(),
      containsLinkedCards: z.boolean(),
      // H-008: any size parses; a size without known rates is left out of the pack math (with a warning).
      cardsPerPack: z.number().int().positive(),
    })
    .optional(),
})

const craftingCostSchema = z.partialRecord(z.enum(RARITIES), z.number().int().nonnegative())

export class CardsDbParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CardsDbParseError'
  }
}

/** Evaluates a JS object/array literal (comments allowed). The text comes from a pinned commit we chose. */
function evaluateLiteral(text: string, what: string): unknown {
  try {
    return new Function(`return (${text});`)()
  } catch (error) {
    throw new CardsDbParseError(`${what}: literal is not valid JavaScript (${(error as Error).message})`)
  }
}

function extractLiteral(source: string, declaration: string, open: '[' | '{', what: string): string {
  const close = open === '[' ? '\\]' : '\\}'
  // `export const <name>[: <type>] = [` … first line that is exactly `]` (or `}`) at column 0.
  const pattern = new RegExp(`export const ${declaration}\\s*(?::[^=]*)?=\\s*(\\${open}[\\s\\S]*?\\r?\\n${close})`)
  const match = pattern.exec(source)
  if (!match?.[1]) throw new CardsDbParseError(`${what}: declaration 'export const ${declaration}' not found`)
  return match[1]
}

/** The `expansions` array of CardsDB.ts in declaration order. */
export function parseExpansionsFromCardsDb(source: string): TrackerExpansion[] {
  const text = extractLiteral(source, 'expansions', '[', 'expansions')
  const raw = evaluateLiteral(text, 'expansions')
  const parsed = z.array(trackerExpansionSchema).min(1).parse(raw)
  const ids = new Set<string>()
  const internalIds = new Set<number>()
  for (const expansion of parsed) {
    if (ids.has(expansion.id)) throw new CardsDbParseError(`expansions: duplicate id ${expansion.id}`)
    if (internalIds.has(expansion.internalId)) {
      throw new CardsDbParseError(`expansions: duplicate internalId ${expansion.internalId} (${expansion.id})`)
    }
    ids.add(expansion.id)
    internalIds.add(expansion.internalId)
  }
  return parsed.map((expansion) => ({
    id: expansion.id,
    internalId: expansion.internalId,
    name: expansion.name,
    packs: expansion.packs.map((pack) => ({ name: pack.name, color: pack.color })),
    tradeable: expansion.tradeable,
    openable: expansion.openable,
    promo: expansion.promo ?? false,
    packStructure: expansion.packStructure ?? null,
  }))
}

/** The `craftingCost` object of CardsDB.ts (pack points per rarity; rarities without a cost are absent). */
export function parseCraftingCostFromCardsDb(source: string): CraftingCost {
  const text = extractLiteral(source, 'craftingCost', '{', 'craftingCost')
  const raw = evaluateLiteral(text, 'craftingCost')
  return craftingCostSchema.parse(raw)
}

/** The `expansionIds` tuple of `frontend/src/types/index.ts`, in the tracker's order (newest first, promos last). */
export function parseExpansionIds(typesIndexSource: string): ExpansionId[] {
  const match = /export const expansionIds\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(typesIndexSource)
  if (!match?.[1]) throw new CardsDbParseError("expansionIds: declaration 'export const expansionIds' not found")
  const ids = [...match[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => (m[1] ?? m[2]) as string)
  if (ids.length === 0) throw new CardsDbParseError('expansionIds: no ids found')
  return ids
}
