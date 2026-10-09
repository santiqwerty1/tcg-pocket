import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LiteralParseError, parseJsLiteral } from '../../src/catalog/literal.js'
import { parseCraftingCostFromCardsDb, parseExpansionsFromCardsDb } from '../../src/catalog/parseCardsDb.js'

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'tracker')

describe('data literals, parsed and never evaluated (Fase 40, security)', () => {
  it('reads what CardsDB.ts uses: bare and quoted keys, strings, numbers, booleans, comments, trailing commas', () => {
    expect(
      parseJsLiteral(`[
        // a comment
        { name: 'geneticapex', id: "A1", internalId: 1, /* block */ ok: true, no: false, none: null, n: -2.5e1,
          packs: [{ name: 'mewtwopack', color: '#c078bc' },], 'Crown Rare': 2500, 7: 'x', esc: 'it\\'s\\n' },
      ]`),
    ).toEqual([
      {
        name: 'geneticapex',
        id: 'A1',
        internalId: 1,
        ok: true,
        no: false,
        none: null,
        n: -25,
        packs: [{ name: 'mewtwopack', color: '#c078bc' }],
        'Crown Rare': 2500,
        7: 'x',
        esc: "it's\n",
      },
    ])
  })

  it('the real CardsDB.ts of the pinned commit gives the same expansions and costs as before', () => {
    const source = readFileSync(join(FIXTURES, 'CardsDB.ts'), 'utf8')
    const expansions = parseExpansionsFromCardsDb(source)
    expect(expansions.length).toBeGreaterThan(20)
    expect(expansions[0]).toMatchObject({ id: 'A1', internalId: 1, name: 'geneticapex' })
    expect(parseCraftingCostFromCardsDb(source)).toMatchObject({ '◊': 35, '◊◊◊◊': 500, 'Crown Rare': 2500 })
  })

  it('refuses code: calls, identifiers, operators, template literals, spreads, prototype keys', () => {
    for (const code of [
      '(() => { throw new Error("ran") })()',
      '{ a: require("node:fs") }',
      '{ a: process.exit(1) }',
      '{ a: 1 + 2 }',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a template literal as input, on purpose
      '{ a: `x${1}` }',
      '{ ...other }',
      '[globalThis]',
      '{ __proto__: { polluted: true } }',
      '{ "constructor": 1 }',
      '{ a: 1 } ; process.exit(1)',
      '{ a: 1',
      "{ a: 'unterminated }",
    ]) {
      expect(() => parseJsLiteral(code), code).toThrow(LiteralParseError)
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('a CardsDB.ts with code in the literal is refused before anything runs', () => {
    const source = "export const expansions = [\n  { name: 'x', id: 'A1', internalId: (() => 1)() },\n]\n"
    expect(() => parseExpansionsFromCardsDb(source)).toThrow(/not a plain data literal/)
  })
})
