/**
 * Deck vocabulary shared by the parsers, writers and validators (docs/PLAN.md §3.3, §4.2 "Mazos"):
 * - DeckDraft: the content of a deck as edited or imported, before persistence. Every card keeps its edition
 *   (`cardId`, I7) and entries stay in the order they were written.
 * - ParseResult / ParseIssue: outcome of the text importers. Messages are in Spanish; codes are stable identifiers.
 */
import { foldText } from '../catalog/normalize.js'
import { type CardId, SELECTABLE_ENERGIES, type SelectableEnergy } from '../catalog/types.js'

export interface DeckCardEntry {
  cardId: CardId
  count: number
}

export interface DeckDraft {
  name?: string | undefined
  /** Energies chosen for the Energy Zone (may be empty: the validator reports `energy_required`). */
  energies: SelectableEnergy[]
  /** Entries in the order they were written; the same `cardId` may appear more than once. */
  cards: DeckCardEntry[]
  notes?: string | undefined
  /** Where the draft came from: 'spanish_text', 'line_format', 'limitless_standings', 'json', 'ui'… */
  source?: string | undefined
}

export type ParseIssueCode =
  | 'unknown_card'
  | 'ambiguous_name'
  | 'name_mismatch'
  | 'wrong_section'
  | 'energy_missing'
  | 'energy_choice_required'
  | 'unknown_energy'
  | 'energy_not_selectable'
  | 'invalid_line'
  | 'invalid_count'
  | 'invalid_json'
  | 'empty'

export interface ParseIssue {
  code: ParseIssueCode
  /** Spanish, user-facing. */
  message: string
  /** 1-based line of the input the issue refers to, when known. */
  line?: number | undefined
  /** Alternatives offered to the user (`nameEs (cardId)` for ambiguous names, names for typos). */
  candidates?: string[] | undefined
}

/** `value` is null exactly when `errors` is not empty: a draft is returned only when every line resolved. */
export interface ParseResult<T> {
  value: T | null
  errors: ParseIssue[]
  warnings: ParseIssue[]
}

/** Thrown by the writers when a draft cannot be rendered (unknown edition, missing energy, count > 9…). */
export class DeckFormatError extends Error {
  readonly code: ParseIssueCode | 'energy_required'
  constructor(code: ParseIssueCode | 'energy_required', message: string) {
    super(message)
    this.name = 'DeckFormatError'
    this.code = code
  }
}

/** Spanish energy names as the game prints them and as `mazos_40_listas.md` writes them. */
export const ENERGY_NAME_ES: Record<SelectableEnergy, string> = {
  grass: 'Planta',
  fire: 'Fuego',
  water: 'Agua',
  lightning: 'Rayo',
  psychic: 'Psíquico',
  fighting: 'Lucha',
  darkness: 'Oscuridad',
  metal: 'Metal',
}

/** English energy names used by deckgym (`src/models/card.rs:39-53`) and the Limitless standings API. */
export const ENERGY_NAME_EN: Record<SelectableEnergy, string> = {
  grass: 'Grass',
  fire: 'Fire',
  water: 'Water',
  lightning: 'Lightning',
  psychic: 'Psychic',
  fighting: 'Fighting',
  darkness: 'Darkness',
  metal: 'Metal',
}

/** Spanish names of the two energies that exist on cards but cannot be chosen for the Energy Zone. */
export const NON_SELECTABLE_ENERGY_NAME_ES: Record<'dragon' | 'colorless', string> = {
  dragon: 'Dragón',
  colorless: 'Incolora',
}

const ES_LOOKUP = new Map<string, SelectableEnergy>()
const EN_LOOKUP = new Map<string, SelectableEnergy>()
for (const energy of SELECTABLE_ENERGIES) {
  ES_LOOKUP.set(foldText(ENERGY_NAME_ES[energy]), energy)
  EN_LOOKUP.set(foldText(ENERGY_NAME_EN[energy]), energy)
}
// Accepted spellings besides the canonical ones ("Eléctrico"/"Electrico" is how many players say Rayo).
ES_LOOKUP.set('electrico', 'lightning')
ES_LOOKUP.set('oscura', 'darkness')
ES_LOOKUP.set('metalica', 'metal')
ES_LOOKUP.set('psiquica', 'psychic')

/** 'Fuego' / 'fuego' / 'PSÍQUICO' → the energy; undefined when the word is not a selectable energy. */
export function energyFromNameEs(name: string): SelectableEnergy | undefined {
  return ES_LOOKUP.get(foldText(name))
}

/** 'Fire' / 'fire' → the energy; undefined for unknown words and for Dragon/Colorless. */
export function energyFromNameEn(name: string): SelectableEnergy | undefined {
  return EN_LOOKUP.get(foldText(name))
}

/** Spanish first, then English (the importers accept both). */
export function energyFromName(name: string): SelectableEnergy | undefined {
  return energyFromNameEs(name) ?? energyFromNameEn(name)
}

export function isSelectableEnergy(value: string): value is SelectableEnergy {
  return (SELECTABLE_ENERGIES as readonly string[]).includes(value)
}

/** Removes duplicates keeping the first occurrence. */
export function uniqueEnergies(energies: readonly SelectableEnergy[]): SelectableEnergy[] {
  return [...new Set(energies)]
}

/** Total number of cards in a draft (sum of counts). */
export function countCards(draft: Pick<DeckDraft, 'cards'>): number {
  let total = 0
  for (const entry of draft.cards) total += entry.count
  return total
}

/** Merges entries that repeat a `cardId`, keeping the order of first appearance. */
export function aggregateEntries(cards: readonly DeckCardEntry[]): DeckCardEntry[] {
  const byId = new Map<CardId, DeckCardEntry>()
  for (const entry of cards) {
    const existing = byId.get(entry.cardId)
    if (existing) existing.count += entry.count
    else byId.set(entry.cardId, { cardId: entry.cardId, count: entry.count })
  }
  return [...byId.values()]
}
