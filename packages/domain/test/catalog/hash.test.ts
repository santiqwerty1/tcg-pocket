import { describe, expect, it } from 'vitest'
import { fnv1a32, hashText } from '../../src/catalog/hash.js'

/** The hash as it was before Codex on #143: the reversed text built as a string (the reference it must still give). */
function hashTextBuildingTheReverse(text: string): string {
  const forward = fnv1a32(text)
  let reversed = ''
  for (let i = text.length - 1; i >= 0; i--) reversed += text[i]
  const backward = fnv1a32(reversed, 0x9747b28c)
  return forward.toString(16).padStart(8, '0') + backward.toString(16).padStart(8, '0')
}

describe('hashText', () => {
  it('gives the same as before, so the rules hashes and the sheet keys already stored keep matching', () => {
    for (const text of [
      '',
      'a',
      'Hoopa ex / Mega-Absol ex',
      'v1|2026-10-19 21:40|M08|win|first|hoopa ex',
      '🃏 Pikachu ex ⚡',
    ]) {
      expect(hashText(text)).toBe(hashTextBuildingTheReverse(text))
    }
    expect(hashText('')).toBe('811c9dc59747b28c')
  })

  it('Codex on #143: hashes a 4 MB text without building its reverse (little memory, little time)', () => {
    const big = 'Una nota larga, con comas: el rival abrió con Dedenne ex. '.repeat(70_000).slice(0, 4_000_000)
    expect(big).toHaveLength(4_000_000)
    const before = process.memoryUsage().heapUsed
    const began = performance.now()
    const hash = hashText(big)
    const ms = performance.now() - began
    const grew = process.memoryUsage().heapUsed - before
    expect(hash).toMatch(/^[0-9a-f]{16}$/u)
    // Building the reverse took some 140 MB of strings; walking the text backwards takes none.
    expect(grew).toBeLessThan(32 * 1024 * 1024)
    expect(ms).toBeLessThan(2000)
  })
})
