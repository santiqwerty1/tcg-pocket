/**
 * Avisos (BRIEF «más adelante», PLAN Fase 8): what the owner should know without looking for it. A new set in the
 * tracker the pinned catalog does not have, a probable new era, tournament lists with cards the catalog does not
 * know (a set is out), a newer deckgym, a limited pack about to leave the shop. Read-only: nothing changes by itself
 * (the catalog pin and the era table move by hand, PLAN §3.1).
 *
 * Fase 38 (R-011): also what fails without anyone seeing it — the daily copy, the Limitless sync, the catalog sync,
 * the GitHub checks — and a database close to Supabase's limit.
 */
import { Inject, Injectable } from '@nestjs/common'
import {
  canPlayEtBot,
  canPlayFairBots,
  canPlayPerGame,
  ET_BOT_CODE,
  FAIR_BOT_CODES,
  parseExpansionIds,
  saidGamesRev,
} from '@tcg/domain'
import { PinoLogger } from 'nestjs-pino'
import { CatalogService } from '../catalog/catalog.service.js'
import { ENV, type Env } from '../config/env.js'
import { OWNER_TIME_ZONE, todayInOwnerZone } from '../config/time-zone.js'
import {
  BACKUP_STALE_MS,
  DATABASE_ALERT_MB,
  DATABASE_ALERT_STEP_MB,
  DATABASE_LIMIT_MB,
  LIMITLESS_STALE_MS,
  OpsService,
} from '../ops/ops.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { GAMES_REV_GONE_MS } from '../simulation/engine-change.service.js'
import { EngineUpstreamService, type UpstreamFailure } from '../simulation/engine-upstream.service.js'
import { EngineStatusService } from '../simulation/snapshots.service.js'
import { TournamentsService } from '../tournaments/tournaments.service.js'

export interface AlertView {
  code:
    | 'new_set'
    | 'new_era_likely'
    | 'unknown_cards'
    | 'engine_update'
    | 'limited_pack'
    | 'backup_drill'
    | 'era_missing_set'
    | 'worker_idle'
    | 'worker_paused'
    | 'mcp_new_client'
    | 'backup_stale'
    | 'limitless_sync'
    | 'catalog_sync'
    | 'github_check'
    | 'database_size'
    | 'backup_offsite'
    | 'tracker_sync'
    | 'search_old_engine'
  level: 'info' | 'warning'
  title: string
  detail: string
  /** Where to act, inside the app (or an external page). */
  link: string | null
}

const FRESH_MS = 12 * 60 * 60 * 1000
const RETRY_MS = 60 * 60 * 1000
const LIMITED_SOON_DAYS = 7
/** No worker for this long with work waiting is an outage (H-016). */
const WORKER_IDLE_MS = 30 * 60 * 1000
/** Fase 43 (R-010): how long «un cliente nuevo usó un token» stays in the list. */
const NEW_CLIENT_DAYS = 7

/** «9/10» in the owner's time zone. */
function ownerDate(date: Date): string {
  return ownerDateTime(date).split(' ')[0] ?? ''
}

