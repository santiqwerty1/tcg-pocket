import { describe, expect, it } from 'vitest'
import { drawOdds } from '../../src/decks/drawOdds.js'
import {
  type DrillDeck,
  type DrillPokemon,
  drawDrill,
  drillQuestion,
  gradeDrill,
  koDrill,
  plainDamage,
} from '../../src/drills/index.js'

const DECK: DrillDeck = {
  name: '2. Mega-Blaziken ex',
  cards: [
    { groupId: 'B1-33', nameEs: 'Torchic', copies: 2, basic: true },
    { groupId: 'B1-36', nameEs: 'Mega-Blaziken ex', copies: 2, basic: false },
    { groupId: 'A3-144', nameEs: 'Caramelo Raro', copies: 2, basic: false },
    { groupId: 'P-A-5', nameEs: 'Poké Ball', copies: 2, basic: false },
    { groupId: 'P-A-7', nameEs: 'Investigación de Profesores', copies: 2, basic: false },
    { groupId: 'B1-44', nameEs: 'Heatmor', copies: 1, basic: true },
    { groupId: 'X', nameEs: 'Otras', copies: 9, basic: false },
  ],
}

const BLAZIKEN: DrillPokemon = {
  nameEs: 'Mega-Blaziken ex',
  hp: 220,
  energy: 'fire',
  weakness: 'water',
  prizePoints: 3,
  attacks: [{ name: 'Blaze Kick', damage: 120 }],
}
const SCIZOR: DrillPokemon = {
  nameEs: 'Scizor',
  hp: 120,
  energy: 'metal',
  weakness: 'fire',
  prizePoints: 1,
  attacks: [{ name: 'Iron Claw', damage: 60 }],
}
const GYARADOS: DrillPokemon = {
  nameEs: 'Gyarados ex',
  hp: 180,
  energy: 'water',
  weakness: 'lightning',
  prizePoints: 2,
  attacks: [{ name: 'Hyper Beam', damage: 100 }],
}

describe('ejercicios de cálculo (Fase 30)', () => {
  it('«Robos»: the right option is the exact odds of drawOdds, four options 15 points apart', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const drill = drawDrill(DECK, seed)
      expect(drill.choices).toHaveLength(4)
      const values = drill.choices.map((choice) => Number.parseInt(choice, 10))
      expect(new Set(values).size).toBe(4)
      expect(values.every((value) => value >= 0 && value <= 100)).toBe(true)
      expect(drill).toEqual(drawDrill(DECK, seed))
      expect(drill.facts[0]).toBe('Mazo 2. Mega-Blaziken ex: 20 cartas, 3 Pokémon Básicos.')
    }
    // A question about one card: the number checked against drawOdds directly.
    const single = Array.from({ length: 600 }, (_, i) => drawDrill(DECK, i + 1)).find(
      (drill) => drill.prompt.includes('al menos una copia de Caramelo Raro') && drill.prompt.includes('turno 2'),
    )
    expect(single).toBeDefined()
    const exact = drawOdds({ deckSize: 20, basics: 3, groups: [{ basic: 0, other: 2 }], turns: 2 }).rows[2]?.each[0]
    expect(single?.choices[single.answer]).toBe(`${Math.round((exact ?? 0) * 100)}\u00a0%`)
    expect(single?.explanation).toMatch(/^Es \d+ %\. Cuenta rápida: 1 − P\(ninguna en 7 de 20\)/)
  })

  it('«Robos» asks for two cards at once too', () => {
    const both = Array.from({ length: 80 }, (_, i) => drawDrill(DECK, i + 1)).find((drill) =>
      drill.prompt.includes('a la vez'),
    )
    expect(both?.facts[1]).toMatch(/copias? de .+ y \d copias? de /)
  })

  it('«¿Llega al KO?»: weakness adds 20 and the answer follows the numbers', () => {
    expect(plainDamage('60')).toBe(60)
    expect(plainDamage('30+')).toBeNull()
    expect(plainDamage('50x')).toBeNull()
    expect(plainDamage(null)).toBeNull()
    let weakSeen = false
    for (let seed = 1; seed <= 200; seed++) {
      const drill = koDrill([BLAZIKEN], [SCIZOR, GYARADOS], seed)
      expect(drill).toEqual(koDrill([BLAZIKEN], [SCIZOR, GYARADOS], seed))
      expect(drill.answer).toBeGreaterThanOrEqual(0)
      expect(drill.answer).toBeLessThan(drill.choices.length)
      const left = /le quedan (\d+)/.exec(drill.facts[1] ?? '')
      const hp = drill.facts[1]?.startsWith('Scizor') ? 120 : 180
      const remaining = left ? Number(left[1]) : hp
      const damage = drill.facts[1]?.startsWith('Scizor') ? 140 : 120
      if (drill.facts[1]?.startsWith('Scizor')) weakSeen = true
      if (drill.prompt.startsWith('¿«Blaze Kick» deja KO')) {
        expect(drill.choices[drill.answer]).toBe(damage >= remaining ? 'Sí' : 'No')
      } else if (drill.prompt.startsWith('¿Cuántos ataques')) {
        expect(drill.choices[drill.answer]).toBe(
          String(Math.min(Math.ceil(remaining / damage), 4)).replace('4', '4 o más'),
        )
      } else {
        expect(drill.choices[drill.answer]).toBe(String(damage))
        expect(new Set(drill.choices).size).toBe(4)
      }
    }
    expect(weakSeen).toBe(true)
  })

  it('grades a choice and hides the answer from the question', () => {
    const drill = koDrill([BLAZIKEN], [SCIZOR], 7)
    const question = drillQuestion(drill)
    expect(question).not.toHaveProperty('answer')
    expect(question).not.toHaveProperty('explanation')
    expect(gradeDrill(drill, drill.answer)).toMatchObject({ correct: true, answer: drill.answer })
    expect(gradeDrill(drill, (drill.answer + 1) % drill.choices.length).correct).toBe(false)
    expect(() => koDrill([{ ...BLAZIKEN, attacks: [] }], [SCIZOR], 1)).toThrow(/daño fijo/)
  })
})
