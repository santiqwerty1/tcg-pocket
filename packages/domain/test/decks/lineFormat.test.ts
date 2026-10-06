import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type DeckDraft,
  DeckFormatError,
  decodeLimitlessBuilderParam,
  encodeLimitlessBuilderParam,
  entryToDraft,
  type LimitlessDecklist,
  parseLineFormat,
  writeDeckgymText,
  writeLimitlessClipboardText,
} from '../../src/decks/index.js'
import { deckDraft, parsedDecks } from '../helpers/loadDecks.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const limitlessDir = join(import.meta.dirname, '..', '..', '..', '..', 'docs/fase0/limitless')

/** Deck 10 says «Cualquiera»; the exporters need an explicit energy, so the tests give it Psychic. */
function exportable(number: number): DeckDraft {
  const draft = deckDraft(number)
  return number === 10 ? { ...draft, energies: ['psychic'] } : draft
}

// docs/fase0/limitless.md §4a: "Copy to Clipboard" of player jugador-194 at PMPT #45 (CRLF, energy last).
const CLIPBOARD_SAMPLE = [
  '2 Treecko B3 5',
  '1 Grovyle B3 6',
  '2 Mega Sceptile ex B3 8',
  '1 Froakie A1 87',
  '1 Greninja A1 89',
  '1 Volbeat B4a 1',
  '1 Pheromosa A3a 7',
  '',
  "2 Professor's Research P-A 7",
  '2 Copycat B1 225',
  '1 Cyrus A2 150',
  '2 Rare Candy A3 144',
  '2 Poké Ball P-A 5',
  '1 Small Balloon B3b 64',
  '1 Fragrant Forest B3 153',
  '',
  'Energy: Grass',
].join('\r\n')
const BUILDER_PARAM =
  '3221B35121B36221B38122A187122A189131B4a1131A3a7231P0A7223B1225123A2150223A3144231P0A5132B3b64123B3153'

describe('writeDeckgymText', () => {
  it('writes Energy: first for the 40 decks, with English names and unpadded numbers', () => {
    for (const deck of parsedDecks()) {
      const text = writeDeckgymText(exportable(deck.number), index)
      expect(text.startsWith('Energy: '), `deck ${deck.number}`).toBe(true)
      expect(text.split('\n').filter((l) => l !== '')).toHaveLength(1 + deckDraft(deck.number).cards.length)
    }
    expect(writeDeckgymText(deckDraft(9), index).split('\n')[0]).toBe('Energy: Fire, Lightning')
    const deck10 = writeDeckgymText(exportable(10), index)
    expect(deck10).toContain('\n2 Type: Null A3a 60\n')
    expect(deck10).toContain('\n2 Poké Ball P-A 5\n')
    expect(writeDeckgymText(deckDraft(2), index)).toContain('\n2 Rare Candy A3 144\n')
    expect(writeDeckgymText(deckDraft(13), index)).toContain('\n1 Small Balloon B3b 64\n')
  })

  it('applies mapEdition and never infers a missing energy', () => {
    const mapped = writeDeckgymText(deckDraft(13), index, {
      mapEdition: (cardId) => (cardId === 'B3b-64' ? 'B4b-372' : cardId),
    })
    expect(mapped).toContain('\n1 Small Balloon B4b 372\n')
    expect(mapped).not.toContain('B3b 64')
    expect(() => writeDeckgymText(deckDraft(10), index)).toThrow(DeckFormatError)
    try {
      writeDeckgymText(deckDraft(10), index)
    } catch (error) {
      expect((error as DeckFormatError).code).toBe('energy_required')
    }
    expect(() => writeDeckgymText({ energies: ['fire'], cards: [{ cardId: 'Z9-1', count: 1 }] }, index)).toThrow(
      DeckFormatError,
    )
  })

  it('round-trips the 40 drafts through parseLineFormat (cards and energies)', () => {
    for (const deck of parsedDecks()) {
      const draft = exportable(deck.number)
      const back = parseLineFormat(writeDeckgymText(draft, index), index)
      expect(back.errors, `deck ${deck.number}`).toEqual([])
      expect(back.warnings, `deck ${deck.number}`).toEqual([])
      expect(back.value?.cards, `deck ${deck.number}`).toEqual(draft.cards)
      expect(back.value?.energies, `deck ${deck.number}`).toEqual(draft.energies)
    }
  })
})

describe('parseLineFormat', () => {
  it('parses the Limitless clipboard sample: 20 cards, Grass, no warnings', () => {
    const result = parseLineFormat(CLIPBOARD_SAMPLE, index)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.value?.energies).toEqual(['grass'])
    expect(result.value?.cards.reduce((s, c) => s + c.count, 0)).toBe(20)
    expect(result.value?.cards[0]).toEqual({ cardId: 'B3-5', count: 2 })
    expect(result.value?.cards[7]).toEqual({ cardId: 'P-A-7', count: 2 })
    expect(result.value?.cards[12]).toEqual({ cardId: 'B3b-64', count: 1 })
    expect(result.value?.source).toBe('line_format')
  })

  it('tolerates headers, padded numbers, lower-case sets and an Energy line anywhere', () => {
    const text = 'Pokémon: 2\n2 Treecko B3 005\nTrainer: 2\nEnergy: Grass\n2 Poké Ball p-a 5\n\nPokemon:\n'
    const result = parseLineFormat(text, index)
    expect(result.errors).toEqual([])
    expect(result.value?.cards).toEqual([
      { cardId: 'B3-5', count: 2 },
      { cardId: 'P-A-5', count: 2 },
    ])
    expect(result.value?.energies).toEqual(['grass'])
  })

  it('warns name_mismatch and energy_missing; errors on unknown ids, bad lines and Dragon', () => {
    const mismatch = parseLineFormat('2 Zorua B3 5', index)
    expect(mismatch.errors).toEqual([])
    expect(mismatch.warnings.map((w) => w.code).sort()).toEqual(['energy_missing', 'name_mismatch'])
    expect(mismatch.value?.cards).toEqual([{ cardId: 'B3-5', count: 2 }])
    expect(mismatch.value?.energies).toEqual([])

    const bad = parseLineFormat('Energy: Grass\n2 Nope Z9 1\nhola\n0 Treecko B3 5\nEnergy: Dragon\nEnergy: Foo', index)
    expect(bad.value).toBeNull()
    expect(bad.errors.map((e) => [e.code, e.line])).toEqual([
      ['unknown_card', 2],
      ['invalid_line', 3],
      ['invalid_line', 4],
      ['energy_not_selectable', 5],
      ['unknown_energy', 6],
    ])
    expect(parseLineFormat('\n\n', index).errors[0]).toMatchObject({ code: 'empty' })
  })
})

