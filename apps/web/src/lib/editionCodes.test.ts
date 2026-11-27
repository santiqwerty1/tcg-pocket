import { describe, expect, it } from 'vitest'
import { looksLikeEditionCode, parseEditionCodes } from './editionCodes'

const EXPANSIONS = ['A1', 'A2b', 'A4b', 'P-A', 'P-C', 'C1']

describe('parseEditionCodes', () => {
  it('splits by commas, semicolons, spaces and lines, without repeats, in the order typed', () => {
    expect(parseEditionCodes('P-A-1, P-A-2;P-A-3\nA2b-111  A4b-373,P-A-1', EXPANSIONS)).toEqual([
      'P-A-1',
      'P-A-2',
      'P-A-3',
      'A2b-111',
      'A4b-373',
    ])
    expect(parseEditionCodes('  , ;\n', EXPANSIONS)).toEqual([])
  })

  it('writes each code as the catalog does: the expansion case and the number without leading zeros', () => {
    expect(parseEditionCodes('p-a-008 a2b-111 P-C-002 c1-1', EXPANSIONS)).toEqual(['P-A-8', 'A2b-111', 'P-C-2', 'C1-1'])
    // Two spellings of one edition are one.
    expect(parseEditionCodes('P-A-1 p-a-001', EXPANSIONS)).toEqual(['P-A-1'])
  })

  it('drops the brackets and the final period of a code copied from a sentence', () => {
    expect(parseEditionCodes('Poción (P-A-1), Poké Ball (A2b-111).', EXPANSIONS)).toEqual([
      'Poción',
      'P-A-1',
      'Poké',
      'Ball',
      'A2b-111',
    ])
  })

  it('keeps as typed what is not a code of a known expansion', () => {
    expect(parseEditionCodes('ZZ-1 hola P-A', EXPANSIONS)).toEqual(['ZZ-1', 'hola', 'P-A'])
    // Without the expansions (not loaded yet), everything as typed.
    expect(parseEditionCodes('p-a-001', [])).toEqual(['p-a-001'])
  })
})

describe('looksLikeEditionCode', () => {
  it('the shape the API takes', () => {
    expect(looksLikeEditionCode('P-A-1')).toBe(true)
    expect(looksLikeEditionCode('A2b-111')).toBe(true)
    expect(looksLikeEditionCode('Poké')).toBe(false)
    expect(looksLikeEditionCode('A'.repeat(21))).toBe(false)
  })
})
