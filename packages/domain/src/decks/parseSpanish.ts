/**
 * Importer for the Spanish list format of `docs/context/mazos_40_listas.md` (PLAN §3.3):
 *
 *   ### 9. Mega-Rayquaza ex / Dragonair
 *   - Energía: Fuego + Rayo                          (optional; also "Fuego, Rayo" and "Energy: Fire, Lightning")
 *   - Pokémon: 2 Dratini (A1-183), 2 Dragonair (B4-117), …
 *   - Entrenadores: 2 Investigación de Profesores, 2 Copiona, …
 *   - Nota: …                                        (captured into `notes`)
 *
 * Items are `N Nombre (CÓDIGO)` separated by commas; the code is optional. With a code the edition is taken as
 * written (warning `name_mismatch` if the catalog name differs); without it the name must map to exactly one
 * functional group, whose display edition is used (`ambiguous_name` lists the candidates, `unknown_card` suggests
 * close names). Energy comes from the `Energía` line, else from the summary table of the file (by deck number),
 * else the draft gets `[]` and a warning `energy_missing`; the app never infers it silently (DECISIONES 0.7).
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import { foldText } from '../catalog/normalize.js'
import type { CardEdition, CardType, SelectableEnergy } from '../catalog/types.js'
import { nameResolverFor } from './resolveNames.js'
import {
  type DeckCardEntry,
  type DeckDraft,
  energyFromName,
  type ParseIssue,
  type ParseResult,
  uniqueEnergies,
} from './types.js'

/** Summary-table value for «Cualquiera»: the deck works with any energy and the user has to pick one. */
export const ANY_ENERGY = 'any'
export type SummaryEnergies = SelectableEnergy[] | typeof ANY_ENERGY

export interface ParseSpanishOptions {
  /** Energies per deck number, typically from `parseSummaryTable`; used when the text has no `Energía` line. */
  energiesByDeckNumber?: ReadonlyMap<number, SummaryEnergies> | undefined
}

export interface SpanishDeckParseResult extends ParseResult<DeckDraft> {
  /** Deck number from the `### N.` heading, or null without heading. */
  number: number | null
  /** Title from the heading, or null without heading. */
  title: string | null
}

export interface SpanishFileDeck {
  number: number
  title: string
  draft: DeckDraft | null
  errors: ParseIssue[]
  warnings: ParseIssue[]
}

export interface SummaryTableParse {
  energiesByDeckNumber: Map<number, SummaryEnergies>
  /** Rows whose energy cell could not be read, keyed by deck number. */
  issues: { number: number; issue: ParseIssue }[]
}

const HEADING = /^#{1,6}\s+(\d+)\.\s*(.*?)\s*$/u
const BULLET = /^\s*(?:[-*]\s*)?([^:]{1,20}?)\s*:\s*(.*?)\s*$/u
const ITEM_WITH_CODE = /^(?:(\d+)\s*[x×]?\s+)?(.*?)\s*\(([A-Za-z0-9-]+)\)$/u
const ITEM_WITHOUT_CODE = /^(?:(\d+)\s*[x×]?\s+)?(.+)$/u
const ENERGY_SEPARATOR = /\s*(?:\+|,|\/|\by\b|\band\b)\s*/u
const ANY_ENERGY_WORDS = new Set(['cualquiera', 'cualquier', 'any', 'indistinta', 'indistinto'])

type LineKind = 'pokemon' | 'trainer' | 'energy' | 'note'

const LINE_KINDS: Record<string, LineKind> = {
  pokemon: 'pokemon',
  pokemons: 'pokemon',
  entrenador: 'trainer',
  entrenadores: 'trainer',
  trainer: 'trainer',
  trainers: 'trainer',
  energia: 'energy',
  energias: 'energy',
  energy: 'energy',
  nota: 'note',
  notas: 'note',
  note: 'note',
  notes: 'note',
}

const SECTION_NAME_ES: Record<CardType, string> = { pokemon: 'Pokémon', trainer: 'Entrenadores' }

/** Parses the energy cell of the summary table or the `Energía` line: `Fuego + Rayo`, `Fire, Lightning`, `Cualquiera`. */
export function parseEnergyWords(text: string): { energies: SummaryEnergies; unknown: string[] } {
  const words = text
    .split(ENERGY_SEPARATOR)
    .map((w) => w.trim())
    .filter((w) => w !== '')
  if (words.length === 1 && ANY_ENERGY_WORDS.has(foldText(words[0] as string))) {
    return { energies: ANY_ENERGY, unknown: [] }
  }
  const energies: SelectableEnergy[] = []
  const unknown: string[] = []
  for (const word of words) {
    const energy = energyFromName(word)
    if (energy) energies.push(energy)
    else unknown.push(word)
  }
  return { energies: uniqueEnergies(energies), unknown }
}

/**
 * Reads the `| # | Mazo | Energía | …` table of `mazos_40_listas.md`: the first cell must be a deck number and the
 * third the energy words. Rows with unreadable energies are left out of the map and reported in `issues`.
 */
