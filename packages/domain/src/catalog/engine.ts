/**
 * Bridge between the tracker's card ids and the deckgym engine (`refs/deckgym-core/database.json` @ fb792ebf; sin cambios hasta 33ff2a5, el motor del 8/10/2026).
 * The engine contributes `evolves_from` (the tracker has no pre-evolution), `trainer_card_type = Fossil` and
 * the engine id; everything else is cross-checked and the tracker wins on conflicts (PLAN §3.1).
 */
import { type EngineCard, parseEngineCards } from './schemas.js'
import type { CardId, EvolutionType, ExpansionId, Rarity } from './types.js'

const ENGINE_ID_PATTERN = /^(.+) (\d{3})$/
const STAGE_TO_EVOLUTION: Record<number, EvolutionType> = { 0: 'basic', 1: 'stage1', 2: 'stage2' }

/** 'A1a-1' → 'A1a 001', 'P-A-7' → 'P-A 007'. */
export function trackerIdToEngineId(cardId: CardId): string {
  const dash = cardId.lastIndexOf('-')
  if (dash <= 0 || dash === cardId.length - 1) throw new Error(`Invalid tracker card id: '${cardId}'`)
  const expansion = cardId.slice(0, dash)
  const number = cardId.slice(dash + 1)
  if (!/^\d+$/.test(number)) throw new Error(`Invalid tracker card id: '${cardId}'`)
  return `${expansion} ${number.padStart(3, '0')}`
}

/** 'A1a 001' → 'A1a-1', 'P-A 007' → 'P-A-7'. */
export function engineIdToTrackerId(engineId: string): CardId {
  const match = ENGINE_ID_PATTERN.exec(engineId)
  if (!match?.[1] || !match[2]) throw new Error(`Invalid engine card id: '${engineId}'`)
  return `${match[1]}-${Number.parseInt(match[2], 10)}`
}

export function isPromoExpansion(expansionId: ExpansionId): boolean {
  return expansionId.startsWith('P-')
}

/** deckgym rarity symbols → tracker rarities ('*' ✵, '**' ✵✵, '♛' Crown Rare); promo sets are always 'P'. */
export function normalizeEngineRarity(rarity: string, expansionId: ExpansionId): Rarity {
  if (isPromoExpansion(expansionId)) return 'P'
  switch (rarity) {
    case '*':
      return '✵'
    case '**':
      return '✵✵'
    case '♛':
      return 'Crown Rare'
    case '◊':
    case '◊◊':
    case '◊◊◊':
    case '◊◊◊◊':
    case '☆':
    case '☆☆':
    case '☆☆☆':
      return rarity
    default:
      throw new Error(`Unknown engine rarity: '${rarity}'`)
  }
}

export type EngineConflictField = 'name' | 'cardType' | 'hp' | 'evolutionType' | 'energy' | 'rarity'

export interface EngineConflict {
  cardId: CardId
  field: EngineConflictField
  tracker: string | number | null
  engine: string | number | null
}

export interface EngineJoinEntry {
  engineId: string
  /** English name of the pre-evolution; null for basics and trainers. */
  evolvesFrom: string | null
  isFossil: boolean
}

export interface EngineJoin {
  byCardId: Map<CardId, EngineJoinEntry>
  /** Fields where the tracker and the engine disagree; the tracker's value is the one in the catalog. */
  conflicts: EngineConflict[]
  /** Tracker cards without an engine entry (evolvesFrom/isFossil default to null/false). */
  missingInEngine: CardId[]
  /** Engine entries without a tracker card. */
  unmatchedEngineIds: string[]
}

/** The tracker fields the join reads; a parsed `TrackerCard` satisfies it. */
export interface EngineJoinCard {
  card_id: CardId
  expansion: ExpansionId
  name: string
  card_type: 'pokémon' | 'trainer'
  evolution_type: EvolutionType
  energy: string
  /** Every printed type (C1: two for the dual-type Pokémon); absent means `[energy]`. */
  types?: readonly string[] | undefined
  hp?: number | undefined
  rarity: Rarity
}

/** The engine's printed types as it writes them («Psychic»): `energyTypes` when it gives two, else `[energyType]`. */
function engineTypesOf(engine: { energyType: string; energyTypes?: string[] | undefined }): string[] {
  return engine.energyTypes && engine.energyTypes.length > 0 ? engine.energyTypes : [engine.energyType]
}

/** Same set of types, case and order aside (the tracker and the engine may write a dual type in different orders). */
function sameTypes(a: readonly string[], b: readonly string[]): boolean {
  const lower = (list: readonly string[]) => list.map((type) => type.toLowerCase())
  const [x, y] = [lower(a), lower(b)]
  return x.length === y.length && x.every((type) => y.includes(type))
}

