// «Tracker al día» (T-020): the tracker against the game, card by card, and the file for the tracker's importer.
import { describe, expect, it } from 'vitest'
import {
  parseTrackerCsv,
  REQUIRED_CSV_COLUMNS,
  type StockQuantities,
  TRACKER_CSV_HEADER,
  trackerGap,
  writeTrackerFixCsv,
} from '../../src/collection/index.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const unit = (stockCardId: string, amountOwned: number, collected = amountOwned > 0) => ({
  stockCardId,
  amountOwned,
  collected,
})

const tracker: StockQuantities = {
  'A1-1': unit('A1-1', 2),
  'A1-2': unit('A1-2', 3),
  'A1-3': unit('A1-3', 1),
  'B1a-28': unit('B1a-28', 0, true),
  'P-A-7': unit('P-A-7', 1, true),
}
const game: StockQuantities = {
  'A1-1': unit('A1-1', 2),
  'A1-2': unit('A1-2', 1),
  'A2-1': unit('A2-1', 4),
  'B4b-372': unit('B4b-372', 2),
}

describe('trackerGap', () => {
  it('lists, in catalog order, what the file changes (counts and carddex flag), with totals each way', () => {
    const gap = trackerGap(index, tracker, game)
    expect(gap.rows.map((row) => [row.stockCardId, row.tracker, row.game, row.delta, row.collected])).toEqual([
      ['A1-2', 3, 1, -2, true],
      ['A1-3', 1, 0, -1, false],
      ['A2-1', 0, 4, 4, true],
      // Registered in the tracker with 0 copies, and 0 in the game: only the flag changes (Santi, 22/10).
      ['B1a-28', 0, 0, 0, false],
      ['B4b-372', 0, 2, 2, true],
      ['P-A-7', 1, 0, -1, false],
    ])
    expect(gap.summary).toEqual({
      cards: 6,
      cardsMissing: 2,
      copiesMissing: 6,
      cardsExtra: 3,
      copiesExtra: 4,
      cardsCollected: 1,
      trackerCopies: 7,
      gameCopies: 9,
    })
    // Twins are one unit: A1-2 carries its A4b reprint and the internal id the tracker keys it by.
    expect(gap.rows[0]).toMatchObject({ cardIds: ['A1-2', 'A4b-3'], internalId: 65665, trackerCollected: true })
  })

  it('leaves the skipped units out of the rows and the totals', () => {
    const gap = trackerGap(index, tracker, game, new Set(['A2-1', 'A1-3']))
    expect(gap.rows.map((row) => row.stockCardId)).toEqual(['A1-2', 'B1a-28', 'B4b-372', 'P-A-7'])
    expect(gap.summary).toMatchObject({ cards: 4, copiesMissing: 2, copiesExtra: 3, trackerCopies: 6, gameCopies: 5 })
  })

  it('is empty when counts and flags agree (a unit missing on one side counts as 0 and not registered)', () => {
    const gap = trackerGap(index, { ...game, 'A3-1': unit('A3-1', 0, false) }, game)
    expect(gap.rows).toEqual([])
    expect(gap.summary.cards).toBe(0)
  })

  it('a card registered in the tracker with 0 copies is a change when the game has none either', () => {
    const gap = trackerGap(index, { 'A3-1': unit('A3-1', 0, true) }, {})
    expect(gap.rows).toEqual([expect.objectContaining({ stockCardId: 'A3-1', delta: 0, trackerCollected: true })])
    expect(gap.summary).toMatchObject({ cards: 1, cardsCollected: 1, cardsMissing: 0, cardsExtra: 0 })
  })
})

describe('writeTrackerFixCsv', () => {
  it('writes only what changes, with the game count, in the format the tracker exports and imports', () => {
    const gap = trackerGap(index, tracker, game)
    const file = writeTrackerFixCsv(index, gap.rows)
    expect(file.startsWith('﻿')).toBe(true)
    expect(file.endsWith('\n')).toBe(false)
    const lines = file.slice(1).split('\n')
    expect(lines[0]).toBe(TRACKER_CSV_HEADER)
    expect(lines.slice(1)).toEqual([
      'A1-2,Ivysaur,65665,1,A1,mewtwopack,◊◊,TRUE',
      'A1-3,Venusaur,65730,0,A1,mewtwopack,◊◊◊,FALSE',
      'A2-1,Oddish,196672,4,A2,everypack,◊,TRUE',
      'B1a-28,Helioptile,853760,0,B1a,everypack,◊,FALSE',
      'B4b-372,Globito,1465601,2,B4b,everypack,◊◊,TRUE',
      'P-A-7,Investigación de Profesores,12583376,0,P-A,everypack,P,FALSE',
    ])
    // What ImportReader requires, and what our own CSV importer reads back.
    const parsed = parseTrackerCsv(file)
    expect(parsed.errors).toEqual([])
    for (const column of REQUIRED_CSV_COLUMNS) expect(parsed.columns).toContain(column)
    expect(parsed.rows.map((row) => [row.internalId, row.numberOwned])).toEqual(
      gap.rows.map((row) => [row.internalId, row.game]),
    )
  })

  it('Collected is FALSE with 0 copies in the game even when the tracker had it registered, TRUE with a copy (Santi, 22/10)', () => {
    const file = writeTrackerFixCsv(
      index,
      trackerGap(
        index,
        {
          'A1-1': unit('A1-1', 2, false),
          'A1-3': unit('A1-3', 1, true),
          'A2-1': unit('A2-1', 2, true),
          'B1a-28': unit('B1a-28', 0, true),
        },
        { 'A1-1': unit('A1-1', 2) },
      ).rows,
    )
    expect(file.slice(1).split('\n').slice(1)).toEqual([
      'A1-1,Bulbasaur,65600,2,A1,mewtwopack,◊,TRUE',
      'A1-3,Venusaur,65730,0,A1,mewtwopack,◊◊◊,FALSE',
      'A2-1,Oddish,196672,0,A2,everypack,◊,FALSE',
      'B1a-28,Helioptile,853760,0,B1a,everypack,◊,FALSE',
    ])
  })

  it('with nothing to fix it is just the header', () => {
    expect(writeTrackerFixCsv(index, [])).toBe(`﻿${TRACKER_CSV_HEADER}`)
  })
})
