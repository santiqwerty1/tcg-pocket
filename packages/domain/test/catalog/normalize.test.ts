import { describe, expect, it } from 'vitest'
import {
  buildSearchText,
  cleanRulesText,
  foldText,
  hashText,
  normalizeAttack,
  normalizeAttackName,
  normalizeCost,
  normalizeDamage,
  normalizeEffect,
  normalizeWeakness,
  prizePointsOf,
  rulesHashOf,
  rulesTextOf,
} from '../../src/index.js'
import { builtCatalog } from '../helpers/loadFixtures.js'

describe('cleanRulesText', () => {
  it('removes the scraped "Illustrated by <artist>" tail and trims', () => {
    const scraped =
      "Shuffle your hand into your deck. Draw a card for each card in your opponent's hand.\n\n            \n                    \n    \n            Illustrated by \n            \n                Yuu Nishida"
    expect(cleanRulesText(scraped)).toBe(
      "Shuffle your hand into your deck. Draw a card for each card in your opponent's hand.",
    )
    expect(cleanRulesText('Already clean.')).toBe('Already clean.')
    expect(cleanRulesText(cleanRulesText(scraped))).toBe(cleanRulesText(scraped))
  })
})

describe('attack normalization', () => {
  it('keeps printed damage and drops leaked words and the "0" placeholder', () => {
    expect(normalizeDamage('30')).toBe('30')
    expect(normalizeDamage('30+')).toBe('30+')
    expect(normalizeDamage('50x')).toBe('50x')
    expect(normalizeDamage('140-')).toBe('140-')
    expect(normalizeDamage('Friend', 'Find a')).toBeNull()
    expect(normalizeDamage('Toss', 'Toasty')).toBeNull()
    expect(normalizeDamage('0', 'Sing')).toBeNull()
  })

  it('restores the attack name when its last word leaked into damage', () => {
    expect(normalizeAttackName('Find a', 'Friend')).toBe('Find a Friend')
    expect(normalizeAttackName('Vine Whip', '40')).toBe('Vine Whip')
    expect(normalizeAttackName('Sing', '0')).toBe('Sing')
  })

  it('normalizes cost, effect and the whole attack', () => {
    expect(normalizeCost(['No Cost'])).toEqual([])
    expect(normalizeCost(['grass', 'colorless'])).toEqual(['grass', 'colorless'])
    expect(() => normalizeCost(['plasma'])).toThrow(/plasma/)
    expect(normalizeEffect('No effect')).toBeNull()
    expect(normalizeEffect('  ')).toBeNull()
    expect(normalizeEffect('Heal 20 damage.')).toBe('Heal 20 damage.')
    expect(
      normalizeAttack({ cost: ['No Cost'], name: 'Toasty', damage: 'Toss', effect: 'Take a [R] Energy.' }),
    ).toEqual({
      cost: [],
      name: 'Toasty Toss',
      damage: null,
      effect: 'Take a [R] Energy.',
    })
  })
})

describe('field normalization', () => {
  it('maps weakness N/A and none to null', () => {
    expect(normalizeWeakness('N/A')).toBeNull()
    expect(normalizeWeakness('none')).toBeNull()
    expect(normalizeWeakness('fire')).toBe('fire')
    expect(() => normalizeWeakness('plasma')).toThrow()
  })

  it('computes prize points', () => {
    expect(prizePointsOf({ cardType: 'trainer', ex: false, nameEn: 'Copycat' })).toBe(0)
    expect(prizePointsOf({ cardType: 'pokemon', ex: false, nameEn: 'Bulbasaur' })).toBe(1)
    expect(prizePointsOf({ cardType: 'pokemon', ex: true, nameEn: 'Charizard ex' })).toBe(2)
    expect(prizePointsOf({ cardType: 'pokemon', ex: true, nameEn: 'Mega Charizard X ex' })).toBe(3)
    expect(prizePointsOf({ cardType: 'pokemon', ex: false, nameEn: 'Meganium' })).toBe(1)
  })

  it('folds text case- and accent-insensitively', () => {
    expect(foldText('  Ámbar   Viejo ')).toBe('ambar viejo')
    expect(foldText('e-Nigma')).toBe('e-nigma')
    expect(foldText('Pokémon')).toBe('pokemon')
  })

  it('builds a folded search text with names, ids and rules', () => {
    const text = buildSearchText({
      id: 'B2a-89',
      engineId: 'B2a 089',
      nameEn: 'Iono',
      nameEs: 'e-Nigma',
      attacks: [],
      ability: { name: '', effect: 'Each player shuffles the cards in their hand into their deck.' },
    })
    expect(text).toBe(
      'iono | e-nigma | b2a-89 | b2a 089 | each player shuffles the cards in their hand into their deck.',
    )
  })
})

describe('rules text and hash', () => {
  const vineWhip = { cost: ['grass' as const, 'colorless' as const], name: 'Vine Whip', damage: '40', effect: null }
  const card = {
    cardType: 'pokemon' as const,
    evolutionType: 'basic' as const,
    energy: 'grass' as const,
    hp: 70,
    weakness: 'fire' as const,
    retreat: 1,
    ex: false,
    attacks: [vineWhip],
    ability: null,
  }

  it('is deterministic, 16 hex characters and sensitive to every field', () => {
    expect(rulesHashOf(card)).toMatch(/^[0-9a-f]{16}$/)
    expect(rulesHashOf(card)).toBe(rulesHashOf({ ...card }))
    expect(rulesHashOf({ ...card, hp: 80 })).not.toBe(rulesHashOf(card))
    expect(rulesHashOf({ ...card, attacks: [{ ...vineWhip, damage: '50' }] })).not.toBe(rulesHashOf(card))
    expect(rulesTextOf(card)).toContain('attack:Vine Whip|grass,colorless|40|')
    expect(hashText('')).toMatch(/^[0-9a-f]{16}$/)
    expect(hashText('a')).not.toBe(hashText('b'))
  })

  it('applied to the real catalog: No Cost attacks, damage noise and trainer effects are cleaned', () => {
    const { catalog, report } = builtCatalog()
    expect(report.counts.noCostAttacks).toBe(40)
    // 280 attacks had the last word of their name leaked into `damage` (the 198 "50x" damages are real).
    expect(report.counts.damageNoiseAttacks).toBe(280)
    expect(report.counts.cleanedTrainerEffects).toBe(395)
    const attacks = catalog.cards.flatMap((c) => c.attacks)
    expect(attacks.every((a) => a.damage === null || /^\d+[+x-]?$/.test(a.damage))).toBe(true)
    expect(attacks.every((a) => a.damage !== '0')).toBe(true)
    expect(attacks.every((a) => a.cost.every((e) => e !== ('No Cost' as string)))).toBe(true)
    expect(attacks.every((a) => a.effect !== 'No effect')).toBe(true)
    const trainers = catalog.cards.filter((c) => c.cardType === 'trainer')
    expect(trainers.every((c) => c.ability !== null && !c.ability.effect.includes('Illustrated by'))).toBe(true)
    expect(catalog.cards.every((c) => !c.searchText.includes('illustrated by'))).toBe(true)
    const magby = catalog.cards.find((c) => c.id === 'A4-32')
    expect(magby?.attacks[0]).toEqual({
      cost: [],
      name: 'Toasty Toss',
      damage: null,
      effect: 'Take a [R] Energy from your Energy Zone and attach it to 1 of your Benched Basic Pokémon.',
    })
  })
})
