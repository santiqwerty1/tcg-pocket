/**
 * Ranked by season and rank (pedido de Santi del 14/10): the game's seasons, the owner's rank noted when it changes,
 * and each season's summary (record, rank curve, record by rank and by deck). Only competitive matches count, by the
 * day they were played in the owner's time zone.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  formatWinRateEs,
  type GameRecord,
  isRank,
  matchWinRate,
  RANKS,
  type Rank,
  type RankChange,
  type RankedMatch,
  type RankedSeason,
  rankAt,
  rankLabelEs,
  seasonOf,
  seasonOfChange,
  seasonSummary,
} from '@tcg/domain'
import { dateOnly, OWNER_TIME_ZONE, todayInOwnerZone } from '../config/time-zone.js'
import type { Prisma } from '../generated/prisma/client.js'
import { idToString, parseNumericId } from '../http/ids.js'
import { isLockTimeout, isTransactionTimeout } from '../prisma/lock-errors.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { MatchRankedView, RankChangeView, RankedView, RateRowView, SeasonSummaryView } from './ranked-views.js'

/** `pg_advisory_xact_lock` key that serializes noting a rank at a moment (any constant no other lock uses). */
export const RANK_NOTE_LOCK = 43_120

/**
 * How long a write waits for the ranks' lock: longer than the longest holder in the app (a sheet import, up to a
 * minute), and past it `503 ranks_busy`. Review of #143: the transactions waited inside Prisma's 5 s and gave a 500.
 * Tests lower it.
 */
export const RANK_LOCK = { waitMs: 75_000 }

/** Room for the work itself once the lock is taken (a sheet import writes up to 500 matches). */
const RANK_LOCKED_WORK_MS = 60_000

/**
 * `work` in a transaction that takes the ranks' lock first (every write of matches' instants, ranks and seasons): it
 * waits for it at most `RANK_LOCK.waitMs`; a wait or a transaction past its time is `503 ranks_busy`, never a 500.
 */
