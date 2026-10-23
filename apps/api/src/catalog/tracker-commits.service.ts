/**
 * Día de expansión (Fase 40, H-004): what the tracker's `main` is now, and where a commit stands against the one
 * loaded. GitHub's API, with GITHUB_TOKEN when set (5.000 calls an hour instead of 60 per shared IP).
 */
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ENV, type Env } from '../config/env.js'

export interface TrackerCommit {
  sha: string
  date: string | null
  message: string
}

/** `ahead`: the target is newer than the base; `behind`: older (going back); `diverged`: on another line. */
export interface TrackerComparison {
  status: 'ahead' | 'behind' | 'identical' | 'diverged'
  aheadBy: number
  behindBy: number
}

@Injectable()
export class TrackerCommitsService {
  /** Tests swap it. */
  fetchImpl: typeof fetch = fetch

  constructor(@Inject(ENV) private readonly env: Env) {}

  private async get(path: string): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.env.trackerApiUrl}${path}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'tcg-pocket',
          ...(this.env.githubToken ? { Authorization: `Bearer ${this.env.githubToken}` } : {}),
        },
        signal: AbortSignal.timeout(10_000),
      })
    } catch (error) {
      throw new ServiceUnavailableException({
        code: 'unavailable',
        message: `No se pudo consultar GitHub: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
    if (!response.ok) {
      throw new ServiceUnavailableException({
        code: 'unavailable',
        message: `GitHub respondió ${response.status} al consultar el tracker.`,
      })
    }
    return response.json()
  }

  /** The newest commit of the tracker's `main`. */
  async latest(): Promise<TrackerCommit> {
    const body = (await this.get('/commits/main')) as {
      sha?: unknown
      commit?: { message?: unknown; committer?: { date?: unknown } }
    }
    if (typeof body.sha !== 'string' || !/^[0-9a-f]{40}$/.test(body.sha)) {
      throw new ServiceUnavailableException({ code: 'unavailable', message: 'GitHub devolvió un commit sin sha.' })
    }
    return {
      sha: body.sha,
      date: typeof body.commit?.committer?.date === 'string' ? body.commit.committer.date : null,
      message:
        String(body.commit?.message ?? '')
          .split('\n')[0]
          ?.slice(0, 160) ?? '',
    }
  }

  /**
   * The files `target` changed since `base` (`base...target`). GitHub lists at most 300: `complete` is false when the
   * list may be cut, so a caller looking for one file cannot rule it out.
   */
  async changedFiles(
    base: string,
    target: string,
  ): Promise<{ status: TrackerComparison['status']; files: string[]; complete: boolean }> {
    const body = (await this.get(`/compare/${base}...${target}`)) as { status?: unknown; files?: unknown }
    const status = body.status
    if (status !== 'ahead' && status !== 'behind' && status !== 'identical' && status !== 'diverged') {
      throw new ServiceUnavailableException({ code: 'unavailable', message: 'GitHub devolvió una comparación rara.' })
    }
    const files = Array.isArray(body.files)
      ? body.files
          .map((file) => (file as { filename?: unknown }).filename)
          .filter((name): name is string => typeof name === 'string')
      : []
    return { status, files, complete: Array.isArray(body.files) && body.files.length < 300 }
  }

  /** Where `target` stands against `base` (`base...target`). */
  async compare(base: string, target: string): Promise<TrackerComparison> {
    const body = (await this.get(`/compare/${base}...${target}`)) as {
      status?: unknown
      ahead_by?: unknown
      behind_by?: unknown
    }
    const status = body.status
    if (status !== 'ahead' && status !== 'behind' && status !== 'identical' && status !== 'diverged') {
      throw new ServiceUnavailableException({ code: 'unavailable', message: 'GitHub devolvió una comparación rara.' })
    }
    return {
      status,
      aheadBy: typeof body.ahead_by === 'number' ? body.ahead_by : 0,
      behindBy: typeof body.behind_by === 'number' ? body.behind_by : 0,
    }
  }
}
