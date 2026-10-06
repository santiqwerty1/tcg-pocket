/**
 * Exporter to the Spanish list format (the inverse of `parseSpanish.ts`). Pokémon always carry their edition code;
 * trainers only when their Spanish name maps to more than one functional group. The `- Energía:` line is always
 * written (DECISIONES 0.8); an empty selection is written as «Cualquiera».
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardEdition, SelectableEnergy } from '../catalog/types.js'
import { nameResolverFor } from './resolveNames.js'
import { type DeckCardEntry, type DeckDraft, DeckFormatError, ENERGY_NAME_ES } from './types.js'

export interface WriteSpanishOptions {
  /** Write the `### N. Título` heading (default false). */
  heading?: boolean | undefined
  /** Deck number for the heading. */
  number?: number | undefined
}

const ANY_ENERGY_ES = 'Cualquiera'

function lookup(index: CatalogIndex, entry: DeckCardEntry): CardEdition {
  const card = index.cardById(entry.cardId)
  if (!card) throw new DeckFormatError('unknown_card', `No existe la carta ${entry.cardId} en el catálogo`)
  return card
}

/** `2 Caterpie (B3b-1)` / `2 Copiona`. */
export function formatSpanishItem(entry: DeckCardEntry, card: CardEdition, withCode: boolean): string {
  return withCode ? `${entry.count} ${card.nameEs} (${card.id})` : `${entry.count} ${card.nameEs}`
}

/** `Fuego + Rayo`; an empty selection is written as «Cualquiera». */
export function formatEnergiesEs(energies: readonly SelectableEnergy[]): string {
  return energies.length === 0 ? ANY_ENERGY_ES : energies.map((e) => ENERGY_NAME_ES[e]).join(' + ')
}

export function writeSpanishDeckText(draft: DeckDraft, index: CatalogIndex, options: WriteSpanishOptions = {}): string {
  const resolver = nameResolverFor(index)
  const pokemon: string[] = []
  const trainers: string[] = []
  for (const entry of draft.cards) {
    const card = lookup(index, entry)
    if (card.cardType === 'pokemon') pokemon.push(formatSpanishItem(entry, card, true))
    else trainers.push(formatSpanishItem(entry, card, resolver.isAmbiguousNameEs(card.nameEs)))
  }
  const lines: string[] = []
  if (options.heading) {
    const title = draft.name ?? ''
    const prefix = options.number === undefined ? '' : `${options.number}. `
    lines.push(`### ${prefix}${title}`.trimEnd())
  }
  lines.push(`- Energía: ${formatEnergiesEs(draft.energies)}`)
  if (pokemon.length > 0) lines.push(`- Pokémon: ${pokemon.join(', ')}`)
  if (trainers.length > 0) lines.push(`- Entrenadores: ${trainers.join(', ')}`)
  if (draft.notes) {
    for (const note of draft.notes.split(/\r?\n/)) {
      if (note.trim() !== '') lines.push(`- Nota: ${note.trim()}`)
    }
  }
  return `${lines.join('\n')}\n`
}
