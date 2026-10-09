/**
 * Ejercicios de cálculo (Fase 30): short questions to practice the two counts the game asks for all the time, built
 * from the owner's own decks and graded at once.
 *
 * - «Robos»: the chance of having a card (or two cards at once) by an own turn, with four options; the answer is the
 *   exact value of `drawOdds` (Fase 10) and the explanation also shows the quick count without the Basic rule.
 * - «¿Llega al KO?»: an attacker of the deck against a Pokémon of the owner's decks with some damage on it; weakness
 *   adds 20 (the game's rule). Only attacks with a plain printed damage («60», not «30+» or «50x»).
 *
 * A question is fully determined by its kind, its deck and its seed, so the API rebuilds it to grade the answer.
 */
import type { EnergyType } from '../catalog/types.js'
import { type DrawGroup, drawOdds } from '../decks/drawOdds.js'
import { seededRandom } from '../lab/mutate.js'

export const DRILL_KINDS = ['draw', 'ko'] as const
export type DrillKind = (typeof DRILL_KINDS)[number]

export const DRILL_KIND_ES: Record<DrillKind, string> = { draw: 'Robos', ko: '¿Llega al KO?' }

/** The game's weakness rule: +20 damage. */
export const WEAKNESS_BONUS = 20

const ENERGY_ES: Record<EnergyType, string> = {
  grass: 'Planta',
  fire: 'Fuego',
  water: 'Agua',
  lightning: 'Rayo',
  psychic: 'Psíquica',
  fighting: 'Lucha',
  darkness: 'Oscuridad',
  metal: 'Metal',
  dragon: 'Dragón',
  colorless: 'Incolora',
}

export interface Drill {
  kind: DrillKind
  seed: number
  prompt: string
  /** What the question gives (one line each). */
  facts: string[]
  choices: string[]
  /** Index of the right choice. */
  answer: number
  explanation: string
}

const pick = <T>(random: () => number, items: readonly T[]): T => {
  const item = items[Math.floor(random() * items.length)]
  if (item === undefined) throw new Error('Nada para elegir.')
  return item
}

const percent = (value: number) => `${Math.round(value * 100)} %`

// ---------------------------------------------------------------------------------------------------------------
// Robos
// ---------------------------------------------------------------------------------------------------------------

export interface DrillDeckCard {
  groupId: string
  nameEs: string
  copies: number
  basic: boolean
}

export interface DrillDeck {
  name: string
  cards: readonly DrillDeckCard[]
}

function choose(n: number, k: number): number {
  if (k < 0 || n < 0 || k > n) return 0
  let result = 1
  for (let i = 1; i <= Math.min(k, n - k); i++) result = (result * (n - i + 1)) / i
  return result
}

/** Four options 15 points apart around the exact value (in a random place), within 0–100 %. */
function percentChoices(exact: number, random: () => number): { choices: string[]; answer: number } {
  const value = Math.round(exact * 100)
  const slot = Math.floor(random() * 4)
  let start = value - slot * 15
  if (start < 1) start = Math.min(value, 1)
  if (start + 45 > 99) start = Math.max(1, Math.min(start, 99 - 45))
  const values = [0, 1, 2, 3].map((i) => start + i * 15)
  // The exact value goes in the option it is closest to (it may have moved with the clamp).
  let answer = 0
  for (let i = 1; i < 4; i++) {
    if (Math.abs((values[i] ?? 0) - value) < Math.abs((values[answer] ?? 0) - value)) answer = i
  }
  values[answer] = value
  return { choices: values.map((v) => `${v} %`), answer }
}

const TURN_ES = (turn: number) => (turn === 0 ? 'en la mano inicial' : `al empezar tu turno ${turn} (después de robar)`)

