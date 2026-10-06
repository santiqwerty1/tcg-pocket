/**
 * Deck validation (BRIEF §2, PLAN §3.3 and I5–I7). Pure and cheap enough to run on every keystroke.
 *
 * Errors: `card_count`, `copies_per_name` (over `nameEn`, summing editions and groups), `no_basic` (fossils are
 * trainers and never count), `evolution_line` (stage 1 needs its pre-evolution; stage 2 needs its stage 1, or the
 * basic plus Rare Candy), `energy_required`, `energy_not_selectable`, `unknown_card`, `no_attacker`.
 * Infos: `energy_unused`, `energy_missing_for_card`, `same_group_split`.
 * `EvolutionAlias` covers printed exceptions: every edition of Eevee ex counts as Eevee ("Veevee 'volve").
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardEdition, CardId, SelectableEnergy } from '../catalog/types.js'
import {
  countCards,
  type DeckDraft,
  ENERGY_NAME_ES,
  isSelectableEnergy,
  NON_SELECTABLE_ENERGY_NAME_ES,
} from './types.js'

export const DECK_SIZE = 20
export const MAX_COPIES_PER_NAME = 2
const RARE_CANDY = 'Rare Candy'

export type ValidationCode =
  | 'card_count'
  | 'invalid_count'
  | 'copies_per_name'
  | 'no_basic'
  | 'evolution_line'
  | 'energy_required'
  | 'energy_not_selectable'
  | 'unknown_card'
  | 'no_attacker'
  | 'energy_unused'
  | 'energy_missing_for_card'
  | 'same_group_split'

export type ValidationLevel = 'error' | 'warning' | 'info'

export interface ValidationIssue {
  code: ValidationCode
  level: ValidationLevel
  message: string
  /** Editions the issue refers to, when it is about cards. */
  cardIds?: CardId[] | undefined
}

export interface DeckValidation {
  ok: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  infos: ValidationIssue[]
}

/** A printed exception: the edition `cardId` also counts as the Pokémon named `countsAs` for evolution lines. */
export interface EvolutionAlias {
  cardId: CardId
  countsAs: string
}

export interface ValidateDeckOptions {
  /** Defaults to `defaultEvolutionAliases(index)`. Pass `[]` to validate without exceptions. */
  aliases?: readonly EvolutionAlias[] | undefined
}

const aliasCache = new WeakMap<CatalogIndex, EvolutionAlias[]>()

/** Every edition named "Eevee ex" counts as "Eevee" (the only exception in the catalog, docs/PLAN.md A.1). */
export function defaultEvolutionAliases(index: CatalogIndex): EvolutionAlias[] {
  let aliases = aliasCache.get(index)
  if (!aliases) {
    aliases = index.catalog.cards
      .filter((c) => c.nameEn === 'Eevee ex')
      .map((c) => ({ cardId: c.id, countsAs: 'Eevee' }))
    aliasCache.set(index, aliases)
  }
  return aliases
}

interface EvolutionInfo {
  /** First edition of each English name (for the Spanish name in messages). */
  byNameEn: Map<string, CardEdition>
  /** English name → names it evolves from across the catalog (normally one). */
  preEvolutionsOf: Map<string, string[]>
}

const evolutionCache = new WeakMap<CatalogIndex, EvolutionInfo>()

function evolutionInfoFor(index: CatalogIndex): EvolutionInfo {
  let info = evolutionCache.get(index)
  if (info) return info
  info = { byNameEn: new Map(), preEvolutionsOf: new Map() }
  for (const card of index.catalog.cards) {
    if (!info.byNameEn.has(card.nameEn)) info.byNameEn.set(card.nameEn, card)
    if (card.evolvesFrom === null) continue
    const list = info.preEvolutionsOf.get(card.nameEn) ?? []
    if (!list.includes(card.evolvesFrom)) list.push(card.evolvesFrom)
    info.preEvolutionsOf.set(card.nameEn, list)
  }
  evolutionCache.set(index, info)
  return info
}

export interface EditionCopies {
  cardId: CardId
  count: number
}

export interface NameCopies {
  nameEn: string
  nameEs: string
  total: number
  /** Per edition, in order of first appearance. */
  editions: EditionCopies[]
}