/** «9/10 02:35» in the owner's time zone. */
function ownerDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('es-AR', {
    timeZone: OWNER_TIME_ZONE,
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('day')}/${get('month')} ${get('hour')}:${get('minute')}`
}

/** Expansions the tracker's `main` declares that the pinned catalog does not have (checked every 12 hours). */
@Injectable()
export class TrackerUpstreamService {
  private cache: { at: number; ttl: number; ids: string[] | null } | null = null
  /** Fase 38: the last failed check (null after one that worked). */
  lastFailure: UpstreamFailure | null = null
  /** Tests swap it. */
  fetchImpl: typeof fetch = fetch

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TrackerUpstreamService.name)
  }

  async expansionIds(now = Date.now()): Promise<string[] | null> {
    if (!this.env.trackerUpstreamCheck) return null
    if (this.cache && now - this.cache.at < this.cache.ttl) return this.cache.ids
    let ids: string[] | null = null
    try {
      const response = await this.fetchImpl(`${this.env.trackerUpstreamUrl}/main/frontend/src/types/index.ts`, {
        headers: { 'User-Agent': 'tcg-pocket' },
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new Error(`GitHub ${response.status}`)
      ids = parseExpansionIds(await response.text())
      this.lastFailure = null
    } catch (error) {
      this.logger.warn({ err: error }, 'tracker upstream check failed')
      this.lastFailure = {
        at: new Date(now).toISOString(),
        message: error instanceof Error ? error.message : String(error),
      }
    }
    this.cache = { at: now, ttl: ids ? FRESH_MS : RETRY_MS, ids }
    return ids
  }
}

/** What a job or a game against the bot needs from a worker's engine, beyond its deckgym. */
type WorkNeed = 'perGame' | 'etBot' | 'fairBots'

/** Work waiting that no worker of the last 30 minutes can take, and why. */
interface BlockedWork {
  reason: 'blocked'
  chunks: number
  games: number
  since: string
  needs: WorkNeed[]
  /** Deckgym revisions no recent worker has. */
  engines: string[]
  /** Games revisions some job or game is fixed to and no recent worker with its deckgym has (phase 42). */
  gamesRevs: number[]
}

/**
 * After a deploy the workers update themselves to the new deckgym and engine-cli within minutes (D-026): until then
 * the work they cannot take yet is not news (review of #67).
 */
export const DEPLOY_GRACE_MS = 15 * 60 * 1000

const NEED_ES: Record<WorkNeed, { what: string; fix: string }> = {
  perGame: { what: 'resultados partida por partida', fix: 'el worker 0.2.5 o más nuevo con el motor recompilado' },
  etBot: { what: 'el bot «et» (solo termina el turno)', fix: 'engine-cli 0.3.5 o más nuevo' },
  fairBots: { what: 'los bots f', fix: 'un motor con fairBots' },
}

function listEs(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`
}

/** The worker_idle alert for work no recent worker can take: chunks and games against the bot, each by its name. */
function blockedAlert(idle: BlockedWork): AlertView {
  const what =
    idle.chunks > 0 && idle.games > 0
      ? 'simulaciones y partidas contra el bot'
      : idle.chunks > 0
        ? 'simulaciones'
        : 'partidas contra el bot'
  const counts = [
    idle.chunks > 0 ? `${idle.chunks} ${idle.chunks === 1 ? 'chunk' : 'chunks'}` : null,
    idle.games > 0 ? `${idle.games} ${idle.games === 1 ? 'partida contra el bot' : 'partidas contra el bot'}` : null,
  ].filter((part) => part !== null)
  const one = idle.chunks + idle.games === 1
  const needs = [
    ...idle.engines.map((rev) => ({ what: `el motor deckgym ${rev.slice(0, 7)}`, fix: 'un worker con ese motor' })),
    ...idle.gamesRevs.map((rev) => ({
      what: `la revisión ${rev} de las partidas del motor`,
      fix: 'un worker con esa revisión (si hay workers con una más nueva, la simulación se vuelve a jugar entera sola a los 30 minutos)',
    })),
    ...idle.needs.map((need) => NEED_ES[need]),
  ]
  return {
    code: 'worker_idle',
    level: 'warning',
    // The oldest one's date in the title: a new case is pushed again (notifications remember titles).
    title: `Hay ${what} que ningún worker puede jugar (desde el ${idle.since})`,
    detail: `${listEs(counts)} ${one ? 'pide' : 'piden'} ${listEs(needs.map((need) => need.what))}, y ningún worker de los últimos 30 minutos tiene todo eso: hace falta ${listEs(needs.map((need) => need.fix))}. Los workers se actualizan solos desde la app; si uno no, actualizalo a mano.`,
    link: '/simulacion',
  }
}

