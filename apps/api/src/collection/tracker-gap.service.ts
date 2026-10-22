/**
 * «Tracker al día» (T-020): the tracker's public collection (by friend id) against the game's (ptcgpocket.gg, read now),
 * card by card, and the file that brings the tracker up to date. Read-only: nothing in the app changes. Both sources are
 * read on each request (a few seconds); nothing is cached (512 MB machine).
 */
import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import {
  type DotggUnmatched,
  mapDotggRows,
  normalizeImportRows,
  parseDotggCsv,
  redactDotggLink,
  TRACKER_FIX_FILE_NAME,
  type TrackerCollectionRow,
  type TrackerGapSummary,
  trackerGap,
  trackerImportRows,
  trackerUnits,
  writeTrackerFixCsv,
} from '@tcg/domain'
import { PinoLogger } from 'nestjs-pino'
import { CatalogService } from '../catalog/catalog.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { DotggClient, DotggError } from './dotgg-client.js'
import { DotggLinkStore } from './dotgg-link.store.js'
import { TrackerClient, TrackerError } from './tracker-client.js'

export interface TrackerGapRowView {
  stockCardId: string
  cardIds: string[]
  nameEs: string
  expansionId: string
  rarity: string
  tracker: number
  game: number
  /** game − tracker: above 0 the tracker is missing copies. */
  delta: number
}

export interface TrackerGapView {
  checkedAt: string
  summary: TrackerGapSummary
  /** Units that differ, in catalog order. */
  rows: TrackerGapRowView[]
  /** Rows of the game's export the catalog does not have (they cannot be compared). */
  unmatchedGame: DotggUnmatched[]
  /** The tracker's internal ids the catalog does not know (they cannot be compared). */
  unknownTracker: number[]
  /** Why the comparison may be incomplete, in Spanish. */
  warnings: string[]
  /** The file for the tracker's importer (only the differing cards); null when nothing differs or it is not safe. */
  trackerFile: { fileName: string; rows: number; content: string } | null
  /** Commit of the catalog whose internal ids the file uses. */
  catalogCommit: string | null
}

@Injectable()
export class TrackerGapService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly prisma: PrismaService,
    private readonly links: DotggLinkStore,
    private readonly dotgg: DotggClient,
    private readonly tracker: TrackerClient,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TrackerGapService.name)
  }

  async gap(now = new Date()): Promise<TrackerGapView> {
    const friend = await this.prisma.appSetting.findUnique({ where: { key: 'trackerFriendId' } })
    const friendId = typeof friend?.value === 'string' ? friend.value : ''
    if (!/^\d{16}$/.test(friendId))
      throw new BadRequestException({
        code: 'tracker_friend_id',
        message: 'Guardá tu friend_id de 16 dígitos del tracker en Más → Ajustes de la app.',
      })
    const link = await this.links.read()
    if (!link)
      throw new BadRequestException({
        code: 'dotgg_not_configured',
        message: 'Pegá el link de exportación de ptcgpocket.gg en Más → Ajustes de la app: es la colección del juego.',
      })
    let bytes: Buffer
    let remote: TrackerCollectionRow[]
    try {
      ;[bytes, remote] = await Promise.all([this.dotgg.exportCsv(link), this.tracker.collection(friendId)])
    } catch (error) {
      const message = redactDotggLink(
        error instanceof DotggError || error instanceof TrackerError
          ? error.message
          : 'No se pudieron leer las colecciones para comparar.',
        link,
      )
      this.logger.warn(
        { code: error instanceof DotggError || error instanceof TrackerError ? error.code : null, message },
        'tracker gap read failed',
      )
      throw new ServiceUnavailableException({
        code: error instanceof DotggError || error instanceof TrackerError ? error.code : 'gap_failed',
        message,
      })
    }
    const index = this.catalog.requireIndex()
    const parsed = parseDotggCsv(bytes)
    if (parsed.fatal || parsed.rows.length === 0)
      throw new ServiceUnavailableException({
        code: parsed.fatal ? 'dotgg_format' : 'dotgg_empty',
        message: parsed.fatal
          ? (parsed.errors[0]?.message ?? 'La respuesta de ptcgpocket.gg no es la exportación de la colección.')
          : 'ptcgpocket.gg devolvió la colección vacía: revisá el link.',
      })
    const mapped = mapDotggRows(parsed.rows, index)
    const game = normalizeImportRows(mapped.rows, index)
    let trackerRows: ReturnType<typeof trackerImportRows>
    try {
      trackerRows = trackerImportRows(remote, index)
    } catch {
      throw new ServiceUnavailableException({ code: 'tracker_data', message: 'Respuesta inválida del tracker.' })
    }
    const tracker = normalizeImportRows(trackerRows, index)
    const gap = trackerGap(index, trackerUnits(tracker.units, index), game.units)
    const warnings: string[] = []
    if (parsed.errors.length > 0)
      warnings.push(
        `La exportación de ptcgpocket.gg tiene ${parsed.errors.length === 1 ? '1 fila' : `${parsed.errors.length} filas`} con errores: no se arma el archivo para el tracker.`,
      )
    if (game.conflicts.length > 0)
      warnings.push(
        'La exportación de ptcgpocket.gg trae reimpresiones de una misma carta con cantidades distintas: no se arma el archivo para el tracker.',
      )
    if (mapped.unmatched.length > 0)
      warnings.push(
        `ptcgpocket.gg trae ${mapped.unmatched.length === 1 ? '1 carta' : `${mapped.unmatched.length} cartas`} que el catálogo no tiene: no se comparan (sincronizá el catálogo).`,
      )
    const unknownTracker = tracker.unknownIds.map((id) => Number(id.replace('internal_id:', '')))
    if (unknownTracker.length > 0)
      warnings.push(
        `El tracker tiene ${unknownTracker.length === 1 ? '1 carta' : `${unknownTracker.length} cartas`} que el catálogo no conoce: no se comparan.`,
      )
    const safe = parsed.errors.length === 0 && game.conflicts.length === 0
    const rows: TrackerGapRowView[] = gap.rows.map((row) => {
      const card = index.cardById(row.stockCardId)
      return {
        stockCardId: row.stockCardId,
        cardIds: row.cardIds,
        nameEs: card?.nameEs ?? row.stockCardId,
        expansionId: card?.expansionId ?? '',
        rarity: card?.rarity ?? '',
        tracker: row.tracker,
        game: row.game,
        delta: row.delta,
      }
    })
    return {
      checkedAt: now.toISOString(),
      summary: gap.summary,
      rows,
      unmatchedGame: mapped.unmatched,
      unknownTracker,
      warnings,
      trackerFile:
        safe && gap.rows.length > 0
          ? { fileName: TRACKER_FIX_FILE_NAME, rows: gap.rows.length, content: writeTrackerFixCsv(index, gap.rows) }
          : null,
      catalogCommit: this.catalog.trackerCommit,
    }
  }
}