/** Copies per English name (I5), unknown card ids skipped. */
export function copiesByName(draft: Pick<DeckDraft, 'cards'>, index: CatalogIndex): Map<string, NameCopies> {
  const byName = new Map<string, NameCopies>()
  for (const entry of draft.cards) {
    const card = index.cardById(entry.cardId)
    if (!card) continue
    let copies = byName.get(card.nameEn)
    if (!copies) {
      copies = { nameEn: card.nameEn, nameEs: card.nameEs, total: 0, editions: [] }
      byName.set(card.nameEn, copies)
    }
    copies.total += entry.count
    const edition = copies.editions.find((e) => e.cardId === card.id)
    if (edition) edition.count += entry.count
    else copies.editions.push({ cardId: card.id, count: entry.count })
  }
  return byName
}

interface ResolvedEntry {
  card: CardEdition
  count: number
}

function plural(n: number, singular: string, pluralForm: string): string {
  return n === 1 ? singular : pluralForm
}

function cardCountIssue(total: number): ValidationIssue | null {
  if (total === DECK_SIZE) return null
  const diff = Math.abs(DECK_SIZE - total)
  const verb = total < DECK_SIZE ? plural(diff, 'falta', 'faltan') : plural(diff, 'sobra', 'sobran')
  return {
    code: 'card_count',
    level: 'error',
    message: `Tiene ${total} ${plural(total, 'carta', 'cartas')}, ${verb} ${diff}`,
  }
}

function energyNameEs(energy: string): string {
  if (isSelectableEnergy(energy)) return ENERGY_NAME_ES[energy]
  if (energy === 'dragon' || energy === 'colorless') return NON_SELECTABLE_ENERGY_NAME_ES[energy]
  return energy
}

function canPayCost(cost: readonly string[], energies: ReadonlySet<string>): boolean {
  return cost.every((e) => e === 'colorless' || energies.has(e))
}

