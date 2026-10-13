import { describe, expect, it } from 'vitest'
import { formatPercent, missing, PERCENT, plural } from './format'
import { formatInterval, formatRateValue, formatRecord } from './matches'
import { formatShare } from './tournaments'

describe('missing (phone review: «faltan 1»)', () => {
  it('agrees with the count, with and without a noun', () => {
    expect(missing(1)).toBe('falta 1')
    expect(missing(3)).toBe('faltan 3')
    expect(missing(0)).toBe('faltan 0')
    expect(missing(1, ['copia', 'copias'])).toBe('falta 1 copia')
    expect(missing(2, ['copia', 'copias'])).toBe('faltan 2 copias')
    expect(plural(1, 'carta', 'cartas')).toBe('1 carta')
  })
})

describe('numbers on a phone (phone review)', () => {
  it('the space before «%» never breaks («48⏎%»)', () => {
    expect(PERCENT).toBe('\u00a0%')
    for (const text of [formatPercent(48.5), formatRateValue(48), formatInterval([45.6, 50.4]), formatShare(8.4)]) {
      expect(text).toMatch(/\d\u00a0%$/)
      expect(text).not.toMatch(/ %/)
    }
  })

  it('one formatter for every count: «1.051 V · 1.119 D · 20 E» next to «n = 2.190»', () => {
    expect(formatRecord({ wins: 1051, losses: 1119, ties: 20 })).toBe('1.051 V · 1.119 D · 20 E')
    expect(formatRecord({ wins: 7, losses: 3, ties: 0 })).toBe('7 V · 3 D')
  })
})
