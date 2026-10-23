import { unknownTrackerFieldWarning } from '@tcg/domain'
import { describe, expect, it } from 'vitest'
import { withoutUnknownFieldWarnings } from './catalog-sync.service.js'

describe('the preview’s warnings without the unknown fields, which travel apart', () => {
  it('drops exactly the warnings of the unknown fields and keeps every other one, in order', () => {
    const unknown = [
      { field: 'energy2', cards: 3 },
      { field: 'foo', cards: 1 },
    ]
    const warnings = [
      'Expansion C1 has no cards in cards.json',
      unknownTrackerFieldWarning({ field: 'energy2', cards: 3 }),
      // The same field with another count is another text: it stays.
      unknownTrackerFieldWarning({ field: 'energy2', cards: 2 }),
      unknownTrackerFieldWarning({ field: 'foo', cards: 1 }),
      "Expansion C1: cards reference undeclared pack 'x'",
    ]
    expect(withoutUnknownFieldWarnings(warnings, unknown)).toEqual([
      'Expansion C1 has no cards in cards.json',
      unknownTrackerFieldWarning({ field: 'energy2', cards: 2 }),
      "Expansion C1: cards reference undeclared pack 'x'",
    ])
    expect(withoutUnknownFieldWarnings(warnings, [])).toEqual(warnings)
  })
})
