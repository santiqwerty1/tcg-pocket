/**
 * Resumen semanal (Fase 32): a week (Monday to Sunday, Buenos Aires time) at a glance — your matches against the week
 * before, games against the bot and what the coach thought, the practice (situations and exercises), the work the PC
 * did, the CSV imports and, for the latest week, the archetypes that moved in tournaments. `GET /api/weekly` (by
 * default the last full week) and a push on Mondays at 10:00 when something happened.
 */
import { Controller, Get, Inject, Injectable, Module, Query } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import {
  type CoachReview,
  coachSummary,
  formatWinRateEs,
  type GameRecord,
  shiftWeek,
  type WinRate,
  weekLabelEs,
  weekOfDate,
  weekStart,
  zonedDate,
} from '@tcg/domain'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { ENV, type Env } from '../config/env.js'
import { OWNER_TIME_ZONE } from '../config/time-zone.js'
import type { Prisma } from '../generated/prisma/client.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { MatchesModule } from '../matches/matches.module.js'
import { MatchesService } from '../matches/matches.service.js'
import { NotificationsModule } from '../notifications/notifications.controller.js'
import { NotificationsService } from '../notifications/notifications.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { TournamentsModule } from '../tournaments/tournaments.controller.js'
import { TournamentsService } from '../tournaments/tournaments.service.js'

const TZ = OWNER_TIME_ZONE

interface RowSummary {
  record: GameRecord
  games: number
  text: string
}

export interface WeekSummaryView {
  week: {
    /** Monday, local date. */
    start: string
    from: string
    to: string
    label: string
    previous: string
    /** null for the current week (no week after it yet). */
    next: string | null
    current: boolean
  }
  matches: {
    overall: RowSummary
    previousWeek: RowSummary
    byDeck: (RowSummary & { deck: string; deckId: string })[]
    /** Rivals with 2 or more games: the best and the worst record. */
    bestRival: (RowSummary & { label: string }) | null
    worstRival: (RowSummary & { label: string }) | null
  }
  bot: { games: number; wins: number; losses: number; ties: number; coachGames: number; coachAgreement: number | null }
  practice: { situationsTried: number; situationsSolved: number; drillsAnswered: number; drillsCorrect: number }
  work: { simulations: number; lab: number }
  imports: number
  /** Only for the latest weeks: archetypes that moved the most in tournaments in the last 7 days. */
  meta: { rising: { name: string; delta: number }[]; falling: { name: string; delta: number }[] } | null
  headline: string
  quiet: boolean
}

function row(view: { record: GameRecord; rate: WinRate<'matches'> | null }): RowSummary {
  const games = view.record.wins + view.record.losses + view.record.ties
  return { record: view.record, games, text: games > 0 ? formatWinRateEs(view.rate) : 'sin partidas' }
}

const share = (record: GameRecord) => {
  const games = record.wins + record.losses + record.ties
  return games === 0 ? 0 : (record.wins + record.ties / 2) / games
}

