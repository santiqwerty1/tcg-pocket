/**
 * Deck snapshots for the engine (PLAN §3.7, §4 `DeckSnapshot`): the exact text deckgym plays, frozen when a job is
 * queued, and whether it can be simulated. deckgym implements trainers by edition id, so a reprint the engine does
 * not know yet (the 46 B4b reprints at fb792ebf, PLAN §7 Fase 6) is played as an implemented edition of the same
 * functional card (same name and text, so the game is the same). A card with no implemented edition, a deck without
 * energy (NOEX tournament lists) or a deck the engine would refuse makes the snapshot «no simulable», naming why.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardEdition, CardId, EnergyType, SelectableEnergy } from '../catalog/types.js'
import { SELECTABLE_ENERGIES } from '../catalog/types.js'
import { formatEnergyLineEn } from '../decks/deckgym.js'
import type { DeckCardEntry } from '../decks/types.js'
import { hashKey } from '../tournaments/dataset.js'

/** Whether the engine implements an edition, by deckgym id («A1 001»); undefined = the engine does not have it. */
export type EngineStatus = (engineId: string) => boolean | undefined

export type SnapshotProblem =
  | { kind: 'unknown_card'; cardId: string; message: string }
  | { kind: 'not_implemented'; cardId: CardId; nameEs: string; message: string }
  | { kind: 'energy_required'; suggested: SelectableEnergy[] | null; message: string }
  | { kind: 'size'; cards: number; message: string }
  | { kind: 'no_basic'; message: string }
  | { kind: 'too_many_copies'; nameEn: string; count: number; message: string }

export interface SnapshotCard {
  /** The edition of the deck. */
  cardId: CardId
  /** The edition the engine plays (another edition of the same functional card when the deck's is not implemented). */
  playedAs: CardId
  engineId: string
  count: number
}

export interface DeckSnapshotDraft {
  label: string
  energies: SelectableEnergy[]
  cards: SnapshotCard[]
  /** deckgym text: `Energy:` first, one line per entry with the edition actually played. */
  deckgymText: string
  /** Short hash of the text: two snapshots that play the same deck share it. */
  key: string
  simulable: boolean
  problems: SnapshotProblem[]
}

/** An edition the engine plays for `card`: itself when implemented, otherwise the display edition or the first one. */
export function engineEdition(card: CardEdition, index: CatalogIndex, status: EngineStatus): CardEdition | null {
  if (status(card.engineId) === true) return card
  const group = index.groupById(card.functionalGroupId)
  const ordered = [
    ...(group ? index.cardsOfGroup(group.id).filter((other) => other.id === group.displayCardId) : []),
    ...index.cardsOfGroup(card.functionalGroupId),
  ]
  return ordered.find((other) => status(other.engineId) === true) ?? null
}

/**
 * Energies a list probably uses when it does not say (NOEX lists): the types its attacks cost, Colorless left out.
 * Null when that is empty or includes a type the Energy Zone cannot generate: the owner chooses.
 */
export function suggestEnergies(cards: readonly DeckCardEntry[], index: CatalogIndex): SelectableEnergy[] | null {
  const types = new Set<EnergyType>()
  for (const entry of cards) {
    const card = index.cardById(entry.cardId)
    if (card?.cardType !== 'pokemon') continue
    for (const attack of card.attacks) for (const type of attack.cost) if (type !== 'colorless') types.add(type)
  }
  const selectable = SELECTABLE_ENERGIES.filter((energy) => types.has(energy))
  if (selectable.length === 0 || selectable.length !== types.size || selectable.length > 3) return null
  return [...selectable]
}

export interface BuildSnapshotInput {
  label: string
  cards: readonly DeckCardEntry[]
  energies: readonly SelectableEnergy[]
  index: CatalogIndex
  engine: EngineStatus
  /** Play unimplemented editions as an implemented edition of the same card (default true). */
  remap?: boolean
}

export function buildSnapshot(input: BuildSnapshotInput): DeckSnapshotDraft {
  const { index, engine } = input
  const remap = input.remap ?? true
  const problems: SnapshotProblem[] = []
  const cards: SnapshotCard[] = []
  const byName = new Map<string, number>()
  let total = 0
  let basics = 0
  for (const entry of input.cards) {
    const card = index.cardById(entry.cardId)
    if (!card) {
      problems.push({ kind: 'unknown_card', cardId: entry.cardId, message: `${entry.cardId} no está en el catálogo` })
      continue
    }
    total += entry.count
    if (card.cardType === 'pokemon' && card.evolutionType === 'basic') basics += entry.count
    byName.set(card.nameEn, (byName.get(card.nameEn) ?? 0) + entry.count)
    const played = engine(card.engineId) === true ? card : remap ? engineEdition(card, index, engine) : null
    if (!played) {
      problems.push({
        kind: 'not_implemented',
        cardId: card.id,
        nameEs: card.nameEs,
        message: `${card.nameEs} (${card.id}) no está implementada en el motor`,
      })
      continue
    }
    const existing = cards.find((item) => item.playedAs === played.id)
    if (existing && existing.cardId === card.id) existing.count += entry.count
    else cards.push({ cardId: card.id, playedAs: played.id, engineId: played.engineId, count: entry.count })
  }
  if (total !== 20) problems.push({ kind: 'size', cards: total, message: `tiene ${total} cartas (el motor pide 20)` })
  if (total > 0 && basics === 0) problems.push({ kind: 'no_basic', message: 'no tiene Pokémon Básico' })
  for (const [nameEn, count] of byName) {
    if (count > 2) {
      problems.push({ kind: 'too_many_copies', nameEn, count, message: `${count} copias de ${nameEn} (máximo 2)` })
    }
  }
  const energies = [...input.energies]
  if (energies.length === 0) {
    problems.push({
      kind: 'energy_required',
      suggested: suggestEnergies(input.cards, index),
      message: 'no tiene energía elegida: elegila antes de simular',
    })
  }
  const lines = cards.map((item) => {
    const played = index.cardById(item.playedAs) as CardEdition
    return `${item.count} ${played.nameEn} ${played.expansionId} ${played.number}`
  })
  const deckgymText = `${energies.length > 0 ? `${formatEnergyLineEn(energies)}\n` : ''}${lines.join('\n')}\n`
  return {
    label: input.label,
    energies,
    cards,
    deckgymText,
    key: hashKey(deckgymText),
    simulable: problems.length === 0,
    problems,
  }
}

/** One line for the UI: «no simulable: Helado de la Suerte (B4b-198) no está implementada en el motor». */
export function describeProblems(problems: readonly SnapshotProblem[]): string {
  return problems.map((problem) => problem.message).join('; ')
}
