/**
 * T-017 A3: the cards the bots play badly or the engine (deckgym 33ff2a5) approximates, so a result that leans on them
 * is «sensible al bot». Read from the catalog's texts, without the engine:
 * - variable damage («30+», «50×», coins): the expectiminimax clock only counts fixed damage (H-018);
 * - an evolution whose attacks do no damage (Ivysaur): e<N>'s clock reads it as a side that cannot win, and never
 *   evolves into it (H-018; f<N> corrects it);
 * - a search of the deck: the engine's searches see the deck in order (`apply_trainer_action.rs:1519`);
 * - «discard a random Energy»: the engine always discards the last one;
 * - Mythical Slab: the engine checks «Basic» instead of «Psychic Pokémon».
 * (The second player also sees the first one's Active before choosing its own; that is no card's.)
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardEdition, CardId } from '../catalog/types.js'
import type { DeckCardEntry } from '../decks/types.js'

export type BlindSpot = 'variable_damage' | 'stage_without_damage' | 'deck_search' | 'random_energy' | 'mythical_slab'

export const BLIND_SPOT_ES: Record<BlindSpot, string> = {
  variable_damage: 'daño variable: el reloj del bot solo cuenta el daño fijo',
  stage_without_damage: 'una evolución que no hace daño: e2 casi nunca evoluciona a ella',
  deck_search: 'busca en el mazo: el motor ve el orden del mazo',
  random_energy: '«una Energía al azar»: el motor descarta siempre la última',
  mythical_slab: 'el motor mira «Básico» en vez de «Pokémon Psíquico»',
}

const DAMAGE_WORD = /\b\d+\s*damage\b/i

/** The blind spots of one card (none for most). */
export function blindSpotsOf(card: CardEdition): BlindSpot[] {
  const spots: BlindSpot[] = []
  const texts = [...card.attacks.map((attack) => attack.effect ?? ''), card.ability?.effect ?? ''].join(' ')
  const variable = card.attacks.some(
    (attack) => /[+x×]\s*$/i.test(attack.damage ?? '') || /\bflip\b|\bcoin\b/i.test(attack.effect ?? ''),
  )
  if (variable) spots.push('variable_damage')
  const evolved = card.cardType === 'pokemon' && card.evolvesFrom !== null
  const deals = card.attacks.some((attack) => {
    const printed = Number.parseInt(attack.damage ?? '', 10)
    return (Number.isFinite(printed) && printed > 0) || DAMAGE_WORD.test(attack.effect ?? '')
  })
  if (evolved && card.attacks.length > 0 && !deals) spots.push('stage_without_damage')
  if (/\bfrom your deck\b/i.test(texts)) spots.push('deck_search')
  if (/\brandom\b[^.]*\benergy\b/i.test(texts) && /\bdiscard\b/i.test(texts)) spots.push('random_energy')
  if (card.nameEn === 'Mythical Slab') spots.push('mythical_slab')
  return spots
}

/** A list's cards with blind spots, once per functional card, in list order. */
export function listBlindSpots(
  cards: readonly DeckCardEntry[],
  index: CatalogIndex,
): { cardId: CardId; nameEs: string; spots: BlindSpot[] }[] {
  const out: { cardId: CardId; nameEs: string; spots: BlindSpot[] }[] = []
  const seen = new Set<CardId>()
  for (const entry of cards) {
    const card = index.cardById(entry.cardId)
    if (!card || seen.has(card.functionalGroupId)) continue
    seen.add(card.functionalGroupId)
    const spots = blindSpotsOf(card)
    if (spots.length > 0) out.push({ cardId: card.id, nameEs: card.nameEs, spots })
  }
  return out
}
