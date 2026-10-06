/**
 * Parser for the line format shared by the Limitless clipboard and deckgym (docs/fase0/limitless.md §4,
 * docs/fase0/deckgym.md §3): one card per line `<count> <name…> <SET> <NUMBER>`, an optional `Energy: A, B` line
 * anywhere (English names), blank lines and the headers `Pokémon:` / `Pokemon:` / `Trainer: N` tolerated.
 * Only the last two tokens identify the card (`${SET}-${Number(NUMBER)}` is the tracker card id); the name is
 * compared with the catalog and a mismatch is only a warning.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import { foldText } from '../catalog/normalize.js'
import type { CardEdition, CardId, SelectableEnergy } from '../catalog/types.js'
import {
  type DeckCardEntry,
  type DeckDraft,
  energyFromName,
  NON_SELECTABLE_ENERGY_NAME_ES,
  type ParseIssue,
  type ParseResult,
  uniqueEnergies,
} from './types.js'

const HEADER = /^(pok[ée]mon|trainers?|entrenadores|supporters?|items?)\s*:?\s*\d*$/iu
const ENERGY_LINE = /^energ(?:y|ía|ia)\s*:\s*(.*)$/iu

/** `('B3b', '064')` → `'B3b-64'`; the set is matched case-insensitively against the catalog's expansions. */
export function cardIdFromSetNumber(index: CatalogIndex, set: string, number: string): CardId | null {
  if (!/^\d+$/u.test(number)) return null
  const n = Number(number)
  const direct = `${set}-${n}`
  if (index.cardById(direct)) return direct
  const folded = foldText(set)
  const expansion = index.catalog.expansions.find((e) => foldText(e.id) === folded)
  return expansion ? `${expansion.id}-${n}` : direct
}

export function parseLineFormat(text: string, index: CatalogIndex): ParseResult<DeckDraft> {
  const errors: ParseIssue[] = []
  const warnings: ParseIssue[] = []
  const cards: DeckCardEntry[] = []
  const energies: SelectableEnergy[] = []
  let sawEnergyLine = false
  const lines = text.split(/\r?\n/)
  for (const [i, rawLine] of lines.entries()) {
    const lineNo = i + 1
    const line = rawLine.trim()
    if (line === '' || HEADER.test(line)) continue
    const energyLine = ENERGY_LINE.exec(line)
    if (energyLine) {
      sawEnergyLine = true
      const words = (energyLine[1] ?? '')
        .split(/\s*[,+/]\s*/u)
        .map((w) => w.trim())
        .filter((w) => w !== '')
      for (const word of words) {
        const energy = energyFromName(word)
        if (energy) {
          energies.push(energy)
          continue
        }
        const nonSelectable = (Object.keys(NON_SELECTABLE_ENERGY_NAME_ES) as ('dragon' | 'colorless')[]).find(
          (k) => foldText(k) === foldText(word) || foldText(NON_SELECTABLE_ENERGY_NAME_ES[k]) === foldText(word),
        )
        if (nonSelectable) {
          errors.push({
            code: 'energy_not_selectable',
            message: `Línea ${lineNo}: la energía ${NON_SELECTABLE_ENERGY_NAME_ES[nonSelectable]} no se puede elegir`,
            line: lineNo,
          })
        } else {
          errors.push({
            code: 'unknown_energy',
            message: `Línea ${lineNo}: no reconozco la energía «${word}»`,
            line: lineNo,
          })
        }
      }
      continue
    }
    const tokens = line.split(/\s+/u)
    const countToken = tokens[0] ?? ''
    const count = /^\d+$/u.test(countToken) ? Number(countToken) : Number.NaN
    if (!Number.isInteger(count) || count < 1 || tokens.length < 3) {
      errors.push({ code: 'invalid_line', message: `Línea ${lineNo}: no entiendo «${line}»`, line: lineNo })
      continue
    }
    const set = tokens[tokens.length - 2] as string
    const number = tokens[tokens.length - 1] as string
    const name = tokens.slice(1, -2).join(' ')
    const cardId = cardIdFromSetNumber(index, set, number)
    const card: CardEdition | undefined = cardId === null ? undefined : index.cardById(cardId)
    if (!card) {
      errors.push({
        code: 'unknown_card',
        message: `Línea ${lineNo}: no existe la carta ${set} ${number}${name ? ` (${name})` : ''}`,
        line: lineNo,
      })
      continue
    }
    if (name !== '' && foldText(name) !== foldText(card.nameEn) && foldText(name) !== foldText(card.nameEs)) {
      warnings.push({
        code: 'name_mismatch',
        message: `Línea ${lineNo}: ${card.id} es ${card.nameEs} (${card.nameEn}), no «${name}»; se usa ${card.id}`,
        line: lineNo,
      })
    }
    cards.push({ cardId: card.id, count })
  }
  if (cards.length === 0 && errors.length === 0) {
    errors.push({ code: 'empty', message: 'No encontré ninguna línea de carta' })
  }
  if (!sawEnergyLine) {
    warnings.push({ code: 'energy_missing', message: 'La lista no tiene línea Energy: elegí la energía del mazo' })
  }
  const value: DeckDraft | null =
    errors.length > 0 ? null : { energies: uniqueEnergies(energies), cards, source: 'line_format' }
  return { value, errors, warnings }
}
