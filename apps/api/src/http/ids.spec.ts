import { NotFoundException } from '@nestjs/common'
import { idToString, parseNumericId } from './ids.js'

describe('ids', () => {
  it('round-trips numeric ids through strings', () => {
    expect(idToString(42)).toBe('42')
    expect(parseNumericId('42')).toBe(42)
    expect(parseNumericId(7)).toBe(7)
  })

  it('treats anything that is not a positive integer as not found', () => {
    for (const raw of ['', 'abc', '-1', '1.5', ' 3', undefined, '1'.repeat(16)]) {
      expect(() => parseNumericId(raw, 'Mazo')).toThrow(NotFoundException)
    }
  })
})
