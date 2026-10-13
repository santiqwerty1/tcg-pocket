import { describe, expect, it } from 'vitest'
import { missing, plural } from './format'

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