export function drawDrill(deck: DrillDeck, seed: number): Drill {
  const random = seededRandom(seed)
  const deckSize = deck.cards.reduce((sum, card) => sum + card.copies, 0)
  const basics = deck.cards.reduce((sum, card) => sum + (card.basic ? card.copies : 0), 0)
  if (deckSize === 0 || basics === 0) throw new Error('El mazo no tiene Pokémon Básicos.')
  const turn = pick(random, [0, 1, 1, 2, 2, 3, 4])
  const two = deck.cards.length >= 2 && random() < 0.35
  const first = pick(random, deck.cards)
  const second = two
    ? pick(
        random,
        deck.cards.filter((card) => card.groupId !== first.groupId),
      )
    : null
  const group = (card: DrillDeckCard): DrawGroup => ({
    basic: card.basic ? card.copies : 0,
    other: card.basic ? 0 : card.copies,
  })
  const groups = second ? [group(first), group(second)] : [group(first)]
  const row = drawOdds({ deckSize, basics, groups, turns: turn }).rows.find((item) => item.turn === turn)
  const exact = second ? (row?.all ?? 0) : (row?.each[0] ?? 0)
  const seen = 5 + turn
  const { choices, answer } = percentChoices(exact, random)
  const copies = (card: DrillDeckCard) => `${card.copies} ${card.copies === 1 ? 'copia' : 'copias'} de ${card.nameEs}`
  // The quick count: 1 − P(none) with a fair deal, ignoring the opening-hand rule.
  const none = (card: DrillDeckCard) => choose(deckSize - card.copies, seen) / choose(deckSize, seen)
  const quick = second
    ? 1 - none(first) - none(second) + choose(deckSize - first.copies - second.copies, seen) / choose(deckSize, seen)
    : 1 - none(first)
  return {
    kind: 'draw',
    seed,
    prompt: second
      ? `¿Qué probabilidad hay de tener a la vez ${first.nameEs} y ${second.nameEs} ${TURN_ES(turn)}?`
      : `¿Qué probabilidad hay de tener al menos una copia de ${first.nameEs} ${TURN_ES(turn)}?`,
    facts: [
      `Mazo ${deck.name}: ${deckSize} cartas, ${basics} Pokémon Básicos.`,
      second ? `${copies(first)} y ${copies(second)}.` : `${copies(first)}.`,
      turn === 0
        ? 'Mano inicial de 5 cartas con al menos un Básico.'
        : `Mano inicial de 5 y 1 carta por turno: ${TURN_ES(turn)} viste ${seen} cartas. Sin contar cartas que roban o buscan.`,
    ],
    choices,
    answer,
    explanation: second
      ? `Es ${percent(exact)}. Cuenta rápida: 1 − P(sin ${first.nameEs}) − P(sin ${second.nameEs}) + P(sin ninguna) con ${seen} cartas de ${deckSize} = ${percent(quick)}; la regla del Básico en la mano inicial lo mueve un poco.`
      : `Es ${percent(exact)}. Cuenta rápida: 1 − P(ninguna en ${seen} de ${deckSize}) = 1 − C(${deckSize - first.copies},${seen})/C(${deckSize},${seen}) = ${percent(quick)}; la regla del Básico en la mano inicial lo mueve un poco${first.basic ? ' (a favor: es un Básico)' : ''}.`,
  }
}

// ---------------------------------------------------------------------------------------------------------------
// ¿Llega al KO?
// ---------------------------------------------------------------------------------------------------------------

export interface DrillPokemon {
  nameEs: string
  hp: number
  energy: EnergyType
  weakness: EnergyType | null
  /** Prize points it gives when knocked out (2 ex, 3 Mega ex). */
  prizePoints: number
  /** Attacks with a plain printed damage. */
  attacks: readonly { name: string; damage: number }[]
}

/** «60» → 60; «30+», «50x» or none → null (their damage depends on the game). */
export function plainDamage(damage: string | null): number | null {
  return damage && /^\d+$/.test(damage.trim()) ? Number(damage.trim()) : null
}

