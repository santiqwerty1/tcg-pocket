import { DEFAULT_BOT, DEFAULT_PLAYERS } from '@tcg/domain'
import { LAB_DEFAULT_PLAYERS, labBotLabel } from './lab.service.js'

describe('the Laboratorio’s bots by default (D-029)', () => {
  it('are the domain’s bot by default on both sides: g2 since 23/10/2026', () => {
    expect(DEFAULT_BOT).toBe('g2')
    expect(LAB_DEFAULT_PLAYERS).toEqual(['g2', 'g2'])
    expect(LAB_DEFAULT_PLAYERS).toEqual([...DEFAULT_PLAYERS])
    // The label the row of «¿Cuál llevo hoy?» and decks_pick_today compare scores by.
    expect(labBotLabel(LAB_DEFAULT_PLAYERS)).toBe('g2')
    expect(labBotLabel(['e2', 'e2'])).not.toBe(labBotLabel(LAB_DEFAULT_PLAYERS))
  })
})