export function joinEngineData(cards: readonly EngineJoinCard[], engineCards: readonly EngineCard[]): EngineJoin {
  const engineById = new Map<string, EngineCard>()
  for (const entry of engineCards) engineById.set(entry.id, entry)
  const byCardId = new Map<CardId, EngineJoinEntry>()
  const conflicts: EngineConflict[] = []
  const missingInEngine: CardId[] = []
  const matched = new Set<string>()

  for (const card of cards) {
    const engineId = trackerIdToEngineId(card.card_id)
    const engine = engineById.get(engineId)
    if (!engine) {
      missingInEngine.push(card.card_id)
      byCardId.set(card.card_id, { engineId, evolvesFrom: null, isFossil: false })
      continue
    }
    matched.add(engineId)
    const conflict = (
      field: EngineConflictField,
      tracker: string | number | null,
      engineValue: string | number | null,
    ) => conflicts.push({ cardId: card.card_id, field, tracker, engine: engineValue })

    if (card.name !== engine.name) conflict('name', card.name, engine.name)
    const trackerIsTrainer = card.card_type === 'trainer'
    if (trackerIsTrainer !== (engine.kind === 'trainer')) {
      conflict('cardType', trackerIsTrainer ? 'trainer' : 'pokemon', engine.kind)
    }
    let rarity: Rarity | null = null
    try {
      rarity = normalizeEngineRarity(engine.rarity, card.expansion)
    } catch {
      rarity = null
    }
    if (rarity !== card.rarity) conflict('rarity', card.rarity, rarity ?? engine.rarity)

    if (engine.kind === 'pokemon') {
      if ((card.hp ?? null) !== engine.hp) conflict('hp', card.hp ?? null, engine.hp)
      const stage = STAGE_TO_EVOLUTION[engine.stage] ?? null
      if (stage !== card.evolution_type) conflict('evolutionType', card.evolution_type, stage ?? engine.stage)
      const trackerTypes = card.types && card.types.length > 0 ? [...card.types] : [card.energy]
      const engineTypes = engineTypesOf(engine)
      if (!sameTypes(trackerTypes, engineTypes)) conflict('energy', trackerTypes.join('/'), engineTypes.join('/'))
      byCardId.set(card.card_id, { engineId, evolvesFrom: engine.evolvesFrom ?? null, isFossil: false })
    } else {
      byCardId.set(card.card_id, { engineId, evolvesFrom: null, isFossil: engine.trainerType === 'Fossil' })
    }
  }

  const unmatchedEngineIds = engineCards.map((entry) => entry.id).filter((id) => !matched.has(id))
  return { byCardId, conflicts, missingInEngine, unmatchedEngineIds }
}

/**
 * deckgym's printed type: `energy_type` (one, as until B4b). For C1 it may add a second one apart
 * (`secondary_energy_type`) or turn it into a list (`energy_types`, or `energy_type` itself): proposed upstream on
 * 22/10/2026, still undecided, so the three shapes are read. An empty list or a null second type count as absent; a
 * list that leaves out `energy_type` is an error, and a malformed value is left for the schema to refuse. Exported for
 * `scripts/extract-fixtures.mjs`, so the fixtures and a real sync read the same shapes (Codex on #149).
 */
export function engineTypeFields(v: Record<string, unknown>): { energyType: unknown; energyTypes?: unknown } {
  const listOf = (value: unknown) => (Array.isArray(value) && value.length > 0 ? value : null)
  const list = listOf(v.energy_types) ?? listOf(v.energy_type)
  if (list) {
    if (typeof v.energy_type === 'string' && !list.includes(v.energy_type)) {
      throw new Error(`${String(v.id)}: energy_type ${v.energy_type} is not in energy_types`)
    }
    return { energyType: list[0], energyTypes: list }
  }
  if (v.secondary_energy_type !== undefined && v.secondary_energy_type !== null) {
    return { energyType: v.energy_type, energyTypes: [v.energy_type, v.secondary_energy_type] }
  }
  return { energyType: v.energy_type }
}

/**
 * Reduces raw deckgym `database.json` entries (`{ Pokemon: {...} } | { Trainer: {...} }`) to `EngineCard`.
 * Mirrors `scripts/extract-fixtures.mjs`, so the sync job and the fixtures produce the same shape.
 */
export function engineCardsFromDatabaseJson(json: unknown): EngineCard[] {
  if (!Array.isArray(json)) throw new Error('deckgym database.json must be an array')
  const reduced = json.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('deckgym database.json: invalid entry')
    const record = entry as Record<string, Record<string, unknown>>
    if (record.Pokemon) {
      const v = record.Pokemon
      return {
        id: v.id,
        kind: 'pokemon',
        name: v.name,
        stage: v.stage,
        evolvesFrom: v.evolves_from ?? null,
        hp: v.hp,
        ...engineTypeFields(v),
        rarity: v.rarity,
      }
    }
    if (record.Trainer) {
      const v = record.Trainer
      return { id: v.id, kind: 'trainer', name: v.name, trainerType: v.trainer_card_type, rarity: v.rarity }
    }
    throw new Error(`deckgym database.json: unknown entry kind ${Object.keys(record).join(',')}`)
  })
  return parseEngineCards(reduced)
}
