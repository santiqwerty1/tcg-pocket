import type { PinoLogger } from 'nestjs-pino'
import { describe, expect, it, vi } from 'vitest'
import type { Env } from '../config/env.js'
import { EngineUpstreamService, parseCompare } from './engine-upstream.service.js'

const PINNED = 'fb792ebfbaca995af9750c28101ce92a51282825'
// The shape of GitHub's compare answer on 8/10/2026 (trimmed).
const compare = {
  status: 'ahead',
  ahead_by: 18,
  behind_by: 0,
  html_url: `https://github.com/bcollazo/deckgym-core/compare/${PINNED}...main`,
  commits: [
    { sha: 'a'.repeat(40), commit: { message: 'Older change', author: { date: '2026-10-05T10:00:00Z' } } },
    {
      sha: 'b'.repeat(40),
      commit: {
        message: 'Merge pull request #394 from bcollazo/turn-action-limit\n\nLimit actions per turn',
        author: { date: '2026-10-08T11:29:13Z' },
      },
    },
  ],
}

function service(check: boolean) {
  const logger = { setContext: vi.fn(), warn: vi.fn() } as unknown as PinoLogger
  const env = { engineUpstreamCheck: check, engineUpstreamUrl: 'https://api.github.test/repos/x/y' } as Env
  return new EngineUpstreamService(env, logger)
}

describe('deckgym upstream check (T-010)', () => {
  it('reads how many commits main is ahead and the latest one', () => {
    expect(parseCompare(compare, PINNED, new Date('2026-10-08T12:00:00Z'))).toEqual({
      checkedAt: '2026-10-08T12:00:00.000Z',
      pinned: PINNED,
      aheadBy: 18,
      latest: {
        sha: 'b'.repeat(40),
        date: '2026-10-08T11:29:13Z',
        message: 'Merge pull request #394 from bcollazo/turn-action-limit',
      },
      compareUrl: compare.html_url,
    })
    expect(parseCompare({ message: 'Not Found' }, PINNED, new Date())).toBeNull()
  })

  it('asks GitHub at most every 12 hours, an hour after a failure, and never when it is off', async () => {
    const upstream = service(true)
    const fetchImpl = vi.fn(async () => Response.json(compare))
    upstream.fetchImpl = fetchImpl as unknown as typeof fetch
    const t0 = Date.parse('2026-10-08T12:00:00Z')
    expect((await upstream.status(PINNED, t0))?.aheadBy).toBe(18)
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.github.test/repos/x/y/compare/${PINNED}...main`,
      expect.objectContaining({ headers: expect.objectContaining({ 'User-Agent': 'tcg-pocket' }) }),
    )
    await upstream.status(PINNED, t0 + 11 * 3600_000)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    fetchImpl.mockImplementationOnce(async () => new Response('rate limited', { status: 403 }))
    expect(await upstream.status(PINNED, t0 + 13 * 3600_000)).toBeNull()
    expect(await upstream.status(PINNED, t0 + 13.5 * 3600_000)).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect((await upstream.status(PINNED, t0 + 14.1 * 3600_000))?.aheadBy).toBe(18)

    const off = service(false)
    const never = vi.fn()
    off.fetchImpl = never as unknown as typeof fetch
    expect(await off.status(PINNED)).toBeNull()
    expect(never).not.toHaveBeenCalled()
  })
})