export function parseSummaryTable(markdown: string): SummaryTableParse {
  const energiesByDeckNumber = new Map<number, SummaryEnergies>()
  const issues: SummaryTableParse['issues'] = []
  const lines = markdown.split(/\r?\n/)
  lines.forEach((line, i) => {
    if (!line.trimStart().startsWith('|')) return
    const cells = line
      .trim()
      .replace(/^\||\|$/gu, '')
      .split('|')
      .map((c) => c.trim())
    if (cells.length < 3) return
    const number = Number(cells[0])
    if (!/^\d+$/u.test(cells[0] as string) || !Number.isInteger(number)) return
    const { energies, unknown } = parseEnergyWords(cells[2] as string)
    if (unknown.length > 0) {
      issues.push({
        number,
        issue: {
          code: 'unknown_energy',
          message: `Mazo ${number}: no reconozco la energía «${unknown.join(', ')}» en la tabla resumen`,
          line: i + 1,
        },
      })
      return
    }
    if (energies !== ANY_ENERGY && energies.length === 0) return
    energiesByDeckNumber.set(number, energies)
  })
  return { energiesByDeckNumber, issues }
}

interface ParsedItem {
  count: number
  name: string
  code: string | null
}

function parseItem(item: string): ParsedItem | null {
  const withCode = ITEM_WITH_CODE.exec(item)
  if (withCode) {
    return { count: withCode[1] ? Number(withCode[1]) : 1, name: (withCode[2] ?? '').trim(), code: withCode[3] ?? null }
  }
  const plain = ITEM_WITHOUT_CODE.exec(item)
  if (!plain) return null
  return { count: plain[1] ? Number(plain[1]) : 1, name: (plain[2] ?? '').trim(), code: null }
}

/** Parses ONE deck written in the Spanish list format. */
export function parseSpanishDeckText(
  text: string,
  index: CatalogIndex,
  options: ParseSpanishOptions = {},
): SpanishDeckParseResult {
  const resolver = nameResolverFor(index)
  const errors: ParseIssue[] = []
  const warnings: ParseIssue[] = []
  const cards: DeckCardEntry[] = []
  const notes: string[] = []
  let number: number | null = null
  let title: string | null = null
  let energies: SelectableEnergy[] | null = null
  let sawCardLine = false

  const resolveItem = (item: ParsedItem, section: CardType, lineNo: number): CardEdition | null => {
    if (!Number.isInteger(item.count) || item.count < 1) {
      errors.push({
        code: 'invalid_count',
        message: `Línea ${lineNo}: cantidad inválida en «${item.name}»`,
        line: lineNo,
      })
      return null
    }
    let card: CardEdition | undefined
    if (item.code !== null) {
      card = index.cardById(item.code)
      if (!card) {
        const byName = item.name === '' ? [] : resolver.groupsByName(item.name)
        errors.push({
          code: 'unknown_card',
          message: `Línea ${lineNo}: no existe la carta ${item.code}${item.name ? ` (${item.name})` : ''}`,
          line: lineNo,
          candidates: byName.flatMap((g) => g.cardIds.map((id) => `${g.nameEs} (${id})`)),
        })
        return null
      }
      if (
        item.name !== '' &&
        foldText(item.name) !== foldText(card.nameEs) &&
        foldText(item.name) !== foldText(card.nameEn)
      ) {
        warnings.push({
          code: 'name_mismatch',
          message: `Línea ${lineNo}: ${card.id} es ${card.nameEs}, no «${item.name}»; se usa ${card.id}`,
          line: lineNo,
        })
      }
    } else {
      if (item.name === '') {
        errors.push({ code: 'invalid_line', message: `Línea ${lineNo}: carta sin nombre`, line: lineNo })
        return null
      }
      const resolution = resolver.resolve(item.name)
      if (resolution.kind === 'ambiguous') {
        errors.push({
          code: 'ambiguous_name',
          message: `Línea ${lineNo}: «${item.name}» tiene ${resolution.groups.length} versiones con distinto texto; indicá el código: ${resolution.candidates.join(', ')}`,
          line: lineNo,
          candidates: resolution.candidates,
        })
        return null
      }
      if (resolution.kind === 'unknown') {
        const hint = resolution.suggestions.length > 0 ? ` ¿Quisiste decir ${resolution.suggestions.join(', ')}?` : ''
        errors.push({
          code: 'unknown_card',
          message: `Línea ${lineNo}: no encuentro la carta «${item.name}».${hint}`,
          line: lineNo,
          candidates: resolution.suggestions,
        })
        return null
      }
      card = index.cardById(resolution.cardId)
      if (!card) return null
    }
    if (card.cardType !== section) {
      warnings.push({
        code: 'wrong_section',
        message: `Línea ${lineNo}: ${card.nameEs} (${card.id}) es ${card.cardType === 'pokemon' ? 'un Pokémon' : 'un Entrenador'} y está en la línea de ${SECTION_NAME_ES[section]}`,
        line: lineNo,
      })
    }
    return card
  }

  const lines = text.split(/\r?\n/)
  for (const [i, rawLine] of lines.entries()) {
    const lineNo = i + 1
    const line = rawLine.trim()
    if (line === '') continue
    const heading = HEADING.exec(line)
    if (heading) {
      if (number === null) {
        number = Number(heading[1])
        title = (heading[2] ?? '').trim()
      }
      continue
    }
    if (line.startsWith('#') || line.startsWith('|')) continue
    const bullet = BULLET.exec(line)
    const kind = bullet ? LINE_KINDS[foldText(bullet[1] as string)] : undefined
    if (!bullet || !kind) {
      warnings.push({
        code: 'invalid_line',
        message: `Línea ${lineNo}: no entiendo «${line}», la ignoro`,
        line: lineNo,
      })
      continue
    }
    const body = bullet[2] ?? ''
    if (kind === 'note') {
      if (body !== '') notes.push(body)
      continue
    }
    if (kind === 'energy') {
      const { energies: parsed, unknown } = parseEnergyWords(body)
      if (unknown.length > 0) {
        errors.push({
          code: 'unknown_energy',
          message: `Línea ${lineNo}: no reconozco la energía «${unknown.join(', ')}»`,
          line: lineNo,
        })
        continue
      }
      if (parsed === ANY_ENERGY) {
        energies = []
        warnings.push({
          code: 'energy_choice_required',
          message: 'La lista dice «Cualquiera»: elegí la energía del mazo',
          line: lineNo,
        })
        continue
      }
      energies = parsed
      continue
    }
    sawCardLine = true
    if (body === '') continue
    for (const rawItem of body.split(',')) {
      const item = rawItem.trim()
      if (item === '') continue
      const parsed = parseItem(item)
      if (!parsed) {
        errors.push({ code: 'invalid_line', message: `Línea ${lineNo}: no entiendo «${item}»`, line: lineNo })
        continue
      }
      const card = resolveItem(parsed, kind, lineNo)
      if (card) cards.push({ cardId: card.id, count: parsed.count })
    }
  }

  if (!sawCardLine) {
    errors.push({ code: 'empty', message: 'No encontré líneas de Pokémon ni de Entrenadores' })
  }

  let finalEnergies: SelectableEnergy[] = energies ?? []
  if (energies === null) {
    const fromTable = number === null ? undefined : options.energiesByDeckNumber?.get(number)
    if (fromTable === undefined) {
      warnings.push({
        code: 'energy_missing',
        message: 'La lista no dice la energía del mazo: elegila antes de guardar',
      })
    } else if (fromTable === ANY_ENERGY) {
      warnings.push({
        code: 'energy_choice_required',
        message: 'La tabla resumen dice «Cualquiera»: elegí la energía del mazo',
      })
    } else {
      finalEnergies = fromTable
    }
  }

  const draft: DeckDraft | null =
    errors.length > 0
      ? null
      : {
          ...(title !== null && title !== '' ? { name: title } : {}),
          energies: finalEnergies,
          cards,
          ...(notes.length > 0 ? { notes: notes.join('\n') } : {}),
          source: 'spanish_text',
        }
  return { value: draft, errors, warnings, number, title }
}

