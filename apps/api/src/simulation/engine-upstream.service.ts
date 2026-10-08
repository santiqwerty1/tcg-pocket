/**
 * Is there a newer deckgym-core? (T-010, D-013) The engine is pinned on purpose (reproducible, comparable results);
 * this only tells the owner how far the upstream `main` moved since the pinned commit, through GitHub's public compare
 * API. At most one call every 12 hours (an hour after a failure), production only by default
 * (`ENGINE_UPSTREAM_CHECK`).
 */
import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { ENV, type Env } from '../config/env.js'

export interface EngineUpstreamView {
  checkedAt: string
  /** The pinned commit the comparison starts from. */
  pinned: string
  /** Commits on upstream `main` after the pinned one. */
  aheadBy: number
  latest: { sha: string; date: string | null; message: string } | null
  compareUrl: string
}

const FRESH_MS = 12 * 60 * 60 * 1000
const RETRY_MS = 60 * 60 * 1000

/** GitHub's `GET /repos/:owner/:repo/compare/:base...:head` → what the app shows. */
export function parseCompare(json: unknown, pinned: string, checkedAt: Date): EngineUpstreamView | null {
  if (typeof json !== 'object' || json === null) return null
  const body = json as {
    ahead_by?: unknown
    html_url?: unknown
    commits?: { sha?: unknown; commit?: { message?: unknown; author?: { date?: unknown } } }[]
  }
  if (typeof body.ahead_by !== 'number' || typeof body.html_url !== 'string') return null
  const last = Array.isArray(body.commits) ? body.commits.at(-1) : undefined
  return {
    checkedAt: checkedAt.toISOString(),
    pinned,
    aheadBy: body.ahead_by,
    latest:
      last && typeof last.sha === 'string'
        ? {
            sha: last.sha,
            date: typeof last.commit?.author?.date === 'string' ? last.commit.author.date : null,
            message:
              String(last.commit?.message ?? '')
                .split('\n')[0]
                ?.slice(0, 160) ?? '',
          }
        : null,
    compareUrl: body.html_url,
  }
}

@Injectable()
export class EngineUpstreamService {
  private cache: { at: number; ttl: number; value: EngineUpstreamView | null } | null = null
  /** Tests swap it. */
  fetchImpl: typeof fetch = fetch

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EngineUpstreamService.name)
  }

  async status(pinned: string, now = Date.now()): Promise<EngineUpstreamView | null> {
    if (!this.env.engineUpstreamCheck) return null
    if (this.cache && now - this.cache.at < this.cache.ttl) return this.cache.value
    let value: EngineUpstreamView | null = null
    try {
      const response = await this.fetchImpl(`${this.env.engineUpstreamUrl}/compare/${pinned}...main`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'tcg-pocket' },
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new Error(`GitHub ${response.status}`)
      value = parseCompare(await response.json(), pinned, new Date(now))
    } catch (error) {
      this.logger.warn({ err: error }, 'deckgym upstream check failed')
    }
    this.cache = { at: now, ttl: value ? FRESH_MS : RETRY_MS, value }
    return value
  }
}
