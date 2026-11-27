/**
 * Eventos con restricciones (BRIEF «más adelante», Fase 16): the rules an in-game event puts on decks, typed by
 * hand because nobody publishes them («solo Pokémon de tipo Agua», «sin ex», «al menos 8 Pokémon de tipo Fuego»,
 * rarities, expansions, banned cards). A deck complies when every card does and the counts hold; each problem says
 * which card and why, in Spanish. Edition rules (rarity, expansion) look at the edition the deck plays and suggest
 * another edition of the same card that would fit; `allow` names editions that meet them anyway («solo Fusión Dual,
 * y además Poción P-A-1»).
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

/** Most editions an event can allow outside its edition rules (the editor looks them all up in one request). */
export const MAX_ALLOWED_EDITIONS = 80

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
  /**
   * Editions (card ids, like `P-A-1` or `A2b-111`) that meet the edition rules — `rarities` and `expansions` — even
   * when they are outside them. Only those two: an allowed edition still has to meet `types`, `noEx` and `banned`,
   * which are about the card and not about its edition. Without an edition rule it changes nothing.
   */
  allow: z
    .array(z.string().regex(/^[A-Za-z0-9-]{1,20}$/))
    .max(MAX_ALLOWED_EDITIONS)
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
  // An allowed edition meets the edition rules; the ones above still apply to it.
  if (rules.allow?.includes(card.id)) return null
  if (rules.rarities && !rules.rarities.includes(card.rarity)) return `es ${card.rarity}`
  if (rules.expansions && !rules.expansions.includes(card.expansionId)) return `es de ${card.expansionId}`
  return null
}

/**
 * Another edition of the same functional card that fits the rules, or null: the card's display edition when it fits
 * (the one the Laboratorio plays, and usually the common one: Poké Ball P-A-5 before A2b-111 Crown Rare), else the
 * first one in catalog order. An edition the event allows counts like any other.
 */
export function fittingEdition(card: CardEdition, rules: EventRules, index: CatalogIndex): CardEdition | null {
  if (!rules.rarities && !rules.expansions) return null
  const editions = index.cardsOfGroup(card.functionalGroupId)
  const display = index.groupById(card.functionalGroupId)?.displayCardId
  const ordered = [
    ...editions.filter((other) => other.id === display),
    ...editions.filter((other) => other.id !== display),
  ]
  return ordered.find((other) => cardBreaksEvent(other, rules) === null) ?? null
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
  // Allowed editions only mean something next to an edition rule (the API refuses them without one).
  if ((rules.rarities || rules.expansions) && rules.allow && rules.allow.length > 0) {
    const one = new Set(rules.allow).size === 1
    lines.push(`Además, ${one ? 'esta edición' : 'estas ediciones'}: ${allowedEditionsEs(rules.allow, index)}.`)
  }
  if (rules.banned && rules.banned.length > 0) {
    lines.push(`Prohibidas: ${rules.banned.map((id) => index.groupById(id)?.nameEs ?? id).join(', ')}.`)
  }
  if (lines.length === 0) lines.push('Sin restricciones: cualquier mazo legal.')
  return lines
}

/**
 * The allowed editions in Spanish, in the order they were typed, the editions of one name together: «Poción (P-A-1),
 * Pokédex (P-A-4 y P-A-8)». An edition the catalog does not know (any more) goes by its id.
 */
export function allowedEditionsEs(allow: readonly CardId[], index: CatalogIndex): string {
  const byName = new Map<string, CardId[]>()
  const unknown: CardId[] = []
  for (const id of new Set(allow)) {
    const name = index.cardById(id)?.nameEs
    if (name === undefined) unknown.push(id)
    else byName.set(name, [...(byName.get(name) ?? []), id])
  }
  return [...[...byName].map(([name, ids]) => `${name} (${joinAndEs(ids)})`), ...unknown].join(', ')
}

/** «a», «a y b», «a, b y c». */
function joinAndEs(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`
}

export type NormalizedEventRules = { ok: true; rules: EventRules } | { ok: false; message: string }

/**
 * The rules as they are stored, or why not (in Spanish): banned cards as functional cards (an edition id becomes its
 * card, without repeats), only expansions the catalog knows, and allowed editions the catalog knows, without repeats
 * (an empty list is dropped), only next to an edition rule for them to lift and none of a banned card (the two lists
 * would say opposite things).
 */
export function normalizeEventRules(rules: EventRules, index: CatalogIndex): NormalizedEventRules {
  const next: EventRules = { ...rules }
  if (rules.banned) {
    const banned = rules.banned.map((id) => index.cardById(id)?.functionalGroupId ?? index.groupById(id)?.id ?? null)
    if (banned.some((id) => id === null)) return { ok: false, message: 'Una carta prohibida no existe en el catálogo.' }
    next.banned = [...new Set(banned as CardId[])]
  }
  const banned = new Set(next.banned ?? [])
  const expansions = rules.expansions?.filter((id) => !index.expansionById(id))
  if (expansions && expansions.length > 0) {
    return { ok: false, message: `Expansión desconocida: ${expansions.join(', ')}.` }
  }
  if (rules.allow) {
    const allow = [...new Set(rules.allow)]
    const unknown = allow.filter((id) => !index.cardById(id))
    if (unknown.length > 0) {
      const what = unknown.length === 1 ? 'Edición desconocida' : 'Ediciones desconocidas'
      return { ok: false, message: `${what}: ${unknown.join(', ')}.` }
    }
    const contradicted = allow.filter((id) => banned.has(index.cardById(id)?.functionalGroupId ?? ''))
    if (contradicted.length > 0) {
      const cards = new Set(contradicted.map((id) => index.cardById(id)?.functionalGroupId)).size
      const what =
        contradicted.length === 1
          ? 'Una edición permitida es de una carta prohibida'
          : `Estas ediciones permitidas son de ${cards === 1 ? 'una carta prohibida' : 'cartas prohibidas'}`
      return { ok: false, message: `${what}: ${allowedEditionsEs(contradicted, index)}.` }
    }
    if (allow.length === 0) delete next.allow
    else if (!rules.rarities && !rules.expansions) {
      return {
        ok: false,
        message: 'Las ediciones permitidas aparte solo valen con una regla de expansiones o de rarezas.',
      }
    } else next.allow = allow
  }
  return { ok: true, rules: next }
}
