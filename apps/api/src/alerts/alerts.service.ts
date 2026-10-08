/**
 * Avisos (BRIEF «más adelante», PLAN Fase 8): what the owner should know without looking for it. A new set in the
 * tracker the pinned catalog does not have, a probable new era, tournament lists with cards the catalog does not
 * know (a set is out), a newer deckgym, a limited pack about to leave the shop. Read-only: nothing changes by itself
 * (the catalog pin and the era table move by hand, PLAN §3.1).
 */
import { Inject, Injectable } from '@nestjs/common'
import { parseExpansionIds } from '@tcg/domain'
import { PinoLogger } from 'nestjs-pino'
import { CatalogService } from '../catalog/catalog.service.js'
import { ENV, type Env } from '../config/env.js'
import { todayInOwnerZone } from '../config/time-zone.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { EngineUpstreamService } from '../simulation/engine-upstream.service.js'
import { EngineStatusService } from '../simulation/snapshots.service.js'
import { TournamentsService } from '../tournaments/tournaments.service.js'

export interface AlertView {
  code: 'new_set' | 'new_era_likely' | 'unknown_cards' | 'engine_update' | 'limited_pack'
  level: 'info' | 'warning'
  title: string
  detail: string
  /** Where to act, inside the app (or an external page). */
  link: string | null
}

const FRESH_MS = 12 * 60 * 60 * 1000
const RETRY_MS = 60 * 60 * 1000
const LIMITED_SOON_DAYS = 7

/** Expansions the tracker's `main` declares that the pinned catalog does not have (checked every 12 hours). */
@Injectable()
export class TrackerUpstreamService {
  private cache: { at: number; ttl: number; ids: string[] | null } | null = null
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
    } catch (error) {
      this.logger.warn({ err: error }, 'tracker upstream check failed')
    }
    this.cache = { at: now, ttl: ids ? FRESH_MS : RETRY_MS, ids }
    return ids
  }
}

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly tracker: TrackerUpstreamService,
    private readonly tournaments: TournamentsService,
    private readonly engine: EngineStatusService,
    private readonly engineUpstream: EngineUpstreamService,
  ) {}

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
          'El tracker ya tiene cartas que el catálogo fijado no conoce. Cuando quieras, actualizá el catálogo (Más → Catálogo) y cargá su fecha en la tabla de eras de Torneos.',
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
