import { describe, expect, it } from 'vitest'
import { STALE_TOURNAMENT_DAYS, staleTournaments } from './tournaments'

describe('staleTournaments (phone review)', () => {
  const day = 86_400_000
  const now = Date.parse('2026-10-13T15:00:00Z')

  it('says nothing for a week-old tournament or a fresher one, or without one', () => {
    expect(staleTournaments(new Date(now - STALE_TOURNAMENT_DAYS * day).toISOString(), now)).toBeNull()
    expect(staleTournaments(new Date(now - day).toISOString(), now)).toBeNull()
    expect(staleTournaments(null, now)).toBeNull()
  })

  it('past a week, the date and how long ago', () => {
    expect(staleTournaments('2026-09-05T16:00:00.000Z', now)).toBe(
      'El último torneo cargado es del 5/9/2026, hace 37 días: los números son de esos días.',
    )
  })
})
