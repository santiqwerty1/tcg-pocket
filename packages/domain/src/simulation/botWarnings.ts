/**
 * H-055: «posible punto ciego del bot», the warning next to a simulated number that the bots, more than the deck, may
 * explain. In the test of Santi's 41 decks against the meta (14/10/2026) three lists gave numbers far from their
 * archetypes' in tournaments, and the engine reproduced them with the same seeds: no deckgym bug, the bots' clock.
 * - **An evolution without damage in the middle of a line** (Ivysaur, the only way to Mega-Venusaur ex): e2 and e3 never
 *   evolved into it (72 times among the options in 20 replays), since their clock counts only fixed damage and an
 *   attack without damage reads as a side that cannot win. f2 does (deck 40: 1,4 % with e2, 116–84 against Lucario
 *   with f2).
 * - **An attack that grows with the Pokémon Tools in play** (Dede-Circuit): e1 and e2 hardly ever attach a Tool to the
 *   Bench, because their value function counts only the Active's and attaching, then attacking, is deeper than they
 *   look (deck 16: 18,8 % with e2 against 50,6 % for the archetype; against Rayquaza, 4 % with e2 and 49 % with e3).
 * - **The number far from tournaments:** the simulated rate and the archetype's tournament rate, both against the meta,
 *   with intervals that do not overlap and at least `FAR_POINTS` apart: «probalo con f2 o e3».
 * The list rules read the catalog (`blindSpotsOf`, T-017 A3), not the engine.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardEdition, CardId } from '../catalog/types.js'
import type { DeckCardEntry } from '../decks/types.js'
import { blindSpotsOf } from './blindSpots.js'

export type BotWarning =
  /** `nameEs` has no damaging attack and `nextEs`, also in the list, evolves from it. */
  | { kind: 'evolution_without_damage'; cardId: CardId; nameEs: string; nextEs: string }
  /** `attack` of `nameEs` (the catalog has attack names only in English) does damage for each Pokémon Tool in play. */
  | { kind: 'bench_tools'; cardId: CardId; nameEs: string; attack: string }
  /** The simulated rate (0–1) is far from the archetype's in tournaments. */
  | { kind: 'far_from_tournament'; simulated: number; tournament: number }

/** A rate with its 95 % interval (0–1). */
export interface RateWithInterval {
  value: number
  ci95: readonly [number, number]
}

/** Points (0–1) the simulated rate has to be from the tournament one, besides the intervals not overlapping. */
export const FAR_POINTS = 0.15

/** «for each Pokémon Tool attached to all of your Pokémon» (Dedenne ex, Emolga); not the Tools discarded from the hand. */
const PER_TOOL = /\bfor each Pok[eé]mon Tool attached\b/i

/** The bot of the deck's side («e2/e2» reads the first one), or null. */
function botCode(bot: string | null | undefined): string | null {
  return (bot ?? '').split('/')[0]?.trim() || null
}

/** The e bots (deckgym's expectiminimax), with their depth; null for any other. */
function expectiminimaxDepth(bot: string | null | undefined): number | null {
  const match = /^e([1-9])$/.exec(botCode(bot) ?? '')
  return match ? Number(match[1]) : null
}

/** The list rules: the cards the e bots play badly, once per functional card, in list order. */
export function listBotWarnings(
  cards: readonly DeckCardEntry[],
  index: CatalogIndex,
  bot: string | null | undefined,
): BotWarning[] {
  const depth = expectiminimaxDepth(bot)
  if (depth === null) return []
  const editions: CardEdition[] = []
  const seen = new Set<CardId>()
  for (const entry of cards) {
    const card = index.cardById(entry.cardId)
    if (!card || seen.has(card.functionalGroupId)) continue
    seen.add(card.functionalGroupId)
    editions.push(card)
  }
  const warnings: BotWarning[] = []
  for (const card of editions) {
    if (blindSpotsOf(card).includes('stage_without_damage')) {
      const next = editions.find((other) => other.cardType === 'pokemon' && other.evolvesFrom === card.nameEn)
      if (next)
        warnings.push({ kind: 'evolution_without_damage', cardId: card.id, nameEs: card.nameEs, nextEs: next.nameEs })
    }
    // e3 already sees the Tool on the Bench and then the attack (Rayquaza: 4 % with e2, 49 % with e3).
    const attack = depth <= 2 ? card.attacks.find((a) => PER_TOOL.test(a.effect ?? '')) : undefined
    if (attack) warnings.push({ kind: 'bench_tools', cardId: card.id, nameEs: card.nameEs, attack: attack.name })
  }
  return warnings
}

/** The general rule: the simulated rate far from the tournament one, by `FAR_POINTS` and with no overlap. */
export function farFromTournament(simulated: RateWithInterval, tournament: RateWithInterval): BotWarning | null {
  const apart = Math.abs(simulated.value - tournament.value) >= FAR_POINTS
  const disjoint = simulated.ci95[1] < tournament.ci95[0] || tournament.ci95[1] < simulated.ci95[0]
  return apart && disjoint
    ? { kind: 'far_from_tournament', simulated: simulated.value, tournament: tournament.value }
    : null
}

/** Every warning of a simulated number: the list rules (only for the e bots) and the general one. */
export function botWarnings(input: {
  cards: readonly DeckCardEntry[]
  index: CatalogIndex
  /** The bot that played the deck («e2», «f2»…). */
  bot: string | null | undefined
  simulated?: RateWithInterval | null
  tournament?: RateWithInterval | null
}): BotWarning[] {
  const warnings = listBotWarnings(input.cards, input.index, input.bot)
  const far = input.simulated && input.tournament ? farFromTournament(input.simulated, input.tournament) : null
  return far ? [...warnings, far] : warnings
}

const percent = (value: number) => `${Math.round(value * 100)} %`

/** One warning in Spanish, without the advice. */
export function botWarningEs(warning: BotWarning, bot: string | null | undefined): string {
  const who = botCode(bot) ?? 'el bot'
  switch (warning.kind) {
    case 'evolution_without_damage':
      return `${who} casi nunca evoluciona a ${warning.nameEs}, que no hace daño, así que el mazo casi no llega a ${warning.nextEs}`
    case 'bench_tools':
      return `${who} casi nunca pone herramientas en la Banca, y «${warning.attack}» de ${warning.nameEs} crece con ellas`
    case 'far_from_tournament':
      return `${percent(warning.simulated)} simulado contra ${percent(warning.tournament)} del arquetipo en torneos`
  }
}

/** Which bots to try instead: f2 sees evolutions, e3 the Tool on the Bench and then the attack; never the same one. */
function advice(warnings: readonly BotWarning[], bot: string | null | undefined): string {
  const code = botCode(bot)
  const bots: string[] = []
  const add = (other: string) => {
    if (other !== code && !bots.includes(other)) bots.push(other)
  }
  for (const warning of warnings) {
    if (warning.kind === 'evolution_without_damage') add('f2')
    if (warning.kind === 'bench_tools') {
      add('e3')
      add('f2')
    }
  }
  if (bots.length === 0) {
    add('f2')
    add('e3')
  }
  return bots.length === 1 ? `probalo con ${bots[0]}` : `probalo con ${bots.slice(0, -1).join(', ')} o ${bots.at(-1)}`
}

/** The warning of a simulated number in one sentence, or null when nothing applies. */
export function botWarningText(warnings: readonly BotWarning[], bot: string | null | undefined): string | null {
  if (warnings.length === 0) return null
  const reasons = warnings.map((warning) => botWarningEs(warning, bot)).join('; ')
  return `Posible punto ciego del bot: ${reasons}. ${capitalize(advice(warnings, bot))}.`
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