export function koDrill(attackers: readonly DrillPokemon[], defenders: readonly DrillPokemon[], seed: number): Drill {
  const random = seededRandom(seed)
  const usable = attackers.filter((pokemon) => pokemon.attacks.some((attack) => attack.damage > 0))
  if (usable.length === 0 || defenders.length === 0) throw new Error('No hay Pokémon con ataques de daño fijo.')
  const attacker = pick(random, usable)
  const attack = pick(
    random,
    attacker.attacks.filter((item) => item.damage > 0),
  )
  // Weakness more often than chance would give, so it is practiced.
  const weak = defenders.filter((pokemon) => pokemon.weakness === attacker.energy)
  const defender = weak.length > 0 && random() < 0.4 ? pick(random, weak) : pick(random, defenders)
  const bonus = defender.weakness === attacker.energy ? WEAKNESS_BONUS : 0
  const damage = attack.damage + bonus
  const taken = Math.floor(random() * Math.floor(defender.hp / 10)) * 10
  const left = defender.hp - taken
  const variant = pick(random, ['ko', 'ko', 'hits', 'damage'] as const)
  const facts = [
    `Tu ${attacker.nameEs} (${ENERGY_ES[attacker.energy]}) usa «${attack.name}»: ${attack.damage} de daño.`,
    `${defender.nameEs} del rival: ${defender.hp} PS${taken > 0 ? `, con ${taken} de daño (le quedan ${left})` : ''}; debilidad: ${defender.weakness ? ENERGY_ES[defender.weakness] : 'ninguna'}.`,
    'La debilidad suma 20 al daño. Sin herramientas ni efectos de otras cartas.',
  ]
  const why = `${attack.damage}${bonus > 0 ? ` + 20 por debilidad = ${damage}` : ' (sin debilidad)'} contra ${left} PS`
  if (variant === 'ko') {
    const ko = damage >= left
    return {
      kind: 'ko',
      seed,
      prompt: `¿«${attack.name}» deja KO a ${defender.nameEs} este turno?`,
      facts,
      choices: ['Sí', 'No'],
      answer: ko ? 0 : 1,
      explanation: `${ko ? 'Sí' : 'No'}: ${why}${ko ? '.' : `; le quedarían ${left - damage}.`}${defender.prizePoints > 1 ? ` Da ${defender.prizePoints} puntos de premio.` : ''}`,
    }
  }
  if (variant === 'hits') {
    const hits = Math.ceil(left / damage)
    const answer = Math.min(hits, 4) - 1
    return {
      kind: 'ko',
      seed,
      prompt: `¿Cuántos ataques de «${attack.name}» hacen falta para dejar KO a ${defender.nameEs}?`,
      facts,
      choices: ['1', '2', '3', '4 o más'],
      answer,
      explanation: `${hits === 1 ? 'Uno' : hits}: ${why}; ${left} ÷ ${damage} redondeado para arriba = ${hits}.`,
    }
  }
  const options = new Set<number>([damage, attack.damage, damage + 10, Math.max(10, damage - 10)])
  for (let extra = 20; options.size < 4; extra += 10) options.add(damage + extra)
  const values = [...options].slice(0, 4).sort((a, b) => a - b)
  return {
    kind: 'ko',
    seed,
    prompt: `¿Cuánto daño le hace «${attack.name}» a ${defender.nameEs}?`,
    facts: [facts[0] ?? '', facts[1] ?? '', 'Sin herramientas ni efectos de otras cartas.'],
    choices: values.map(String),
    answer: values.indexOf(damage),
    explanation: `${damage}: ${attack.damage}${bonus > 0 ? ` + 20, porque ${defender.nameEs} es débil a ${ENERGY_ES[attacker.energy]}` : `; ${defender.nameEs} no es débil a ${ENERGY_ES[attacker.energy]}`}.`,
  }
}

export interface DrillGrade {
  correct: boolean
  answer: number
  explanation: string
}

export function gradeDrill(drill: Drill, choice: number): DrillGrade {
  return { correct: choice === drill.answer, answer: drill.answer, explanation: drill.explanation }
}

/** What the screen shows before answering. */
export function drillQuestion(drill: Drill): Omit<Drill, 'answer' | 'explanation'> {
  const { answer: _answer, explanation: _explanation, ...question } = drill
  return question
}