describe('writeLimitlessClipboardText', () => {
  it('reproduces the clipboard sample from its parsed draft (CRLF, blocks, energy last)', () => {
    const draft = parseLineFormat(CLIPBOARD_SAMPLE, index).value as DeckDraft
    expect(writeLimitlessClipboardText(draft, index)).toBe(CLIPBOARD_SAMPLE)
  })

  it('omits the Energy block when there is no selection and parses back in deckgym', () => {
    const draft = deckDraft(10)
    const text = writeLimitlessClipboardText(draft, index)
    expect(text).not.toContain('Energy:')
    expect(text).toContain('\r\n\r\n')
    const back = parseLineFormat(text, index)
    expect(back.errors).toEqual([])
    expect(back.value?.cards).toEqual(draft.cards)
    const deck39 = writeLimitlessClipboardText(deckDraft(39), index)
    expect(deck39.split('\r\n\r\n')).toHaveLength(3)
  })
})

describe('encodeLimitlessBuilderParam', () => {
  it('encodes the sample as the ?i= value of its "Open in Deck Builder" link', () => {
    const draft = parseLineFormat(CLIPBOARD_SAMPLE, index).value as DeckDraft
    expect(encodeLimitlessBuilderParam(draft)).toBe(BUILDER_PARAM)
    expect(decodeLimitlessBuilderParam(BUILDER_PARAM)).toEqual(draft.cards)
  })

  it('round-trips the 40 decks and rejects counts above 9', () => {
    for (const deck of parsedDecks()) {
      const draft = deckDraft(deck.number)
      expect(decodeLimitlessBuilderParam(encodeLimitlessBuilderParam(draft)), `deck ${deck.number}`).toEqual(
        draft.cards,
      )
    }
    expect(() => encodeLimitlessBuilderParam({ cards: [{ cardId: 'A1-1', count: 10 }] })).toThrow(DeckFormatError)
    expect(() => decodeLimitlessBuilderParam('4')).toThrow(DeckFormatError)
    expect(() => decodeLimitlessBuilderParam('3221B3')).toThrow(DeckFormatError)
  })
})

describe('entryToDraft (Limitless standings JSON)', () => {
  interface Standing {
    decklist: LimitlessDecklist | null
  }

  it('maps the 393 entries of PMPT #45 to 20-card drafts with 0 unmapped refs', () => {
    const standings = JSON.parse(readFileSync(join(limitlessDir, 'big_standings.json'), 'utf8')) as Standing[]
    expect(standings).toHaveLength(393)
    const byEnergyCount = new Map<number, number>()
    let unmapped = 0
    for (const standing of standings) {
      const { draft, unmapped: refs, unknownEnergies } = entryToDraft(standing.decklist as LimitlessDecklist, index)
      unmapped += refs.length
      expect(unknownEnergies).toEqual([])
      expect(draft.cards.reduce((s, c) => s + c.count, 0)).toBe(20)
      expect(draft.source).toBe('limitless_standings')
      byEnergyCount.set(draft.energies.length, (byEnergyCount.get(draft.energies.length) ?? 0) + 1)
    }
    expect(unmapped).toBe(0)
    expect(byEnergyCount.get(1)).toBe(367)
    expect(byEnergyCount.get(2)).toBe(23)
    expect(byEnergyCount.get(3)).toBe(3)
    const first = entryToDraft(standings[0]?.decklist as LimitlessDecklist, index).draft
    expect(first.energies).toEqual(['psychic'])
    expect(first.cards[0]).toEqual({ cardId: 'B1-196', count: 2 })
  })

  it('gives the 79 NOEX entries an empty energy selection and collects unknown refs', () => {
    const standings = JSON.parse(readFileSync(join(limitlessDir, 'noex_standings.json'), 'utf8')) as Standing[]
    expect(standings).toHaveLength(79)
    for (const standing of standings) {
      const { draft, unmapped } = entryToDraft(standing.decklist as LimitlessDecklist, index)
      expect(draft.energies).toEqual([])
      expect(unmapped).toEqual([])
    }
    const result = entryToDraft(
      { pokemon: [{ count: 2, set: 'Z9', number: '1', name: 'Nope' }], trainer: [], energy: ['Fire', 'Dragon'] },
      index,
    )
    expect(result.draft.cards).toEqual([])
    expect(result.unmapped).toEqual([{ count: 2, set: 'Z9', number: '1', name: 'Nope', ref: 'Z9-1' }])
    expect(result.draft.energies).toEqual(['fire'])
    expect(result.unknownEnergies).toEqual(['Dragon'])
  })
})
