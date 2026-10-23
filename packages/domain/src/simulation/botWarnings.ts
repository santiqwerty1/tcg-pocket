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
 * - **The number far from tournaments:** the simulated rate and what the archetype makes in tournaments against the
 *   same rivals with the same weights, with intervals that do not overlap and at least `FAR_POINTS` apart: «probalo con
 *   f2 o e3» («probalo con e3» for a g bot). Only when the tournament number is mostly matchups (`FAR_MIN_COVERAGE`)
 *   and has `ORIENTATIVE_BELOW` matches (review of #119: an archetype never seen against the rivals gives its overall
 *   rate, with a narrow interval).
 * The list rules read the catalog (`blindSpotsOf`, T-017 A3), not the engine, and only for the e bots: g (the bot by
 * default since 23/10/2026, D-029) attaches the Tools and evolves into Ivysaur (docs/BOTS.md, g 1.1), so it gets only
 * the general rule.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardEdition, CardId } from '../catalog/types.js'
import type { DeckCardEntry } from '../decks/types.js'
import { formatPercentEs, ORIENTATIVE_BELOW } from '../stats/rates.js'
import { blindSpotsOf } from './blindSpots.js'

export type BotWarning =
  /** `nameEs` has no damaging attack and `nextEs`, also in the list, evolves from it. */
  | { kind: 'evolution_without_damage'; cardId: CardId; nameEs: string; nextEs: string }
  /** `attack` of `nameEs` (the catalog has attack names only in English) does damage for each Pokémon Tool in play. */
  | { kind: 'bench_tools'; cardId: CardId; nameEs: string; attack: string }
  /** The simulated rate (0–100) is far from the archetype's in tournaments. */
  | { kind: 'far_from_tournament'; simulated: number; tournament: number }

/** A rate with its 95 % interval, 0–100 like `WinRate`, `MetaScore` and `ExpectedVsMeta`. */
export interface RateWithInterval {
  value: number
  ci95: readonly [number, number]
}

/** The tournament number (`ExpectedVsMeta`): its rate and interval, and how much of it is data. */
export interface TournamentRate extends RateWithInterval {
  /** Share (0–100) of the rivals' weight whose matchup has enough matches; the rest is the archetype's overall rate. */
  coverage: number
  /** The archetype's matches counted. */
  matches: number
}

/** Points the simulated rate has to be from the tournament one, besides the intervals not overlapping. */
export const FAR_POINTS = 15

/** Below this coverage (0–100) the tournament number is mostly a prior, not matchups: the general rule says nothing. */
export const FAR_MIN_COVERAGE = 50

/** «for each Pokémon Tool attached to all of your Pokémon» (Dedenne ex, Emolga); not the Tools discarded from the hand. */
const PER_TOOL = /\bfor each Pok[eé]mon Tool attached\b/i

/** The bot of the deck's side: «e2», or the first of «e2/e3» and of the Laboratorio's «e2 contra e3»; null if none. */
function botCode(bot: string | null | undefined): string | null {
  return (bot ?? '').trim().split(/[\s/]+/)[0] || null
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
  // Review of the PR: Rare Candy skips the Stage 1, so the line does not hang on it; and without a Tool in the list,
  // an attack per Tool asks nothing of the bot.
  const rareCandy = editions.some((card) => card.nameEn === 'Rare Candy')
  const tools = editions.some((card) => card.evolutionType === 'tool')
  const warnings: BotWarning[] = []
  for (const card of editions) {
    const stalls = (edition: CardEdition) => blindSpotsOf(edition).includes('stage_without_damage')
    if (!rareCandy && stalls(card)) {
      const next = editions.find((other) => other.cardType === 'pokemon' && other.evolvesFrom === card.nameEn)
      // Another edition of the same stage that does damage (Ivysaur A1-2 next to B1a-2) gets the line there.
      const another = editions.some((other) => other.nameEn === card.nameEn && other.evolvesFrom && !stalls(other))
      if (next && !another)
        warnings.push({ kind: 'evolution_without_damage', cardId: card.id, nameEs: card.nameEs, nextEs: next.nameEs })
    }
    // e3 already sees the Tool on the Bench and then the attack (Rayquaza: 4 % with e2, 49 % with e3).
    const attack = depth <= 2 && tools ? card.attacks.find((a) => PER_TOOL.test(a.effect ?? '')) : undefined
    if (attack) warnings.push({ kind: 'bench_tools', cardId: card.id, nameEs: card.nameEs, attack: attack.name })
  }
  return warnings
}

/**
 * The general rule: the simulated rate far from the tournament one, by `FAR_POINTS` and with no overlap, when the
 * tournament number covers `FAR_MIN_COVERAGE` of the rivals and has `ORIENTATIVE_BELOW` matches.
 */
export function farFromTournament(simulated: RateWithInterval, tournament: TournamentRate): BotWarning | null {
  if (tournament.coverage < FAR_MIN_COVERAGE || tournament.matches < ORIENTATIVE_BELOW) return null
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
  tournament?: TournamentRate | null
}): BotWarning[] {
  const warnings = listBotWarnings(input.cards, input.index, input.bot)
  const far = input.simulated && input.tournament ? farFromTournament(input.simulated, input.tournament) : null
  return far ? [...warnings, far] : warnings
}

/** One warning in Spanish, without the advice. */
export function botWarningEs(warning: BotWarning, bot: string | null | undefined): string {
  const who = botCode(bot) ?? 'el bot'
  switch (warning.kind) {
    case 'evolution_without_damage':
      return `${who} casi nunca evoluciona a ${warning.nameEs}, que no hace daño, así que el mazo casi no llega a ${warning.nextEs}`
    case 'bench_tools':
      return `${who} casi nunca pone herramientas en la Banca, y «${warning.attack}» de ${warning.nameEs} crece con ellas`
    case 'far_from_tournament':
      return `${formatPercentEs(warning.simulated)} simulado contra ${formatPercentEs(warning.tournament)} del arquetipo en torneos contra los mismos rivales`
  }
}

/**
 * Which bots to try instead: f2 sees evolutions, only e3 the Tool on the Bench and then the attack; never the same one.
 * A g bot's number far from tournaments (D-029, g2 by default since 23/10/2026) is told to try e3 alone: it is the one
 * that calibrated as well as g2 against the tournaments (155 of 233 compatible pairs, ρ 0,41), while f2 sees less than
 * g2 does (g2 beats it 62–64 % in the bots' league, docs/BOTS.md).
 */
function advice(warnings: readonly BotWarning[], bot: string | null | undefined): string {
  const code = botCode(bot)
  const bots: string[] = []
  const add = (other: string) => {
    if (other !== code && !bots.includes(other)) bots.push(other)
  }
  for (const warning of warnings) {
    if (warning.kind === 'evolution_without_damage') add('f2')
    // f2's clock reads fixed damage too, so a Tool on the Bench is worth nothing to it either (deck 16: 16,0 % with f2,
    // job 52); e3 sees the Tool and then the attack (review of #119).
    if (warning.kind === 'bench_tools') add('e3')
  }
  if (bots.length === 0) {
    if (!/^g[1-9]$/.test(code ?? '')) add('f2')
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