@Injectable()
export class AlertsService {
  /** When this process started: a deploy, with a new deckgym or worker package (tests set the grace to 0). */
  private readonly startedAt = Date.now()
  deployGraceMs = DEPLOY_GRACE_MS

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly tracker: TrackerUpstreamService,
    private readonly tournaments: TournamentsService,
    private readonly engine: EngineStatusService,
    private readonly engineUpstream: EngineUpstreamService,
    private readonly ops: OpsService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.ops.trackerFailure = () => this.tracker.lastFailure
  }

  async list(): Promise<AlertView[]> {
    const alerts: AlertView[] = []
    const index = this.catalog.requireIndex()
    const known = new Set(index.catalog.expansions.map((expansion) => expansion.id))
    const [upstream, era, engine, limited] = await Promise.all([
      this.tracker.expansionIds().catch(() => null),
      this.tournaments.eraAlerts().catch(() => null),
      this.engineUpstream.status(this.engine.engineRev()).catch(() => null),
      this.limitedSoon(),
    ])
    const fresh = (upstream ?? []).filter((id) => !known.has(id))
    if (fresh.length > 0) {
      alerts.push({
        code: 'new_set',
        level: 'warning',
        title: `Set nuevo en el tracker: ${fresh.join(', ')}`,
        detail:
          'El tracker ya tiene cartas que el catálogo no conoce. Más → Catálogo → «Actualizar al último del tracker» muestra qué cambia antes de aplicarlo; después, Torneos → Ajustes propone la fila del set para la tabla de eras.',
        link: '/mas/catalogo',
      })
    }
    if (era?.unknownSets.length) {
      alerts.push({
        code: 'unknown_cards',
        level: 'warning',
        title: `Listas de torneo con cartas que el catálogo no conoce (${era.unknownSets.join(', ')})`,
        detail: `${era.unknownCards} cartas distintas en las listas de la era: probablemente salió un set. Hasta actualizar el catálogo esas listas no cuentan por carta funcional.`,
        link: '/torneos/ajustes',
      })
    }
    for (const missing of era?.missingEraSets ?? []) {
      alerts.push({
        code: 'era_missing_set',
        level: 'warning',
        title: `Torneos con un set que falta en la tabla de eras (${missing.set})`,
        detail: `${missing.tournaments} ${missing.tournaments === 1 ? 'torneo juega' : 'torneos juegan'} ${missing.set}: quedan afuera de la era actual hasta cargar el set. Torneos → Ajustes ya tiene la fila propuesta (fecha del primer torneo y si abre era): revisala y agregala.`,
        link: '/torneos/ajustes',
      })
    }
    if (era?.newEra?.likely) {
      alerts.push({
        code: 'new_era_likely',
        level: 'warning',
        title: 'Era nueva probable',
        detail: `Pasaron ${era.newEra.days} días desde ${era.newEra.lastRelease}. Si salió un set, cargalo en la tabla de eras para que los torneos se separen bien.`,
        link: '/torneos/ajustes',
      })
    }
    for (const pack of limited) {
      alerts.push({
        code: 'limited_pack',
        level: 'info',
        title: `${pack.name}: ${pack.days === 0 ? 'hoy es el último día' : `quedan ${pack.days} ${pack.days === 1 ? 'día' : 'días'}`}`,
        detail: `Sale de la tienda después del ${pack.until.split('-').reverse().join('/')}. Lo que solo da este sobre está marcado en Sobres.`,
        link: '/sobres',
      })
    }
    const trackerWarning = (await this.prisma.appSetting.findUnique({ where: { key: 'trackerSyncWarning' } }))?.value as
      | { at?: string; message?: string; previewId?: string | null }
      | null
      | undefined
    if (trackerWarning?.message)
      alerts.push({
        code: 'tracker_sync',
        level: 'warning',
        title: 'Revisar sincronización del tracker',
        detail: trackerWarning.at
          ? `${new Date(trackerWarning.at).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}: ${trackerWarning.message}`
          : trackerWarning.message,
        link: trackerWarning.previewId ? `/coleccion/importar/${trackerWarning.previewId}` : '/mas/ajustes',
      })
    // Fase 35: the monthly restore drill failed, or the last one is more than 40 days old.
    const drill = (await this.prisma.appSetting.findUnique({ where: { key: 'backupDrill' } }))?.value as
      | { at?: string; ok?: boolean; error?: string | null; differences?: string[] }
      | undefined
    if (drill?.at && drill.ok === false) {
      alerts.push({
        code: 'backup_drill',
        level: 'warning',
        title: 'Falló la prueba del backup',
        detail: `El ${drill.at.slice(0, 10).split('-').reverse().join('/')}: ${drill.error ?? `al restaurarlo cambiaron ${(drill.differences ?? []).join(', ')}`}. Probalo de nuevo en Más → Copia de seguridad.`,
        link: '/mas/backup',
      })
    } else if (drill?.at && Date.now() - new Date(drill.at).getTime() > 40 * 24 * 60 * 60 * 1000) {
      alerts.push({
        code: 'backup_drill',
        level: 'info',
        title: 'Hace más de 40 días que no se prueba el backup',
        detail: 'La prueba corre sola el 1 de cada mes; podés correrla en Más → Copia de seguridad.',
        link: '/mas/backup',
      })
    }
    const idle = await this.workerIdle()
    if (idle?.reason === 'blocked') {
      if (Date.now() - this.startedAt >= this.deployGraceMs) alerts.push(blockedAlert(idle))
    } else if (idle?.reason === 'paused') {
      // Paused after lost results (worker 0.3.4): restarting it would only play the chunk again (review of #72).
      alerts.push({
        code: 'worker_paused',
        level: 'info',
        title: `${idle.names} en pausa hasta el ${idle.until} por resultados perdidos`,
        detail: `${idle.waiting} ${idle.waiting === 1 ? 'tarea espera' : 'tareas esperan'}. El sistema del equipo cortó el motor a mitad de un cruce; el worker vuelve solo. No hace falta reiniciarlo: revisá la batería de Termux («Sin restricciones»).`,
        link: '/simulacion',
      })
    } else if (idle) {
      alerts.push({
        code: 'worker_idle',
        level: 'warning',
        title: idle.since
          ? `Hay trabajo esperando y ningún worker desde el ${idle.since}`
          : 'Hay trabajo esperando y nunca se conectó un worker',
        detail: `${idle.waiting} ${idle.waiting === 1 ? 'tarea espera' : 'tareas esperan'} (simulaciones o partidas contra el bot). Prendé la PC o reiniciá el worker.`,
        link: '/simulacion',
      })
    }
    // Phase 42: a Laboratorio search keeps the deckgym it started with (EngineChangeService leaves it): say so.
    const searches = await this.prisma.simulationJob.findMany({
      where: { kind: 'explore', status: { in: ['queued', 'running'] }, engineRev: { not: this.engine.engineRev() } },
      select: { id: true, label: true, engineRev: true },
    })
    for (const search of searches) {
      alerts.push({
        code: 'search_old_engine',
        level: 'warning',
        title: `La búsqueda «${search.label}» (#${search.id}) espera el motor viejo`,
        detail: `Empezó con deckgym ${search.engineRev.slice(0, 7)} y ningún worker con el motor nuevo la juega. Cancelala en el Laboratorio, o dejala si se vuelve a ese motor.`,
        link: `/laboratorio/${search.id}`,
      })
    }
    // And one fixed to a games revision that no worker has had for half an hour, while others have another one.
    const since = new Date(Date.now() - GAMES_REV_GONE_MS)
    const fixed = await this.prisma.$queryRaw<{ id: number; label: string; gamesRev: number }[]>`
      SELECT j."id", j."label", j."games_rev" AS "gamesRev"
      FROM "simulation_jobs" j
      WHERE j."kind" = 'explore' AND j."status" IN ('queued', 'running') AND j."games_rev" IS NOT NULL
        AND j."engine_rev" = ${this.engine.engineRev()}
        AND NOT EXISTS (
          SELECT 1 FROM "worker_nodes" w
          WHERE w."engine_rev" = j."engine_rev" AND w."games_rev" = j."games_rev" AND w."last_seen_at" > ${since})
        AND EXISTS (
          SELECT 1 FROM "worker_nodes" w
          WHERE w."engine_rev" = j."engine_rev" AND w."games_rev" <> j."games_rev" AND w."last_seen_at" > ${since})
      ORDER BY j."id"`
    for (const search of fixed) {
      alerts.push({
        code: 'search_old_engine',
        level: 'warning',
        title: `La búsqueda «${search.label}» (#${search.id}) espera la revisión ${search.gamesRev} del motor`,
        detail: `Se empezó a jugar con la revisión ${search.gamesRev} de engine-cli y los workers de ahora juegan con otra. Cancelala en el Laboratorio, o dejala si vuelve un worker con esa revisión.`,
        link: `/laboratorio/${search.id}`,
      })
    }
    alerts.push(...(await this.newTokenClients()))
    alerts.push(...(await this.operation()))
    if (engine && engine.aheadBy > 0) {
      alerts.push({
        code: 'engine_update',
        level: 'info',
        title: `deckgym tiene ${engine.aheadBy} ${engine.aheadBy === 1 ? 'commit nuevo' : 'commits nuevos'}`,
        detail: 'El motor queda fijo hasta que decidas actualizarlo; el detalle está en Simulación.',
        link: '/simulacion',
      })
    }
    return alerts
  }

  /**
   * H-016 (Fase 36): work waiting (a chunk queued or whose worker stopped renewing it, a game against the bot not
   * taken) and no worker seen in 30 minutes. The title carries when the last one was seen, so each outage is pushed
   * once (the notifications remember titles).
   */
  /**
   * Fase 43 (R-010): an API token used by a client it had not seen in the last week. The first client of a token is
   * information (Santi just connected it); another one is a warning: maybe the token leaked.
   */
  private async newTokenClients(): Promise<AlertView[]> {
    const since = new Date(Date.now() - NEW_CLIENT_DAYS * 24 * 60 * 60 * 1000)
    const fresh = await this.prisma.apiTokenClient.findMany({
      where: { firstSeenAt: { gte: since } },
      orderBy: { firstSeenAt: 'asc' },
    })
    if (fresh.length === 0) return []
    const tokenIds = [...new Set(fresh.map((row) => row.tokenId))]
    const [tokens, older] = await Promise.all([
      this.prisma.apiToken.findMany({
        where: { id: { in: tokenIds } },
        select: { id: true, name: true, prefix: true, revokedAt: true },
      }),
      this.prisma.apiTokenClient.findMany({
        where: { tokenId: { in: tokenIds } },
        orderBy: { firstSeenAt: 'asc' },
        select: { tokenId: true, client: true },
      }),
    ])
    const alerts: AlertView[] = []
    for (const row of fresh) {
      const token = tokens.find((item) => item.id === row.tokenId)
      if (!token || token.revokedAt) continue
      const first = older.find((item) => item.tokenId === row.tokenId)?.client === row.client
      // The prefix tells two tokens with the same name apart: notifications are sent once per title.
      const label = `«${token.name}» (${token.prefix}…)`
      alerts.push({
        code: 'mcp_new_client',
        level: first ? 'info' : 'warning',
        title: first
          ? `El token ${label} empezó a usarse (${row.client})`
          : `Un cliente nuevo usó el token ${label}: ${row.client}`,
        detail: `${first ? 'Primer uso' : 'Primera vez'} el ${ownerDateTime(row.firstSeenAt)}.${first ? '' : ' Si no lo conectaste vos, revocalo en Más → Tokens de API y creá otro.'}`,
        link: '/mas/tokens',
      })
    }
    return alerts
  }

  private async workerIdle(
    now = new Date(),
  ): Promise<
    | { waiting: number; since: string | null; reason: 'none' }
    | { waiting: number; reason: 'paused'; names: string; until: string }
    | BlockedWork
    | null
  > {
    const waitingChunk = { OR: [{ status: 'queued' as const }, { status: 'leased' as const, leaseUntil: { lt: now } }] }
    const [chunks, games, last, recent] = await Promise.all([
      this.prisma.simulationChunk.count({ where: { job: { status: { in: ['queued', 'running'] } }, ...waitingChunk } }),
      this.prisma.liveGame.count({ where: { status: 'queued' } }),
      this.prisma.workerNode.findFirst({ orderBy: { lastSeenAt: 'desc' }, select: { lastSeenAt: true } }),
      this.prisma.workerNode.findMany({
        where: { lastSeenAt: { gte: new Date(now.getTime() - WORKER_IDLE_MS) } },
        select: {
          name: true,
          engineRev: true,
          version: true,
          cliVersion: true,
          engineFeatures: true,
          gamesRev: true,
          pausedUntil: true,
        },
      }),
    ])
    const waiting = chunks + games
    if (waiting === 0) return null
    if (recent.length === 0) {
      return { waiting, since: last ? ownerDateTime(last.lastSeenAt) : null, reason: 'none' }
    }
    // Every worker alive is paused after lost results (worker 0.3.4): the work waits for the pause, not for a restart.
    const paused = recent.filter((worker) => worker.pausedUntil !== null && worker.pausedUntil > now)
    if (chunks > 0 && paused.length === recent.length) {
      const until = new Date(Math.min(...paused.map((worker) => (worker.pausedUntil as Date).getTime())))
      return {
        waiting,
        reason: 'paused',
        names: paused.map((worker) => worker.name).join(', '),
        until: ownerDateTime(until),
      }
    }
    // Some worker is alive, but work that none of them can play waits all the same, as the claims filter it: a job
    // with perGame (H-010), «et» (H-051) or an f bot (H-018) needs all of them in one worker with its deckgym.
    const [jobs, liveGames] = await Promise.all([
      this.prisma.simulationJob.findMany({
        where: { status: { in: ['queued', 'running'] }, chunks: { some: waitingChunk } },
        select: {
          kind: true,
          players: true,
          params: true,
          engineRev: true,
          gamesRev: true,
          createdAt: true,
          _count: { select: { chunks: { where: waitingChunk } } },
        },
      }),
      this.prisma.liveGame.findMany({
        where: { status: 'queued' },
        select: { bot: true, engineRev: true, gamesRev: true, createdAt: true },
      }),
    ])
    const fair = new Set<string>(FAIR_BOT_CODES)
    const has = (worker: (typeof recent)[number], need: WorkNeed) =>
      need === 'perGame' ? canPlayPerGame(worker) : need === 'etBot' ? canPlayEtBot(worker) : canPlayFairBots(worker)
    const blocked = {
      chunks: 0,
      games: 0,
      first: null as Date | null,
      needs: new Set<WorkNeed>(),
      engines: new Set<string>(),
      gamesRevs: new Set<number>(),
    }
    // Phase 42: a job or a game fixed to a games revision needs a worker that plays that way, as the claims filter.
    const playsAs = (worker: (typeof recent)[number], gamesRev: number | null) =>
      gamesRev === null || saidGamesRev(worker) === gamesRev
    const check = (engineRev: string, gamesRev: number | null, needs: WorkNeed[], createdAt: Date) => {
      const able = (worker: (typeof recent)[number]) =>
        worker.engineRev === engineRev && playsAs(worker, gamesRev) && needs.every((need) => has(worker, need))
      if (recent.some(able)) return false
      const sameEngine = recent.filter((worker) => worker.engineRev === engineRev)
      if (sameEngine.length === 0) blocked.engines.add(engineRev)
      else if (gamesRev !== null && !sameEngine.some((worker) => playsAs(worker, gamesRev)))
        blocked.gamesRevs.add(gamesRev)
      for (const need of needs) blocked.needs.add(need)
      if (!blocked.first || createdAt < blocked.first) blocked.first = createdAt
      return true
    }
    for (const job of jobs) {
      const needs: WorkNeed[] = []
      const perGame = (job.params as { perGame?: unknown } | null)?.perGame === true
      if (perGame && ['matrix', 'compare', 'explore'].includes(job.kind)) needs.push('perGame')
      if (job.kind !== 'consistency' && job.players.includes(ET_BOT_CODE)) needs.push('etBot')
      if (job.players.some((code) => fair.has(code))) needs.push('fairBots')
      if (check(job.engineRev, job.gamesRev, needs, job.createdAt)) blocked.chunks += job._count.chunks
    }
    for (const game of liveGames) {
      const needs: WorkNeed[] = []
      if (game.bot === ET_BOT_CODE) needs.push('etBot')
      if (fair.has(game.bot)) needs.push('fairBots')
      if (check(game.engineRev, game.gamesRev, needs, game.createdAt)) blocked.games += 1
    }
    if (blocked.chunks + blocked.games === 0 || !blocked.first) return null
    return {
      reason: 'blocked',
      chunks: blocked.chunks,
      games: blocked.games,
      since: ownerDateTime(blocked.first),
      needs: [...blocked.needs],
      engines: [...blocked.engines],
      gamesRevs: [...blocked.gamesRevs],
    }
  }

  /**
   * Fase 38 (R-011): the jobs that run on their own and fail in silence. Each title carries a date, so a new failure
   * is pushed again (the notifications remember titles) and a fixed one goes away.
   */
  private async operation(now = Date.now()): Promise<AlertView[]> {
    const alerts: AlertView[] = []
    const [backup, limitless, catalog, databaseBytes] = await Promise.all([
      this.ops.backup(),
      this.ops.limitless(),
      this.ops.catalogSync(),
      this.ops.databaseBytes(),
    ])
    if (backup.enabled && backup.failure) {
      alerts.push({
        code: 'backup_stale',
        level: 'warning',
        title: `Falló la copia diaria del ${ownerDateTime(new Date(backup.failure.at))}`,
        detail: `${backup.failure.error.slice(0, 200)}. Bajá una copia a mano en Más → Copia de seguridad mientras tanto.`,
        link: '/mas/backup',
      })
    } else if (backup.enabled && (!backup.last || now - Date.parse(backup.last.at) > BACKUP_STALE_MS)) {
      alerts.push({
        code: 'backup_stale',
        level: 'warning',
        title: backup.last
          ? `No hay copia diaria desde el ${ownerDateTime(new Date(backup.last.at))}`
          : 'Todavía no hay ninguna copia diaria',
        detail:
          'La copia corre sola a las 04:00. Mirá los logs del servidor y bajá una a mano en Más → Copia de seguridad.',
        link: '/mas/backup',
      })
    }
    // Fase 39: the copy outside Supabase failed, or has not gone up in 26 hours.
    const offsite = backup.offsite
    if (backup.enabled && offsite.enabled && offsite.last?.ok === false) {
      alerts.push({
        code: 'backup_offsite',
        level: 'warning',
        title: `Falló la subida de la copia a la nube del ${ownerDateTime(new Date(offsite.last.at))}`,
        detail: `${(offsite.last.error ?? 'error desconocido').slice(0, 200)}. La copia sigue en la base; probá de nuevo en Más → Copia de seguridad.`,
        link: '/mas/backup',
      })
    } else if (
      backup.enabled &&
      offsite.enabled &&
      (!offsite.last || now - Date.parse(offsite.last.at) > BACKUP_STALE_MS)
    ) {
      alerts.push({
        code: 'backup_offsite',
        level: 'warning',
        title: offsite.last
          ? `La copia no se sube a la nube desde el ${ownerDateTime(new Date(offsite.last.at))}`
          : 'Todavía no se subió ninguna copia a la nube',
        detail: 'Se sube sola después de la copia de las 04:00. Probala a mano en Más → Copia de seguridad.',
        link: '/mas/backup',
      })
    }
    if (backup.enabled && offsite.enabled && offsite.check?.ok === false) {
      alerts.push({
        code: 'backup_offsite',
        level: 'warning',
        title: `Falló la comprobación de la copia en la nube del ${ownerDate(new Date(offsite.check.at))}`,
        detail: `La copia más nueva del bucket no se pudo bajar o leer: ${(offsite.check.error ?? 'error desconocido').slice(0, 200)}.`,
        link: '/mas/backup',
      })
    }
    if (limitless.enabled && !limitless.running) {
      if (limitless.last?.status === 'failed') {
        alerts.push({
          code: 'limitless_sync',
          level: 'warning',
          title: `Falló la sincronización de Limitless del ${ownerDate(new Date(limitless.last.startedAt))}`,
          detail: `${(limitless.last.error ?? 'error desconocido').slice(0, 200)}. Se vuelve a intentar sola cada 6 horas; el estado está en Torneos → Ajustes.`,
          link: '/torneos/ajustes',
        })
      } else if (!limitless.lastDoneAt || now - Date.parse(limitless.lastDoneAt) > LIMITLESS_STALE_MS) {
        alerts.push({
          code: 'limitless_sync',
          level: 'warning',
          title: limitless.lastDoneAt
            ? `Limitless no se sincroniza desde el ${ownerDateTime(new Date(limitless.lastDoneAt))}`
            : 'Limitless todavía no se sincronizó',
          detail: 'Corre sola cada 6 horas: los torneos nuevos no están entrando. El estado está en Torneos → Ajustes.',
          link: '/torneos/ajustes',
        })
      }
    }
    if (catalog.lastSync?.status === 'failed') {
      alerts.push({
        code: 'catalog_sync',
        level: 'warning',
        title: `Falló la actualización del catálogo del ${ownerDateTime(new Date(catalog.lastSync.fetchedAt))}`,
        detail: `${(catalog.lastSync.error ?? 'error desconocido').slice(0, 200)}. Sigue el catálogo anterior; probala de nuevo en Más → Catálogo.`,
        link: '/mas/catalogo',
      })
    }
    const github = [this.engineUpstream.lastFailure, this.tracker.lastFailure].filter(
      (failure): failure is UpstreamFailure => failure !== null,
    )
    if (github.length > 0) {
      const first = github.sort((a, b) => a.at.localeCompare(b.at))[0] as UpstreamFailure
      alerts.push({
        code: 'github_check',
        level: 'info',
        title: `No se pudo consultar GitHub (${first.message.slice(0, 60)})`,
        detail: `Los avisos de set nuevo y de motor nuevo no se están chequeando; se reintenta cada hora.${this.env.githubToken ? '' : ' Con el secreto GITHUB_TOKEN no hay límite por IP compartida.'}`,
        link: null,
      })
    }
    if (databaseBytes !== null && databaseBytes / (1024 * 1024) >= DATABASE_ALERT_MB) {
      const sizeMb = Math.round(databaseBytes / (1024 * 1024))
      // The title moves in steps of 50 MB, so the phone gets one push per step, not one per new megabyte.
      const step = Math.floor(sizeMb / DATABASE_ALERT_STEP_MB) * DATABASE_ALERT_STEP_MB
      alerts.push({
        code: 'database_size',
        level: 'warning',
        title: `La base pasó los ${step} MB (de ${DATABASE_LIMIT_MB})`,
        detail: `Ocupa ${sizeMb} MB. El plan gratis de Supabase llega hasta 500 MB. Hay que borrar datos viejos (repeticiones, crudos de torneos) o cambiar de plan.`,
        link: '/mas/backup',
      })
    }
    return alerts
  }

  private async limitedSoon(): Promise<{ name: string; until: string; days: number }[]> {
    const today = todayInOwnerZone()
    const packs = await this.prisma.pack.findMany({
      where: { limited: true, available: true, limitedUntil: { not: null } },
      select: { id: true, limitedUntil: true },
    })
    const index = this.catalog.requireIndex()
    const out: { name: string; until: string; days: number }[] = []
    for (const pack of packs) {
      const until = pack.limitedUntil?.toISOString().slice(0, 10)
      if (!until || until < today) continue
      const days = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
      if (days > LIMITED_SOON_DAYS) continue
      out.push({ name: index.packById(pack.id)?.nameEs ?? pack.id, until, days })
    }
    return out
  }
}
