import { describe, expect, it } from 'vitest'
import { cardLine } from './mcp-card-line.js'

describe('cardLine (review of #113)', () => {
  it('a name that already carries its code does not get it twice, lowercase codes too', () => {
    expect(cardLine({ cardId: 'B1a-38', nameEs: 'Onix (B1a-38)', count: 2 })).toBe('2 Onix (B1a-38)')
    expect(cardLine({ cardId: 'A1-150', nameEs: 'Onix (A1-150)', count: 1 })).toBe('1 Onix (A1-150)')
    expect(cardLine({ cardId: 'A2b-10', nameEs: 'Pikachu ex (A2b-10)', count: 2 })).toBe('2 Pikachu ex (A2b-10)')
  })

  it('a name without its code gets it', () => {
    expect(cardLine({ cardId: 'B2-75', nameEs: 'Polteageist', count: 1 })).toBe('1 Polteageist (B2-75)')
    expect(cardLine({ cardId: 'B4a-12', nameEs: 'Mega-Steelix ex', count: 2 })).toBe('2 Mega-Steelix ex (B4a-12)')
  })
})
