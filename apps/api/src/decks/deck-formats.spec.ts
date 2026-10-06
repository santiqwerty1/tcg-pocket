import { detectDeckFormat } from './deck-formats.js'

const SPANISH = `### 6. Mega-Lucario ex / Lucario
- Pokémon: 1 Riolu (A2-91), 1 Riolu (B3-79)
- Entrenadores: 2 Copiona
- Energía: Lucha`

const LINE = `2 Riolu A2 91
2 Lucario A2 92

Energy: Fighting`

describe('detectDeckFormat', () => {
  it('returns an explicit format untouched', () => {
    expect(detectDeckFormat(LINE, 'json')).toBe('json')
    expect(detectDeckFormat(SPANISH, 'limitless')).toBe('limitless')
    expect(detectDeckFormat(SPANISH, 'spanish-file')).toBe('spanish-file')
  })

  it('detects JSON by its leading brace', () => {
    expect(detectDeckFormat('  {"schemaVersion":1,"name":"x","energies":[],"cards":[]}')).toBe('json')
  })

  it('detects the Spanish list by its heading or its bullets', () => {
    expect(detectDeckFormat(SPANISH)).toBe('spanish')
    expect(detectDeckFormat('- Pokémon: 2 Riolu (A2-91)\n- Entrenadores: 2 Copiona')).toBe('spanish')
    expect(detectDeckFormat('Pokemon: 2 Riolu (A2-91)\nEntrenadores: 2 Copiona')).toBe('spanish')
  })

  it('detects the whole file by its summary table or by several numbered headings', () => {
    expect(
      detectDeckFormat(`## Resumen\n\n| # | Mazo | Energía |\n|---:|---|---|\n| 1 | A | Fuego |\n\n${SPANISH}`),
    ).toBe('spanish-file')
    expect(detectDeckFormat(`${SPANISH}\n\n### 7. Otro\n- Pokémon: 2 Riolu (A2-91)`)).toBe('spanish-file')
  })

  it('falls back to the Limitless/deckgym line format', () => {
    expect(detectDeckFormat(LINE)).toBe('limitless')
    expect(detectDeckFormat('Energy: Fire\n2 Charmander A1 33')).toBe('limitless')
    expect(detectDeckFormat('')).toBe('limitless')
  })
})