export async function withRankLock<T>(
  prisma: PrismaService,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${RANK_LOCK.waitMs}ms`}, true)`
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RANK_NOTE_LOCK}::bigint)`
        return work(tx)
      },
      { timeout: RANK_LOCK.waitMs + RANK_LOCKED_WORK_MS, maxWait: 15_000 },
    )
  } catch (error) {
    if (isLockTimeout(error) || isTransactionTimeout(error)) {
      throw new ServiceUnavailableException({
        code: 'ranks_busy',
        message:
          'Hay otra escritura de partidas o rangos en curso (por ejemplo, una importación): probá de nuevo en un momento.',
      })
    }
    throw error
  }
}

/** A rank noted more than this ahead of the server's clock is refused (a phone with a wrong clock). */
const FUTURE_SLACK_MS = 10 * 60 * 1000

function rateRow(record: GameRecord): RateRowView {
  const rate = matchWinRate(record)
  return { record, games: record.wins + record.losses + record.ties, rate, text: formatWinRateEs(rate) }
}

function changeView(change: RankChange): RankChangeView {
  return {
    id: change.id,
    at: change.at.toISOString(),
    rank: change.rank,
    points: change.points,
    label: rankLabelEs(change.rank, change.points),
  }
}

@Injectable()
export class RankedService {
  constructor(private readonly prisma: PrismaService) {}

  /** `db`: a transaction's client, to read them under its locks (the sheet import, T-022). */
  async seasons(db: Prisma.TransactionClient = this.prisma): Promise<RankedSeason[]> {
    const rows = await db.rankedSeason.findMany({ orderBy: { startsOn: 'asc' } })
    return rows.map((row) => ({
      code: row.code,
      name: row.name,
      startsOn: dateOnly(row.startsOn) as string,
      endsOn: dateOnly(row.endsOn) as string,
    }))
  }

  async changes(db: Prisma.TransactionClient = this.prisma): Promise<RankChange[]> {
    const rows = await db.rankChange.findMany({ orderBy: [{ at: 'asc' }, { id: 'asc' }] })
    return rows.flatMap((row) =>
      isRank(row.rank) ? [{ id: idToString(row.id), at: row.at, rank: row.rank, points: row.points }] : [],
    )
  }

  /** The season and the rank at an instant (a competitive match's), or nulls. */
  async at(date: Date): Promise<{ season: RankedSeason | null; rank: RankChange | null }> {
    const [seasons, changes] = await Promise.all([this.seasons(), this.changes()])
    const season = seasonOf(date, seasons, OWNER_TIME_ZONE)
    return { season, rank: season ? rankAt(date, changes, season, OWNER_TIME_ZONE) : null }
  }

  /** 18/10: the season and the rank a registered match was played at, and the next rank noted after it. */
  async ofMatch(rawId: string): Promise<MatchRankedView> {
    const id = parseNumericId(rawId, 'Partida')
    const match = await this.prisma.match.findUnique({ where: { id }, select: { playedAt: true, mode: true } })
    if (!match) throw new NotFoundException(`Partida ${rawId} no encontrada.`)
    const competitive = match.mode === 'competitive'
    if (!competitive) return { matchId: idToString(id), competitive, season: null, rank: null, next: null }
    const [seasons, changes] = await Promise.all([this.seasons(), this.changes()])
    const season = seasonOf(match.playedAt, seasons, OWNER_TIME_ZONE)
    const rank = season ? rankAt(match.playedAt, changes, season, OWNER_TIME_ZONE) : null
    // The changes come oldest first (same instant: by id), so the first after the match in its season is the next.
    const next = season
      ? (changes.find(
          (change) =>
            change.at.getTime() >= match.playedAt.getTime() &&
            seasonOfChange(change.at, [season], OWNER_TIME_ZONE) !== null,
        ) ?? null)
      : null
    return {
      matchId: idToString(id),
      competitive,
      season: season ? { code: season.code, name: season.name } : null,
      rank: rank ? changeView(rank) : null,
      next: next ? changeView(next) : null,
    }
  }

  /**
   * 18/10 (Santi: «las partidas ya registradas»): the instant to note a rank at so that a registered match was played at
   * it — just before the match, in its season; a casual match or one outside every season is refused.
   */
  async beforeMatch(rawId: string): Promise<Date> {
    const id = parseNumericId(rawId, 'Partida')
    const match = await this.prisma.match.findUnique({ where: { id }, select: { playedAt: true, mode: true } })
    if (!match) throw new NotFoundException(`Partida ${rawId} no encontrada.`)
    if (match.mode !== 'competitive') {
      throw new BadRequestException({ code: 'validation', message: 'El rango va solo con una partida competitiva.' })
    }
    const season = seasonOf(match.playedAt, await this.seasons(), OWNER_TIME_ZONE)
    const at = new Date(match.playedAt.getTime() - 1)
    if (!season || seasonOfChange(at, [season], OWNER_TIME_ZONE) === null) {
      throw new BadRequestException({
        code: 'validation',
        message: 'La partida no cae en ninguna temporada de ranked: cargá la temporada en Partidas → Temporada.',
      })
    }
    return at
  }

  /**
   * Every season with its record and last rank, and the summary of one: the one asked for, else the current one, else
   * the last one that ended.
   */
  async view(code?: string, now = new Date()): Promise<RankedView> {
    const [seasons, changes, rows] = await Promise.all([
      this.seasons(),
      this.changes(),
      this.prisma.match.findMany({
        where: { mode: 'competitive' },
        select: { id: true, deckId: true, result: true, mode: true, playedAt: true, deck: { select: { name: true } } },
      }),
    ])
    const matches: RankedMatch[] = rows.map((row) => ({
      id: idToString(row.id),
      deckId: idToString(row.deckId),
      deckName: row.deck.name,
      result: row.result,
      mode: row.mode,
      playedAt: row.playedAt,
    }))
    const today = todayInOwnerZone(now)
    const current = seasonOf(now, seasons, OWNER_TIME_ZONE)
    // Self-review: «?season=b4bsp» finds B4bSP.
    const shown = code
      ? seasons.find((season) => season.code.toLowerCase() === code.toLowerCase())
      : (current ?? [...seasons].reverse().find((season) => season.endsOn < today) ?? null)
    if (code && !shown) throw new NotFoundException(`Temporada ${code} no encontrada.`)
    const summaries = new Map(
      seasons.map((season) => [season.code, seasonSummary(season, matches, changes, OWNER_TIME_ZONE)]),
    )
    const summaryOf = (season: RankedSeason): SeasonSummaryView => {
      const summary = summaries.get(season.code) ?? seasonSummary(season, matches, changes, OWNER_TIME_ZONE)
      return {
        season,
        ...rateRow(summary.record),
        rank: summary.rank ? changeView(summary.rank) : null,
        steps: summary.steps.map((step) => ({
          ...changeView(step.change),
          move: step.move,
          decks: step.decks.map((deck) => ({ ...deck, ...rateRow(deck.record) })),
        })),
        byRank: summary.byRank.map((row) => ({ rank: row.rank, label: row.label, ...rateRow(row.record) })),
        byDeck: summary.byDeck.map((row) => ({ deckId: row.deckId, deckName: row.deckName, ...rateRow(row.record) })),
      }
    }
    const nowSummary = current ? summaries.get(current.code) : undefined
    return {
      timeZone: OWNER_TIME_ZONE,
      today,
      ranks: RANKS.map((rank) => ({ code: rank, label: rankLabelEs(rank) })),
      seasons: seasons.map((season) => {
        const summary = summaries.get(season.code)
        return {
          ...season,
          current: season.code === current?.code,
          ...rateRow(summary?.record ?? { wins: 0, losses: 0, ties: 0 }),
          rankLabel: summary?.rankLabel ?? null,
        }
      }),
      current: current
        ? {
            code: current.code,
            name: current.name,
            endsOn: current.endsOn,
            rank: nowSummary?.rank ? changeView(nowSummary.rank) : null,
          }
        : null,
      summary: shown ? summaryOf(shown) : null,
    }
  }

  /** Creates or corrects a season: its days may not overlap another season's. */
  async setSeason(code: string, input: { name: string; startsOn: string; endsOn: string }): Promise<RankedSeason> {
    if (input.endsOn < input.startsOn) {
      throw new BadRequestException({ code: 'validation', message: 'La temporada termina antes de empezar.' })
    }
    const data = {
      name: input.name.trim(),
      startsOn: new Date(`${input.startsOn}T00:00:00Z`),
      endsOn: new Date(`${input.endsOn}T00:00:00Z`),
    }
    // Review of #143: under the ranks' lock (the seasons say which ranks count, and the sheet import plans with them);
    // the overlap is also checked under it, so two edits at once cannot both pass it.
    await withRankLock(this.prisma, async (tx) => {
      const others = (await this.seasons(tx)).filter((season) => season.code !== code)
      const overlap = others.find((season) => season.startsOn <= input.endsOn && input.startsOn <= season.endsOn)
      if (overlap) {
        throw new BadRequestException({
          code: 'validation',
          message: `Se superpone con ${overlap.name} (${overlap.startsOn} a ${overlap.endsOn}).`,
        })
      }
      await tx.rankedSeason.upsert({ where: { code }, create: { code, ...data }, update: data })
    })
    return { code, name: data.name, startsOn: input.startsOn, endsOn: input.endsOn }
  }

  async deleteSeason(code: string): Promise<void> {
    const count = await withRankLock(this.prisma, async (tx) => {
      return (await tx.rankedSeason.deleteMany({ where: { code } })).count
    })
    if (count === 0) throw new NotFoundException(`Temporada ${code} no encontrada.`)
  }

  /** The rank as given, or why it cannot be noted (`matches_log` checks it before saving the match). */
  checkRank(input: { rank: string; points?: number | null }): Rank {
    if (!isRank(input.rank)) {
      throw new BadRequestException({ code: 'validation', message: `Rango «${input.rank}» desconocido.` })
    }
    if (input.points !== undefined && input.points !== null && input.rank !== 'master') {
      throw new BadRequestException({ code: 'validation', message: 'Solo la Master Ball lleva puntos.' })
    }
    return input.rank
  }

  /**
   * The rank a match led to, noted at its instant (deuda de #120: the quick entry, offline too, and `matches_log`). Only
   * for a competitive match in a season — otherwise null, and the match stays saved; the same rank already there
   * counts as noted, another one replaces it (the last one said).
   */
  async noteAfterMatch(
    match: { mode: string; playedAt: Date },
    rank: string,
    points: number | null,
  ): Promise<{
    change: RankChangeView
    replaced: { rank: Rank; points: number | null } | null
    written: boolean
  } | null> {
    if (match.mode !== 'competitive') return null
    if (!seasonOf(match.playedAt, await this.seasons(), OWNER_TIME_ZONE)) return null
    return this.noteRank({ rank, points, at: match.playedAt.toISOString() }, new Date(), { sameIsNoted: true })
  }

  /**
   * Notes the rank (now, when given, or — 18/10 — the one a registered match was played at: `beforeMatch`, noted just
   * before it, so it holds for that match and the next ones until the next change). Master Ball may carry its points.
   */
  async addRank(
    input: { rank: string; points?: number | null; at?: string; beforeMatch?: string },
    now = new Date(),
  ): Promise<RankChangeView> {
    return (await this.noteRank(input, now)).change
  }

  /**
   * `addRank`, and what it replaced. Review of #120: with a moment given (`at` or `beforeMatch`) the note of that
   * instant is replaced — correcting it from the edit page leaves no false step — and the same rank again is a 409, so a
   * retry (Claude's, or «Deshacer» twice) does not note it twice.
   */
  async noteRank(
    input: { rank: string; points?: number | null; at?: string; beforeMatch?: string },
    now = new Date(),
    /** `matches_log` (verification of #120): the same rank already there is no error — the match was saved. */
    options: { sameIsNoted?: boolean } = {},
  ): Promise<{
    change: RankChangeView
    replaced: { rank: Rank; points: number | null } | null
    /** False when the same rank was already there (`sameIsNoted`): nothing was written, nothing to undo. */
    written: boolean
  }> {
    const rank = this.checkRank(input)
    if (input.at && input.beforeMatch) {
      throw new BadRequestException({ code: 'validation', message: 'Mandá `at` o `beforeMatch`, no los dos.' })
    }
    const at = input.beforeMatch ? await this.beforeMatch(input.beforeMatch) : input.at ? new Date(input.at) : now
    if (Number.isNaN(at.getTime())) throw new BadRequestException({ code: 'validation', message: 'Fecha inválida.' })
    if (at.getTime() > now.getTime() + FUTURE_SLACK_MS) {
      throw new BadRequestException({ code: 'validation', message: 'Esa fecha todavía no llegó.' })
    }
    const points = input.points ?? null
    const view = (row: { id: number; at: Date; points: number | null }) =>
      changeView({ id: idToString(row.id), at: row.at, rank, points: row.points })
    if (!input.at && !input.beforeMatch) {
      // Codex on #143: every write of `rank_changes` goes under the ranks' lock (the sheet import plans with them).
      const created = await withRankLock(this.prisma, async (tx) => {
        return tx.rankChange.create({ data: { at, rank, points } })
      })
      return { change: view(created), replaced: null, written: true }
    }
    return withRankLock(this.prisma, async (tx) => {
      // Verification of #120: two notes for one moment at once would both find nothing and create two rows.
      const existing = await tx.rankChange.findFirst({ where: { at }, orderBy: { id: 'desc' } })
      if (!existing) {
        return {
          change: view(await tx.rankChange.create({ data: { at, rank, points } })),
          replaced: null,
          written: true,
        }
      }
      if (existing.rank === rank && existing.points === points) {
        if (options.sameIsNoted) return { change: view(existing), replaced: null, written: false }
        throw new ConflictException({
          code: 'already_noted',
          message: `${rankLabelEs(rank, points)} ya estaba anotado en ese momento.`,
        })
      }
      const row = await tx.rankChange.update({ where: { id: existing.id }, data: { rank, points } })
      return {
        change: view(row),
        replaced: isRank(existing.rank) ? { rank: existing.rank, points: existing.points } : null,
        written: true,
      }
    })
  }

  async deleteRank(rawId: string): Promise<void> {
    const id = parseNumericId(rawId, 'Rango')
    // Codex on #143: under the ranks' lock, so an import that planned with this rank cannot lose it half-way.
    const count = await withRankLock(this.prisma, async (tx) => {
      return (await tx.rankChange.deleteMany({ where: { id } })).count
    })
    if (count === 0) throw new NotFoundException(`Rango ${rawId} no encontrado.`)
  }
}
