import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const fixtures = join(import.meta.dirname, 'fixtures')

describe('fixtures', () => {
  it('cards.json has the 4,317 cards of tracker @ 3ab58f1', () => {
    const cards = JSON.parse(readFileSync(join(fixtures, 'tracker/cards.json'), 'utf8')) as { card_id: string }[]
    expect(cards).toHaveLength(4317)
    expect(cards[0]?.card_id).toBe('A1-1')
  })

  it('engine-cards.json has the 4,317 cards of deckgym @ fb792ebf', () => {
    const cards = JSON.parse(readFileSync(join(fixtures, 'deckgym/engine-cards.json'), 'utf8')) as { id: string }[]
    expect(cards).toHaveLength(4317)
    expect(cards[0]?.id).toBe('A1 001')
  })
})
