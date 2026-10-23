/**
 * Eventos con restricciones (BRIEF «más adelante», Fase 16): the rules an in-game event puts on decks, typed by
 * hand because nobody publishes them («solo Pokémon de tipo Agua», «sin ex», «al menos 8 Pokémon de tipo Fuego»,
 * rarities, expansions, banned cards). A deck complies when every card does and the counts hold; each problem says
 * which card and why, in Spanish. Edition rules (rarity, expansion) look at the edition the deck plays and suggest
 * another edition of the same card that would fit.
 */
import { z } from 'zod'
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import { typesOf } from '../catalog/pokemonTypes.js'
import { type CardEdition, type CardId, ENERGY_TYPES, type EnergyType, RARITIES } from '../catalog/types.js'
import type { DeckCardEntry } from '../decks/types.js'

/** Pokémon types an event can ask for (the game prints colorless and dragon Pokémon too). */
export const EVENT_POKEMON_TYPES = ENERGY_TYPES

export const ENERGY_TYPE_NAME_ES: Record<EnergyType, string> = {
  grass: 'Planta',
  fire: 'Fuego',
  water: 'Agua',
  lightning: 'Rayo',
  psychic: 'Psíquico',
  fighting: 'Lucha',
  darkness: 'Oscuridad',
  metal: 'Metal',
  dragon: 'Dragón',
  colorless: 'Incoloro',
}

export const eventRulesSchema = z.object({
  /** Every Pokémon of the deck is of one of these types (a dual-type Pokémon, of either of its two). */
  types: z.array(z.enum(ENERGY_TYPES)).min(1).max(10).optional(),
  /** At least `count` Pokémon cards (copies) of this type (a dual-type Pokémon counts for either). */
  minOfType: z.object({ type: z.enum(ENERGY_TYPES), count: z.number().int().min(1).max(20) }).optional(),
  /** No Pokémon ex (Mega ex included). */
  noEx: z.boolean().optional(),
  /** Every card played in one of these rarities (the edition in the deck). */
  rarities: z.array(z.enum(RARITIES)).min(1).max(RARITIES.length).optional(),
  /** Every card played in an edition of these expansions. */
  expansions: z
    .array(z.string().regex(/^[A-Za-z0-9-]{1,10}$/))
    .min(1)
    .max(40)
    .optional(),
  /** Functional cards not allowed. */
  banned: z.array(z.string().min(1).max(20)).max(60).optional(),
})
export type EventRules = z.infer<typeof eventRulesSchema>

export interface EventProblem {
  /** The card at fault (edition in the deck); null for a count rule. */
  cardId: CardId | null
  message: string
  /** Another edition of the same card that fits the edition rules, when there is one. */
  alternative: CardId | null
}

export interface EventCheck {
  ok: boolean
  problems: EventProblem[]
}

/** Why one edition breaks the per-card rules, or null when it fits (counts are checked on the whole deck). */
export function cardBreaksEvent(card: CardEdition, rules: EventRules): string | null {
  if (rules.banned?.includes(card.functionalGroupId)) return 'está prohibida en el evento'
  if (card.cardType === 'pokemon') {
    const types = typesOf(card)
    if (rules.types && !types.some((type) => rules.types?.includes(type))) {
      return `es de tipo ${types.map((type) => ENERGY_TYPE_NAME_ES[type] ?? type).join(' y ')}`
    }
    if (rules.noEx && card.ex) return 'es un Pokémon ex'
  }
  if (rules.rarities && !rules.rarities.includes(card.rarity)) return `es ${card.rarity}`
  if (rules.expansions && !rules.expansions.includes(card.expansionId)) return `es de ${card.expansionId}`
  return null
}

/** Another edition of the same functional card that fits the rules (the first one in catalog order), or null. */
export function fittingEdition(card: CardEdition, rules: EventRules, index: CatalogIndex): CardEdition | null {
  if (!rules.rarities && !rules.expansions) return null
  return index.cardsOfGroup(card.functionalGroupId).find((other) => cardBreaksEvent(other, rules) === null) ?? null
}

/**
 * Does a deck comply with the event's rules? Every problem, card by card, then the counts. `anyEdition`: a card
 * that breaks only an edition rule (rarity, expansion) is fine when another edition of it fits — for tournament
 * lists, whose edition is whatever the player had.
 */
export function checkEventDeck(
  cards: readonly DeckCardEntry[],
  rules: EventRules,
  index: CatalogIndex,
  options: { anyEdition?: boolean } = {},
): EventCheck {
  const problems: EventProblem[] = []
  let ofType = 0
  for (const entry of cards) {
    const card = index.cardById(entry.cardId)
    if (!card) continue
    if (rules.minOfType && card.cardType === 'pokemon' && typesOf(card).includes(rules.minOfType.type)) {
      ofType += entry.count
    }
    const reason = cardBreaksEvent(card, rules)
    if (reason === null) continue
    const alternative = fittingEdition(card, rules, index)
    if (options.anyEdition && alternative) continue
    problems.push({
      cardId: card.id,
      message: `${card.nameEs} (${card.id}) ${reason}${alternative ? `: sirve ${alternative.id} ${alternative.rarity}` : ''}`,
      alternative: alternative?.id ?? null,
    })
  }
  if (rules.minOfType && ofType < rules.minOfType.count) {
    problems.push({
      cardId: null,
      message: `Tiene ${ofType} Pokémon de tipo ${ENERGY_TYPE_NAME_ES[rules.minOfType.type]}; el evento pide al menos ${rules.minOfType.count}.`,
      alternative: null,
    })
  }
  return { ok: problems.length === 0, problems }
}

/** The rules in Spanish, one line each. */
export function describeEventRulesEs(rules: EventRules, index: CatalogIndex): string[] {
  const lines: string[] = []
  if (rules.types)
    lines.push(`Solo Pokémon de tipo ${rules.types.map((type) => ENERGY_TYPE_NAME_ES[type]).join(', ')}.`)
  if (rules.minOfType) {
    lines.push(`Al menos ${rules.minOfType.count} Pokémon de tipo ${ENERGY_TYPE_NAME_ES[rules.minOfType.type]}.`)
  }
  if (rules.noEx) lines.push('Sin Pokémon ex.')
  if (rules.rarities) lines.push(`Solo cartas ${rules.rarities.join(', ')}.`)
  if (rules.expansions) {
    lines.push(`Solo cartas de ${rules.expansions.map((id) => index.expansionById(id)?.nameEs ?? id).join(', ')}.`)
  }
  if (rules.banned && rules.banned.length > 0) {
    lines.push(`Prohibidas: ${rules.banned.map((id) => index.groupById(id)?.nameEs ?? id).join(', ')}.`)
  }
  if (lines.length === 0) lines.push('Sin restricciones: cualquier mazo legal.')
  return lines
}
