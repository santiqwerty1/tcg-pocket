import { describe, expect, it } from 'vitest'
import {
  buildDataset,
  DEFAULT_SET_RELEASES,
  parseStandings,
  RECENT_LISTS_TOP,
  recentLists,
} from '../../src/tournaments/index.js'
import { BIG_ID, readLimitless } from '../helpers/limitless.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
// PMPT #45 (393 lists, 5/9/2026).
const dataset = buildDataset({
  tournaments: [
    { id: BIG_ID, name: 'PMPT #45', date: new Date('2026-09-05T16:00:00Z'), format: 'STANDARD', players: 393 },
  ],
  entries: parseStandings(readLimitless('big_standings.json')).map((entry) => ({ ...entry, tournamentId: BIG_ID })),
  index,
  sets: DEFAULT_SET_RELEASES,
  era: 'B4a',
  format: 'STANDARD',
  minPlayers: 12,
})

describe('recent tournament lists to play against (Fase 23)', () => {
  it('the top 8 of the tournament, best placing first, with who played it and how', () => {
    const { from, to, lists } = recentLists(dataset)
    expect(to?.toISOString().slice(0, 10)).toBe('2026-09-05')
    expect(from?.toISOString().slice(0, 10)).toBe('2026-08-30')
    const top = dataset.entries.filter((entry) => entry.placing !== null && entry.placing <= RECENT_LISTS_TOP)
    expect(lists.reduce((sum, list) => sum + list.pilots, 0)).toBe(
      top.filter((entry) => entry.keyByGroup !== null).length,
    )
    expect(lists.map((list) => list.placing)).toEqual([...lists.map((list) => list.placing)].sort((a, b) => a - b))
    const first = lists[0]
    expect(first).toMatchObject({ placing: 1, tournamentName: 'PMPT #45', players: 393 })
    expect(first?.listKey).toMatch(/^[0-9a-f]{14}$/)
    expect(first?.archetypeName).toBeTruthy()
    expect(first?.record.wins).toBeGreaterThan(0)
    // Every row is the exact list of the player it names.
    const winner = dataset.entries.find((entry) => entry.placing === 1)
    expect(first?.listKey).toBe(winner?.keyByGroup)
    expect(first?.playerName).toBe(winner?.playerName)
  })

  it('a narrower window and fewer placings; an empty era', () => {
    expect(recentLists(dataset, { top: 1 }).lists).toHaveLength(1)
    expect(recentLists(dataset, { limit: 3 }).lists).toHaveLength(3)
    expect(recentLists({ ...dataset, entries: [] })).toEqual({ from: null, to: null, lists: [] })
  })
})