@Injectable()
export class WeeklyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matches: MatchesService,
    private readonly tournaments: TournamentsService,
  ) {}

  async summary(input: { week?: string | undefined; now?: Date } = {}): Promise<WeekSummaryView> {
    const now = input.now ?? new Date()
    const thisWeek = weekStart(now, TZ)
    const asked = input.week ? weekOfDate(input.week, TZ) : null
    const start = asked && asked <= thisWeek ? asked : shiftWeek(thisWeek, -1, TZ)
    const end = shiftWeek(start, 1, TZ)
    const before = shiftWeek(start, -1, TZ)
    const range = { gte: start, lt: end }
    const [stats, previous, bot, puzzles, drills, jobs, imports] = await Promise.all([
      this.matches.stats({ from: start.toISOString(), to: new Date(end.getTime() - 1).toISOString() }),
      this.matches.stats({ from: before.toISOString(), to: new Date(start.getTime() - 1).toISOString() }),
      this.prisma.liveGame.findMany({
        where: { status: 'done', finishedAt: range },
        select: { winner: true, coach: true, coachLog: true },
      }),
      this.prisma.puzzleAttempt.findMany({ where: { lastAt: range }, select: { solved: true } }),
      this.prisma.drillAttempt.findMany({ where: { createdAt: range }, select: { correct: true } }),
      this.prisma.simulationJob.findMany({
        where: { status: 'done', finishedAt: range },
        select: { params: true },
      }),
      this.prisma.collectionImport.count({ where: { status: 'applied', appliedAt: range } }),
    ])
    const rivals = stats.byOpponent
      .filter((item) => item.key !== null)
      .map((item) => ({ ...row(item), label: item.label }))
      .filter((item) => item.games >= 2)
    const sorted = [...rivals].sort((a, b) => share(b.record) - share(a.record) || b.games - a.games)
    const coached = bot.filter((game) => game.coach)
    const decisions = coached.flatMap((game) => (game.coachLog as unknown as CoachReview[]) ?? [])
    const agreement = decisions.length > 0 ? Math.round(coachSummary(decisions).agreement) : null
    const lab = jobs.filter((job) => (job.params as { lab?: unknown } | null)?.lab).length

    // The meta only for the last two weeks: the trends are always the latest 7 days.
    let meta: WeekSummaryView['meta'] = null
    if (start >= shiftWeek(thisWeek, -1, TZ)) {
      const trends = await this.tournaments.trends({ days: 7 }).catch(() => null)
      const clear = (trends?.archetypes ?? []).filter((item) => item.clear)
      meta = {
        rising: clear
          .filter((item) => item.delta > 0)
          .sort((a, b) => b.delta - a.delta)
          .slice(0, 2)
          .map((item) => ({ name: item.archetype.name, delta: Math.round(item.delta * 10) / 10 })),
        falling: clear
          .filter((item) => item.delta < 0)
          .sort((a, b) => a.delta - b.delta)
          .slice(0, 2)
          .map((item) => ({ name: item.archetype.name, delta: Math.round(item.delta * 10) / 10 })),
      }
    }

    const overall = row(stats.overall)
    const view: Omit<WeekSummaryView, 'headline' | 'quiet'> = {
      week: {
        start: zonedDate(start, TZ),
        from: start.toISOString(),
        to: end.toISOString(),
        label: weekLabelEs(start, TZ),
        previous: zonedDate(before, TZ),
        next: end <= thisWeek ? zonedDate(end, TZ) : null,
        current: start.getTime() === thisWeek.getTime(),
      },
      matches: {
        overall,
        previousWeek: row(previous.overall),
        byDeck: stats.byDeck
          .map((item) => ({ ...row(item), deck: item.deck.name, deckId: item.deck.id }))
          .sort((a, b) => b.games - a.games)
          .slice(0, 3),
        bestRival: sorted[0] ?? null,
        worstRival: sorted.length > 1 ? (sorted.at(-1) ?? null) : null,
      },
      bot: {
        games: bot.length,
        wins: bot.filter((game) => game.winner === 'you').length,
        losses: bot.filter((game) => game.winner === 'bot').length,
        ties: bot.filter((game) => game.winner === 'tie').length,
        coachGames: coached.length,
        coachAgreement: agreement,
      },
      practice: {
        situationsTried: puzzles.length,
        situationsSolved: puzzles.filter((item) => item.solved).length,
        drillsAnswered: drills.length,
        drillsCorrect: drills.filter((item) => item.correct).length,
      },
      work: { simulations: jobs.length - lab, lab },
      imports,
      meta,
    }
    const parts: string[] = []
    if (overall.games > 0) {
      const { wins, losses, ties } = overall.record
      parts.push(
        `${wins}-${losses}${ties > 0 ? `-${ties}` : ''} en partidas (${Math.round(share(overall.record) * 100)} %)`,
      )
    }
    if (view.bot.games > 0) parts.push(`${view.bot.games} contra el bot`)
    if (view.practice.drillsAnswered > 0) {
      parts.push(`${view.practice.drillsCorrect}/${view.practice.drillsAnswered} ejercicios`)
    }
    const solved = view.practice.situationsSolved
    if (solved > 0) parts.push(`${solved} ${solved === 1 ? 'situación resuelta' : 'situaciones resueltas'}`)
    const quiet = parts.length === 0
    return { ...view, headline: quiet ? 'Semana tranquila: no registraste partidas.' : parts.join(' · '), quiet }
  }
}

/** Monday 10:00 (Buenos Aires): the push with last week, once per week and only if something happened. */
@Injectable()
export class WeeklyCron {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly weekly: WeeklyService,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WeeklyCron.name)
  }

  @Cron('0 10 * * 1', { timeZone: TZ })
  async monday(): Promise<void> {
    if (!this.env.notificationsWatch) return
    await this.send().catch((error) => this.logger.warn({ err: error }, 'weekly summary push'))
  }

  /** Sends last week's summary (tests call it); returns the devices reached. */
  async send(now = new Date()): Promise<number> {
    if (!this.notifications.enabled) return 0
    const summary = await this.weekly.summary({ now })
    if (summary.quiet) return 0
    const done = await this.prisma.appSetting.findUnique({ where: { key: 'weeklyNotified' } })
    if (done?.value === summary.week.start) return 0
    await this.prisma.appSetting.upsert({
      where: { key: 'weeklyNotified' },
      create: { key: 'weeklyNotified', value: summary.week.start as Prisma.InputJsonValue },
      update: { value: summary.week.start as Prisma.InputJsonValue },
    })
    return this.notifications.notify('weekly', {
      title: `Tu semana (${summary.week.label})`,
      body: summary.headline,
      url: `/partidas/semana?semana=${summary.week.start}`,
      tag: 'weekly',
    })
  }
}

const querySchema = z.object({
  semana: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})

@Controller('api/weekly')
export class WeeklyController {
  constructor(private readonly weekly: WeeklyService) {}

  @Get()
  get(
    @Query(new ZodValidationPipe(querySchema)) query: z.infer<typeof querySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<WeekSummaryView> {
    return this.weekly.summary({ week: query.semana })
  }
}

@Module({
  imports: [MatchesModule, TournamentsModule, NotificationsModule],
  controllers: [WeeklyController],
  providers: [WeeklyService, WeeklyCron],
  exports: [WeeklyService, WeeklyCron],
})
export class WeeklyModule {}
