import { describe, expect, it } from 'vitest'
import {
  type BotWarning,
  botWarnings,
  botWarningText,
  FAR_POINTS,
  farFromTournament,
  listBotWarnings,
} from '../../src/simulation/index.js'
import { deckDraft } from '../helpers/loadDecks.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const kinds = (warnings: BotWarning[]) => warnings.map((warning) => warning.kind)

describe('posible punto ciego del bot (H-055)', () => {
  it('deck 40: Ivysaur does no damage and Mega-Venusaur ex evolves from it, so e2 and e3 stall the line', () => {
    const deck = deckDraft(40)
    for (const bot of ['e2', 'e3', 'e2/e2', 'e2 contra e3']) {
      expect(listBotWarnings(deck.cards, index, bot)).toEqual([
        {
          kind: 'evolution_without_damage',
          cardId: 'B1a-2',
          nameEs: 'Ivysaur',
          nextEs: expect.stringMatching(/Venusaur/),
        },
      ])
    }
    // f2 evolves (H-018), and the other bots are not the e ones the rule was seen with.
    for (const bot of ['f2', 'm', 'r', null]) expect(listBotWarnings(deck.cards, index, bot)).toEqual([])
    expect(botWarningText(listBotWarnings(deck.cards, index, 'e2'), 'e2')).toBe(
      `Posible punto ciego del bot: e2 casi nunca evoluciona a Ivysaur, que no hace daño, así que el mazo casi no llega a ${
        index.cardById('B1a-4')?.nameEs
      }. Probalo con f2.`,
    )
  })

  it('deck 16: Dede-Circuit grows with the Tools in play, which e1 and e2 hardly put on the Bench; e3 does', () => {
    const deck = deckDraft(16)
    const warnings = listBotWarnings(deck.cards, index, 'e2')
    expect(warnings).toEqual([
      { kind: 'bench_tools', cardId: expect.any(String), nameEs: 'Dedenne ex', attack: 'Dede-Circuit' },
    ])
    expect(kinds(listBotWarnings(deck.cards, index, 'e1'))).toEqual(['bench_tools'])
    expect(listBotWarnings(deck.cards, index, 'e3')).toEqual([])
    expect(botWarningText(warnings, 'e2')).toBe(
      'Posible punto ciego del bot: e2 casi nunca pone herramientas en la Banca, y «Dede-Circuit» de Dedenne ex crece con ellas. Probalo con e3 o f2.',
    )
    // Review of the PR: without a Tool in the list, an attack per Tool asks nothing of the bot.
    const noTools = deck.cards.filter((entry) => index.cardById(entry.cardId)?.evolutionType !== 'tool')
    expect(noTools.length).toBeLessThan(deck.cards.length)
    expect(listBotWarnings(noTools, index, 'e2')).toEqual([])
  })

  it('«if this Pokémon has a Pokémon Tool attached» is no attack per Tool in play (Pachirisu ex, Melmetal ex)', () => {
    const entry = (cardId: string) => ({ cardId, count: 2 })
    expect(listBotWarnings([entry('A2-61'), entry('B1-174'), entry('A2-147')], index, 'e2')).toEqual([])
    expect(kinds(listBotWarnings([entry('B3b-24'), entry('A2-147')], index, 'e2'))).toEqual(['bench_tools'])
  })

  it('an evolution without damage warns only when the list has what evolves from it, and a Slowking does not count', () => {
    const ivysaur = index.cardById('B1a-2')
    const venusaur = index.cardById('B1a-4')
    const bulbasaur = index.cardById('A1-1')
    const strongIvysaur = index.cardById('A1-2')
    if (!ivysaur || !venusaur || !bulbasaur || !strongIvysaur) throw new Error('missing fixture cards')
    const entry = (cardId: string) => ({ cardId, count: 2 })
    // Without the Mega Venusaur ex, Ivysaur is the end of the line: nothing stalls.
    expect(listBotWarnings([entry('A1-1'), entry('B1a-2')], index, 'e2')).toEqual([])
    // Ivysaur that attacks for 60 is no blind spot.
    expect(listBotWarnings([entry('A1-1'), entry('A1-2'), entry('B1a-4')], index, 'e2')).toEqual([])
    // Two editions of the same card (B1a-2 and its reprint B4b-2) warn once.
    expect(index.cardById('B4b-2')?.functionalGroupId).toBe(ivysaur.functionalGroupId)
    expect(
      kinds(listBotWarnings([entry('A1-1'), entry('B1a-2'), entry('B4b-2'), entry('B1a-4')], index, 'e2')),
    ).toEqual(['evolution_without_damage'])
    // Review of the PR: Rare Candy skips the Stage 1, and an Ivysaur that does damage gets the line there.
    expect(listBotWarnings([entry('A1-1'), entry('B1a-2'), entry('B1a-4'), entry('A3-144')], index, 'e2')).toEqual([])
    expect(listBotWarnings([entry('A1-1'), entry('B1a-2'), entry('A1-2'), entry('B1a-4')], index, 'e2')).toEqual([])
  })

  it('the general rule: far by at least 15 points and with intervals apart, both ways', () => {
    expect(FAR_POINTS).toBe(15)
    // Deck 16 with e2 (18,8 % of 400) against its archetype (50,6 %).
    expect(farFromTournament({ value: 18.8, ci95: [15, 23] }, { value: 50.6, ci95: [47, 54] })).toEqual({
      kind: 'far_from_tournament',
      simulated: 18.8,
      tournament: 50.6,
    })
    // Over the tournament number too.
    expect(farFromTournament({ value: 75, ci95: [70, 80] }, { value: 50, ci95: [46, 54] })?.kind).toBe(
      'far_from_tournament',
    )
    // 20 points apart, but a short test whose interval reaches the tournament one: not yet.
    expect(farFromTournament({ value: 30, ci95: [12, 54] }, { value: 50, ci95: [46, 54] })).toBeNull()
    // Intervals apart but only 10 points: a real difference of list, not a blind spot.
    expect(farFromTournament({ value: 40, ci95: [38, 42] }, { value: 50, ci95: [48, 52] })).toBeNull()
    // The edges: exactly 15 points counts; intervals that touch do not count as apart.
    expect(farFromTournament({ value: 35, ci95: [33, 37] }, { value: 50, ci95: [48, 52] })?.kind).toBe(
      'far_from_tournament',
    )
    expect(farFromTournament({ value: 30, ci95: [25, 48] }, { value: 50, ci95: [48, 52] })).toBeNull()
  })

  it('botWarnings puts the list rules and the general one together; the general one alone asks for f2 or e3', () => {
    const deck = deckDraft(40)
    const far = {
      simulated: { value: 1.4, ci95: [0.5, 4] as const },
      tournament: { value: 45, ci95: [40, 50] as const },
    }
    expect(kinds(botWarnings({ cards: deck.cards, index, bot: 'e2', ...far }))).toEqual([
      'evolution_without_damage',
      'far_from_tournament',
    ])
    // With f2 the list rule goes, the far one stays and asks for the other bot.
    const f2 = botWarnings({ cards: deck.cards, index, bot: 'f2', ...far })
    expect(kinds(f2)).toEqual(['far_from_tournament'])
    expect(botWarningText(f2, 'f2')).toBe(
      'Posible punto ciego del bot: 1,4 % simulado contra 45 % del arquetipo en torneos. Probalo con e3.',
    )
    expect(botWarningText(botWarnings({ cards: [], index, bot: 'e2', ...far }), 'e2')).toMatch(/Probalo con f2 o e3\.$/)
    expect(
      botWarnings({ cards: deck.cards, index, bot: 'e2', simulated: far.simulated, tournament: null }),
    ).toHaveLength(1)
    expect(botWarningText([], 'e2')).toBeNull()
  })
})
