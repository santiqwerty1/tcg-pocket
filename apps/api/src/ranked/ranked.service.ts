/**
 * Ranked by season and rank (pedido de Santi del 14/10): the game's seasons, the owner's rank noted when it changes,
 * and each season's summary (record, rank curve, record by rank and by deck). Only competitive matches count, by the
 * day they were played in the owner's time zone.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
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
  seasonSummary,
} from '@tcg/domain'
import { dateOnly, OWNER_TIME_ZONE, todayInOwnerZone } from '../config/time-zone.js'
import { idToString, parseNumericId } from '../http/ids.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { RankChangeView, RankedView, RateRowView, SeasonSummaryView } from './ranked-views.js'

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

  async seasons(): Promise<RankedSeason[]> {
    const rows = await this.prisma.rankedSeason.findMany({ orderBy: { startsOn: 'asc' } })
    return rows.map((row) => ({
      code: row.code,
      name: row.name,
      startsOn: dateOnly(row.startsOn) as string,
      endsOn: dateOnly(row.endsOn) as string,
    }))
  }

  async changes(): Promise<RankChange[]> {
    const rows = await this.prisma.rankChange.findMany({ orderBy: [{ at: 'asc' }, { id: 'asc' }] })
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
    const others = (await this.seasons()).filter((season) => season.code !== code)
    const overlap = others.find((season) => season.startsOn <= input.endsOn && input.startsOn <= season.endsOn)
    if (overlap) {
      throw new BadRequestException({
        code: 'validation',
        message: `Se superpone con ${overlap.name} (${overlap.startsOn} a ${overlap.endsOn}).`,
      })
    }
    const data = {
      name: input.name.trim(),
      startsOn: new Date(`${input.startsOn}T00:00:00Z`),
      endsOn: new Date(`${input.endsOn}T00:00:00Z`),
    }
    await this.prisma.rankedSeason.upsert({ where: { code }, create: { code, ...data }, update: data })
    return { code, name: data.name, startsOn: input.startsOn, endsOn: input.endsOn }
  }

  async deleteSeason(code: string): Promise<void> {
    const { count } = await this.prisma.rankedSeason.deleteMany({ where: { code } })
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

  /** Notes the rank (now, or when given): Master Ball may carry its points. */
  async addRank(
    input: { rank: string; points?: number | null; at?: string },
    now = new Date(),
  ): Promise<RankChangeView> {
    const rank = this.checkRank(input)
    const at = input.at ? new Date(input.at) : now
    if (Number.isNaN(at.getTime())) throw new BadRequestException({ code: 'validation', message: 'Fecha inválida.' })
    if (at.getTime() > now.getTime() + FUTURE_SLACK_MS) {
      throw new BadRequestException({ code: 'validation', message: 'Esa fecha todavía no llegó.' })
    }
    const row = await this.prisma.rankChange.create({ data: { at, rank, points: input.points ?? null } })
    return changeView({ id: idToString(row.id), at: row.at, rank, points: row.points })
  }

  async deleteRank(rawId: string): Promise<void> {
    const id = parseNumericId(rawId, 'Rango')
    const { count } = await this.prisma.rankChange.deleteMany({ where: { id } })
    if (count === 0) throw new NotFoundException(`Rango ${rawId} no encontrado.`)
  }
}
