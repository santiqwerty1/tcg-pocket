/**
 * Exporter to the deckgym text format (docs/fase0/deckgym.md §3, §9; DECISIONES 0.7):
 *
 *   Energy: Fire, Lightning
 *   2 Dratini A1 183
 *   …
 *
 * `Energy:` is ALWAYS the first line and is never inferred (an inferred Dragon/Colorless energy makes the engine
 * panic or pollutes the Energy Zone). Numbers are not padded (deckgym pads to 3 digits internally). `mapEdition`
 * lets the caller swap an edition for one the engine implements (Phase 6: Globito B4b-372 → B3b-64).
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardId, SelectableEnergy } from '../catalog/types.js'
import { type DeckDraft, DeckFormatError, ENERGY_NAME_EN } from './types.js'

export interface WriteDeckgymOptions {
  /** Edition substitution applied to every entry before writing (default: identity). */
  mapEdition?: ((cardId: CardId) => CardId) | undefined
}

/** `Energy: Fire, Lightning` (English names, deckgym/Limitless order = the draft's order). */
export function formatEnergyLineEn(energies: readonly SelectableEnergy[]): string {
  return `Energy: ${energies.map((e) => ENERGY_NAME_EN[e]).join(', ')}`
}

/** `2 Poké Ball P-A 5`: count, English name, expansion id, unpadded number. */
export function formatLineEntry(index: CatalogIndex, cardId: CardId, count: number): string {
  const card = index.cardById(cardId)
  if (!card) throw new DeckFormatError('unknown_card', `No existe la carta ${cardId} en el catálogo`)
  return `${count} ${card.nameEn} ${card.expansionId} ${card.number}`
}

export function writeDeckgymText(draft: DeckDraft, index: CatalogIndex, options: WriteDeckgymOptions = {}): string {
  if (draft.energies.length === 0) {
    throw new DeckFormatError('energy_required', 'El mazo no tiene energía elegida; deckgym la necesita explícita')
  }
  const mapEdition = options.mapEdition ?? ((cardId: CardId) => cardId)
  const lines = [formatEnergyLineEn(draft.energies)]
  for (const entry of draft.cards) lines.push(formatLineEntry(index, mapEdition(entry.cardId), entry.count))
  return `${lines.join('\n')}\n`
}
