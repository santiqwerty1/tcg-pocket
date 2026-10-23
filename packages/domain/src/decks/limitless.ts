/**
 * Limitless formats (docs/fase0/limitless.md §2d, §4a):
 * - clipboard text of a tournament decklist page: Pokémon lines, blank line, trainer lines, blank line,
 *   `Energy: …` LAST, CRLF (byte-compatible with the deckgym parser);
 * - standings JSON `decklist {pokemon, trainer, energy?}` → DeckDraft (`card_id = set-number` without padding);
 * - the `?i=` parameter of my.limitlesstcg.com/builder, decoded by inspection: `'3'` then, per entry,
 *   `count(1 digit) len(set)(1) len(number)(1) set number`, with the hyphen of promo sets written as `0`
 *   (`P-A 7` → `231P0A7`). It carries no energy.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardEdition, CardId, SelectableEnergy } from '../catalog/types.js'
import { formatEnergyLineEn, formatLineEntry } from './deckgym.js'
import { cardIdFromSetNumber } from './lineFormat.js'
import { type DeckCardEntry, type DeckDraft, DeckFormatError, energyFromNameEn } from './types.js'

const CRLF = '\r\n'
const BUILDER_VERSION = '3'

export function writeLimitlessClipboardText(draft: DeckDraft, index: CatalogIndex): string {
  const pokemon: string[] = []
  const trainers: string[] = []
  for (const entry of draft.cards) {
    const card = index.cardById(entry.cardId)
    if (!card) throw new DeckFormatError('unknown_card', `No existe la carta ${entry.cardId} en el catálogo`)
    const line = formatLineEntry(index, card.id, entry.count)
    if (card.cardType === 'pokemon') pokemon.push(line)
    else trainers.push(line)
  }
  const blocks: string[] = []
  if (pokemon.length > 0) blocks.push(pokemon.join(CRLF))
  if (trainers.length > 0) blocks.push(trainers.join(CRLF))
  if (draft.energies.length > 0) blocks.push(formatEnergyLineEn(draft.energies))
  return blocks.join(CRLF + CRLF)
}

/** One card of a Limitless standings decklist (`number` comes without leading zeros). */
export interface LimitlessDecklistCard {
  count: number
  set: string
  number: string
  name: string
}

/** `decklist` of a standings entry; `energy` is absent in NOEX tournaments. */
export interface LimitlessDecklist {
  pokemon: LimitlessDecklistCard[]
  trainer: LimitlessDecklistCard[]
  energy?: string[] | null | undefined
}

export interface LimitlessDraftResult {
  draft: DeckDraft
  /** Cards whose set+number is not in the catalog (kept out of the draft). */
  unmapped: (LimitlessDecklistCard & { ref: string })[]
  /** Energy words that are not one of the eight selectable energies. */
  unknownEnergies: string[]
}

export function entryToDraft(decklist: LimitlessDecklist, index: CatalogIndex): LimitlessDraftResult {
  const cards: DeckCardEntry[] = []
  const unmapped: LimitlessDraftResult['unmapped'] = []
  for (const item of [...decklist.pokemon, ...decklist.trainer]) {
    const cardId = cardIdFromSetNumber(index, item.set, item.number)
    const card: CardEdition | undefined = cardId === null ? undefined : index.cardById(cardId)
    if (!card) {
      unmapped.push({ ...item, ref: `${item.set}-${item.number}` })
      continue
    }
    cards.push({ cardId: card.id, count: item.count })
  }
  const energies: SelectableEnergy[] = []
  const unknownEnergies: string[] = []
  for (const word of decklist.energy ?? []) {
    const energy = energyFromNameEn(word)
    if (energy) {
      if (!energies.includes(energy)) energies.push(energy)
    } else unknownEnergies.push(word)
  }
  return { draft: { energies, cards, source: 'limitless_standings' }, unmapped, unknownEnergies }
}

/** `'B3b-64'` → `['B3b', '64']`; `'P-A-7'` → `['P-A', '7']`. */
export function splitCardId(cardId: CardId): [set: string, number: string] {
  const dash = cardId.lastIndexOf('-')
  if (dash <= 0 || dash === cardId.length - 1)
    throw new DeckFormatError('unknown_card', `Id de carta inválido: ${cardId}`)
  return [cardId.slice(0, dash), cardId.slice(dash + 1)]
}

export function encodeLimitlessBuilderParam(draft: Pick<DeckDraft, 'cards'>): string {
  let out = BUILDER_VERSION
  for (const entry of draft.cards) {
    if (!Number.isInteger(entry.count) || entry.count < 1 || entry.count > 9) {
      throw new DeckFormatError(
        'invalid_count',
        `El builder de Limitless admite de 1 a 9 copias (${entry.cardId}: ${entry.count})`,
      )
    }
    const [set, number] = splitCardId(entry.cardId)
    if (set.length > 9 || number.length > 9) {
      throw new DeckFormatError(
        'unknown_card',
        `Id de carta demasiado largo para el builder de Limitless: ${entry.cardId}`,
      )
    }
    out += `${entry.count}${set.length}${number.length}${set.replace('-', '0')}${number}`
  }
  return out
}

/**
 * Inverse of `encodeLimitlessBuilderParam`; a promo set `P0<letter>` is restored to `P-<letter>` (`P-A`, `P-B`, and
 * `P-C` from Promo Pack C Series Vol. 1, 17/11/2026).
 */
export function decodeLimitlessBuilderParam(param: string): DeckCardEntry[] {
  if (!param.startsWith(BUILDER_VERSION)) {
    throw new DeckFormatError('invalid_line', `Versión desconocida del parámetro del builder: «${param.slice(0, 1)}»`)
  }
  const entries: DeckCardEntry[] = []
  let at = BUILDER_VERSION.length
  while (at < param.length) {
    const header = param.slice(at, at + 3)
    if (!/^\d{3}$/u.test(header))
      throw new DeckFormatError('invalid_line', `Parámetro del builder corrupto en la posición ${at}`)
    const count = Number(header[0])
    const setLength = Number(header[1])
    const numberLength = Number(header[2])
    at += 3
    const set = param.slice(at, at + setLength).replace(/^P0([A-Z])$/u, 'P-$1')
    at += setLength
    const number = param.slice(at, at + numberLength)
    at += numberLength
    if (set.length !== setLength || number.length !== numberLength || !/^\d+$/u.test(number)) {
      throw new DeckFormatError('invalid_line', `Parámetro del builder corrupto en la posición ${at}`)
    }
    entries.push({ cardId: `${set}-${Number(number)}`, count })
  }
  return entries
}
