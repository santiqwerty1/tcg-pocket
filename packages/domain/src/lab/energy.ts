/**
 * T-017 C6: energy variants. The search kept the deck's Energy Zone fixed; for a deck with two types, which ones it
 * generates drives how often each attacker is ready, and a deck with an attacker of another type may want that type
 * too. At most one energy variant per round: the same cards with one type less (when it has more than one), or with
 * the type an attack of the deck asks for and the zone does not generate (up to the limit of 3, P-006). A Pokémon
 * whose attacks only the dropped type could pay just stops attacking: the bots measure whether that is worth it.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import { SELECTABLE_ENERGIES, type SelectableEnergy } from '../catalog/types.js'
import type { DeckCardEntry } from '../decks/types.js'
import { MAX_DECK_ENERGIES } from '../decks/validate.js'
import { listKeyByGroup } from '../tournaments/dataset.js'
import type { Variant } from './mutate.js'
import { groupsOfCards } from './novelty.js'

/** The key of a list with its Energy Zone: two lists with the same cards and other energies are different variants. */
export function energyKey(cardsKey: string, energies: readonly SelectableEnergy[]): string {
  return `${cardsKey}|${[...energies].sort().join('+')}`
}

/** The energy sets worth trying for `cards`: each type dropped, then each type an attack asks for added. */
export function energyOptions(
  cards: readonly DeckCardEntry[],
  energies: readonly SelectableEnergy[],
  index: CatalogIndex,
): SelectableEnergy[][] {
  const out: SelectableEnergy[][] = []
  if (energies.length > 1) for (const drop of energies) out.push(energies.filter((energy) => energy !== drop))
  if (energies.length < MAX_DECK_ENERGIES) {
    const asked = new Set<SelectableEnergy>()
    for (const entry of cards) {
      const card = index.cardById(entry.cardId)
      if (card?.cardType !== 'pokemon') continue
      for (const attack of card.attacks) {
        for (const type of attack.cost) {
          const selectable = SELECTABLE_ENERGIES.find((energy) => energy === type)
          if (selectable && !energies.includes(selectable)) asked.add(selectable)
        }
      }
    }
    for (const type of SELECTABLE_ENERGIES) if (asked.has(type)) out.push([...energies, type])
  }
  return out
}

/**
 * The `pick`-th energy variant of `deck` not tried yet (cycling through `energyOptions`), with its own key; null when
 * there is none.
 */
export function energyVariant(
  deck: readonly DeckCardEntry[],
  energies: readonly SelectableEnergy[],
  pick: number,
  index: CatalogIndex,
  seen?: ReadonlySet<string>,
): Variant | null {
  const options = energyOptions(deck, energies, index)
  const cardsKey = listKeyByGroup(groupsOfCards(deck, index))
  for (let k = 0; k < options.length; k++) {
    const candidate = options[(pick + k) % options.length] as SelectableEnergy[]
    const key = energyKey(cardsKey, candidate)
    if (seen?.has(key)) continue
    return { cards: deck.map((entry) => ({ ...entry })), key, add: [], remove: [], energies: candidate }
  }
  return null
}