export function validateDeck(draft: DeckDraft, index: CatalogIndex, options: ValidateDeckOptions = {}): DeckValidation {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const infos: ValidationIssue[] = []
  const aliases = options.aliases ?? defaultEvolutionAliases(index)

  // Resolve entries; unknown ids are reported once each.
  const resolved: ResolvedEntry[] = []
  const unknown = new Set<CardId>()
  for (const entry of draft.cards) {
    if (!Number.isInteger(entry.count) || entry.count < 1) {
      errors.push({
        code: 'invalid_count',
        level: 'error',
        message: `Cantidad inválida para ${entry.cardId}: ${entry.count}`,
        cardIds: [entry.cardId],
      })
      continue
    }
    const card = index.cardById(entry.cardId)
    if (!card) {
      unknown.add(entry.cardId)
      continue
    }
    resolved.push({ card, count: entry.count })
  }
  for (const cardId of unknown) {
    errors.push({
      code: 'unknown_card',
      level: 'error',
      message: `No existe la carta ${cardId} en el catálogo`,
      cardIds: [cardId],
    })
  }

  // 20 cards.
  const countIssue = cardCountIssue(countCards(draft))
  if (countIssue) errors.push(countIssue)

  // ≤ 2 per English name, summing editions and groups.
  for (const copies of copiesByName(draft, index).values()) {
    if (copies.total <= MAX_COPIES_PER_NAME) continue
    const detail = copies.editions.map((e) => `${e.cardId} ×${e.count}`).join(', ')
    errors.push({
      code: 'copies_per_name',
      level: 'error',
      message: `${copies.nameEs} tiene ${copies.total} copias (${detail}); máximo ${MAX_COPIES_PER_NAME}`,
      cardIds: copies.editions.map((e) => e.cardId),
    })
  }

  // Same functional group in more than one edition (allowed, informative).
  const byGroup = new Map<CardId, EditionCopies[]>()
  for (const { card, count } of resolved) {
    const editions = byGroup.get(card.functionalGroupId) ?? []
    const edition = editions.find((e) => e.cardId === card.id)
    if (edition) edition.count += count
    else editions.push({ cardId: card.id, count })
    byGroup.set(card.functionalGroupId, editions)
  }
  for (const [groupId, editions] of byGroup) {
    if (editions.length < 2) continue
    const group = index.groupById(groupId)
    const total = editions.reduce((sum, e) => sum + e.count, 0)
    const detail = editions.map((e) => (e.count > 1 ? `${e.cardId} ×${e.count}` : e.cardId)).join(' + ')
    infos.push({
      code: 'same_group_split',
      level: 'info',
      message: `${group?.nameEs ?? groupId}: ${total} ${plural(total, 'copia', 'copias')} (${detail})`,
      cardIds: editions.map((e) => e.cardId),
    })
  }

  // At least one basic Pokémon (fossils are trainers, so they never count).
  const pokemon = resolved.filter((r) => r.card.cardType === 'pokemon')
  if (!pokemon.some((r) => r.card.evolutionType === 'basic')) {
    errors.push({ code: 'no_basic', level: 'error', message: 'No tiene ningún Pokémon Básico' })
  }

  // Evolution lines.
  const evolution = evolutionInfoFor(index)
  const nameEs = (nameEn: string): string => evolution.byNameEn.get(nameEn)?.nameEs ?? nameEn
  const namesInDeck = new Set<string>()
  for (const { card } of resolved) namesInDeck.add(card.nameEn)
  for (const alias of aliases) {
    if (resolved.some((r) => r.card.id === alias.cardId)) namesInDeck.add(alias.countsAs)
  }
  const hasRareCandy = namesInDeck.has(RARE_CANDY)
  const brokenLines = new Map<string, { nameEs: string; cardIds: CardId[]; requirement: string }>()
  for (const { card } of pokemon) {
    const from = card.evolvesFrom
    if (from === null || card.evolutionType === 'basic' || namesInDeck.has(from)) continue
    let requirement = `a ${nameEs(from)} en el mazo`
    if (card.evolutionType === 'stage2') {
      const basics = evolution.preEvolutionsOf.get(from) ?? []
      if (hasRareCandy && basics.some((b) => namesInDeck.has(b))) continue
      if (basics.length > 0) requirement += `, o a ${basics.map(nameEs).join(' / ')} con Caramelo Raro`
    }
    const broken = brokenLines.get(card.nameEn) ?? { nameEs: card.nameEs, cardIds: [], requirement }
    if (!broken.cardIds.includes(card.id)) broken.cardIds.push(card.id)
    brokenLines.set(card.nameEn, broken)
  }
  for (const broken of brokenLines.values()) {
    errors.push({
      code: 'evolution_line',
      level: 'error',
      message: `${broken.nameEs} (${broken.cardIds.join(', ')}) necesita ${broken.requirement}`,
      cardIds: broken.cardIds,
    })
  }

  // Energies.
  const energies = draft.energies as readonly string[]
  if (energies.length === 0) {
    errors.push({ code: 'energy_required', level: 'error', message: 'Elegí al menos una energía para el mazo' })
  }
  const selectable = new Set<SelectableEnergy>()
  for (const energy of new Set(energies)) {
    if (isSelectableEnergy(energy)) selectable.add(energy)
    else {
      errors.push({
        code: 'energy_not_selectable',
        level: 'error',
        message: `La energía ${energyNameEs(energy)} no se puede elegir en la Zona de Energía`,
      })
    }
  }

  // Energies vs attack costs (only meaningful once the selection is valid).
  if (energies.length > 0 && selectable.size === new Set(energies).size && pokemon.length > 0) {
    const used = new Set<string>()
    let anyAttacker = false
    const reported = new Set<CardId>()
    for (const { card } of pokemon) {
      let can = false
      for (const attack of card.attacks) {
        if (!canPayCost(attack.cost, selectable)) continue
        can = true
        for (const e of attack.cost) used.add(e)
      }
      if (can) anyAttacker = true
      else if (card.attacks.length > 0 && !reported.has(card.id)) {
        reported.add(card.id)
        infos.push({
          code: 'energy_missing_for_card',
          level: 'info',
          message: `${card.nameEs} (${card.id}) no puede usar ningún ataque con las energías elegidas`,
          cardIds: [card.id],
        })
      }
    }
    if (!anyAttacker) {
      errors.push({
        code: 'no_attacker',
        level: 'error',
        message: 'Ningún Pokémon del mazo puede atacar con las energías elegidas',
      })
    }
    for (const energy of selectable) {
      if (used.has(energy)) continue
      infos.push({
        code: 'energy_unused',
        level: 'info',
        message: `Ningún ataque del mazo pide energía de tipo ${ENERGY_NAME_ES[energy]}`,
      })
    }
  }

  return { ok: errors.length === 0, errors, warnings, infos }
}