/** Splits a markdown file into its `### N. Título` sections (each ends at the next heading of any level). */
export function splitDeckSections(markdown: string): { number: number; title: string; text: string; line: number }[] {
  interface Open {
    number: number
    title: string
    lines: string[]
    line: number
  }
  const sections: { number: number; title: string; text: string; line: number }[] = []
  const lines = markdown.split(/\r?\n/)
  const state: { current: Open | null } = { current: null }
  const flush = () => {
    const open = state.current
    if (open) sections.push({ number: open.number, title: open.title, text: open.lines.join('\n'), line: open.line })
    state.current = null
  }
  for (const [i, line] of lines.entries()) {
    const heading = HEADING.exec(line.trim())
    if (heading) {
      flush()
      state.current = { number: Number(heading[1]), title: (heading[2] ?? '').trim(), lines: [line], line: i + 1 }
      continue
    }
    if (/^\s*#/u.test(line)) {
      flush()
      continue
    }
    if (state.current) state.current.lines.push(line)
  }
  flush()
  return sections
}

/**
 * Parses a whole file in the layout of `mazos_40_listas.md`: the summary table gives the energy of each deck
 * number («Cualquiera» → `[]` + `energy_choice_required`), then every `### N.` section becomes a deck.
 */
export function parseSpanishDeckFile(markdown: string, index: CatalogIndex): SpanishFileDeck[] {
  const table = parseSummaryTable(markdown)
  const sections = splitDeckSections(markdown)
  return sections.map((section) => {
    const result = parseSpanishDeckText(section.text, index, { energiesByDeckNumber: table.energiesByDeckNumber })
    const offset = section.line - 1
    const relocate = (issue: ParseIssue): ParseIssue =>
      issue.line === undefined ? issue : { ...issue, line: issue.line + offset }
    const errors = result.errors.map(relocate)
    const warnings = result.warnings.map(relocate)
    for (const tableIssue of table.issues) {
      if (tableIssue.number === section.number) errors.push(tableIssue.issue)
    }
    return {
      number: section.number,
      title: section.title,
      draft: errors.length > 0 ? null : result.value,
      errors,
      warnings,
    }
  })
}
