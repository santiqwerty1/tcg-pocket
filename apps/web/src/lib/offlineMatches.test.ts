import { afterEach, describe, expect, it } from 'vitest'
import { flushPending, pendingMatches, queueMatch, sentPlayedAt, setPendingRank } from './offlineMatches'

afterEach(() => {
  localStorage.clear()
})

const pending = (clientRef: string) => ({
  clientRef,
  body: { deckId: '7', result: 'win' as const, mode: 'competitive' as const },
  label: 'Victoria',
  savedAt: Date.now(),
})

describe('partidas sin señal y el rango (review of #130)', () => {
  it('a rank given while the match is still on the phone travels with it', async () => {
    expect(queueMatch(pending('a'))).toBe(true)
    expect(setPendingRank('a', 'ultra-3', null)).toBe(true)
    expect(pendingMatches()[0]?.body).toMatchObject({ rank: 'ultra-3' })
    const sent: unknown[] = []
    await flushPending(async (body) => {
      sent.push(body)
      return { playedAt: '2026-10-18T10:00:00.000Z' }
    })
    expect(sent).toEqual([expect.objectContaining({ rank: 'ultra-3' })])
  })

  it('while it is being sent the rank is not added (the send would drop it); afterwards, where it was played', async () => {
    expect(queueMatch(pending('b'))).toBe(true)
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const sent: unknown[] = []
    const flushing = flushPending(async (body) => {
      sent.push(body)
      await gate
      return { playedAt: '2026-10-18T11:00:00.000Z' }
    })
    await Promise.resolve()
    expect(setPendingRank('b', 'ultra-3', null)).toBe(false)
    const where = sentPlayedAt('b')
    release()
    await flushing
    expect(await where).toBe('2026-10-18T11:00:00.000Z')
    expect(sent).toEqual([expect.not.objectContaining({ rank: expect.anything() })])
    expect(pendingMatches()).toEqual([])
    // Gone: nothing to add the rank to.
    expect(setPendingRank('b', 'ultra-3', null)).toBe(false)
  })

  it('a match that did not go stays waiting and still takes the rank', async () => {
    expect(queueMatch(pending('c'))).toBe(true)
    await flushPending(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await sentPlayedAt('c')).toBeNull()
    expect(setPendingRank('c', 'great-1', null)).toBe(true)
  })
})
