/**
 * Extracts the `expansions` and `craftingCost` literals from the source text of the tracker's
 * `frontend/src/lib/CardsDB.ts`, and `expansionIds` from `frontend/src/types/index.ts`
 * (docs/fase0/catalogo.md §5). Both literals are plain JavaScript (objects, strings, numbers, booleans and
 * `//` comments): the text is parsed as a data literal (`parseJsLiteral`, never evaluated: since Fase 40 it can come
 * from a tracker commit nobody reviewed) and then validated with zod. The regexes only
 * depend on the declaration name and on the closing bracket sitting at column 0, not on the type annotation.
 */
import { z } from 'zod'
import { LiteralParseError, parseJsLiteral } from './literal.js'
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

/**
 * The tracker renamed `containsBabies` to `containSixthCardBabies` on 15/10/2026 (aac8d456, «Add deluxe mega pack
 * odds»), same meaning: the 6-card pack that brings the babies. Either name is read; with both, they must agree.
 */
const trackerPackStructureSchema = z
  .object({
    containsShinies: z.boolean(),
    containsBabies: z.boolean().optional(),
    containSixthCardBabies: z.boolean().optional(),
    containsLinkedCards: z.boolean(),
    // H-008: any size parses; a size without known rates is left out of the pack math (with a warning).
    cardsPerPack: z.number().int().positive(),
  })
  .transform((structure, ctx) => {
    const { containsBabies: before, containSixthCardBabies: after } = structure
    if (before === undefined && after === undefined) {
      ctx.addIssue({ code: 'custom', message: 'packStructure: containSixthCardBabies (or containsBabies) is missing' })
      return z.NEVER
    }
    if (before !== undefined && after !== undefined && before !== after) {
      ctx.addIssue({ code: 'custom', message: 'packStructure: containsBabies and containSixthCardBabies disagree' })
      return z.NEVER
    }
    return {
      containsShinies: structure.containsShinies,
      containsBabies: (after ?? before) as boolean,
      containsLinkedCards: structure.containsLinkedCards,
      cardsPerPack: structure.cardsPerPack,
    }
  })

const trackerExpansionSchema = z.object({
  name: z.string().min(1),
  id: z.string().min(1),
  internalId: z.number().int().positive(),
  packs: z.array(z.object({ name: z.string().min(1), color: z.string() })).min(1),
  tradeable: z.boolean(),
  openable: z.boolean(),
  promo: z.boolean().optional(),
  packStructure: trackerPackStructureSchema.optional(),
})

const craftingCostSchema = z.partialRecord(z.enum(RARITIES), z.number().int().nonnegative())

export class CardsDbParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CardsDbParseError'
  }
}

/** Parses a JS object/array literal (comments allowed); anything that is not data is refused, nothing runs. */
function evaluateLiteral(text: string, what: string): unknown {
  try {
    return parseJsLiteral(text)
  } catch (error) {
    // Only the literal parser's own refusal is about the data; anything else is a bug and stays one.
    if (!(error instanceof LiteralParseError)) throw error
    throw new CardsDbParseError(`${what}: not a plain data literal (${error.message})`)
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
