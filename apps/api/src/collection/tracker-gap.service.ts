/**
 * «Tracker al día» (T-020): the tracker's public collection (by friend id) against the game's (ptcgpocket.gg, read now),
 * card by card, and the file that brings the tracker up to date. Read-only: nothing in the app changes. Both sources are
 * read on each request (a few seconds); nothing is cached (512 MB machine).
 */
import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import {
  type DotggUnmatched,
  dotggMissingExpansions,
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
import { TRACKER_PATHS } from '../catalog/catalog-sources.js'
import { TrackerCommitsService } from '../catalog/tracker-commits.service.js'
import { DotggClient, DotggError } from './dotgg-client.js'
import { SourceSnapshots } from './source-snapshot.js'
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
  /** The tracker's carddex flag now, and what the file writes (TRUE with a copy in the game, FALSE without). */
  trackerCollected: boolean
  collected: boolean
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
  /** Cards left out of the comparison (rows the catalog does not have or with another name, unknown internal ids, rows
   * that could not be read). */
  notCompared: number
  /** Nothing was left out, the export had no conflicts and the internal ids are the tracker's: «al día» means it. */
  complete: boolean
  /** The file for the tracker's importer (only the differing cards); null when nothing differs or it is not safe. */
  trackerFile: { fileName: string; rows: number; content: string } | null
  /** Commit of the catalog whose internal ids the file uses. */
  catalogCommit: string | null
}

@Injectable()
export class TrackerGapService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly snapshots: SourceSnapshots,
    private readonly dotgg: DotggClient,
    private readonly tracker: TrackerClient,
    private readonly commits: TrackerCommitsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TrackerGapService.name)
  }

  /** How long a compatibility result is kept (tests set 0). */
  cacheMs = 10 * 60_000
  private compatibilityCache: { commit: string; at: number; result: 'same' | 'changed' } | null = null

  async gap(now = new Date()): Promise<TrackerGapView> {
    // The snapshot this comparison stands on: the friend id, the link and the catalog (its index and commit with it).
    const before = await this.snapshots.take()
    const index = this.catalog.requireIndex()
    const catalogCommit = this.catalog.trackerCommit
    const friendId = before.friendId
    if (!/^\d{16}$/.test(friendId))
      throw new BadRequestException({
        code: 'tracker_friend_id',
        message: 'Guardá tu friend_id de 16 dígitos del tracker en Más → Ajustes de la app.',
      })
    const link = before.link
    if (!link)
      throw new BadRequestException({
        code: 'dotgg_not_configured',
        message: 'Pegá el link de exportación de ptcgpocket.gg en Más → Ajustes de la app: es la colección del juego.',
      })
    // Whether the catalog's internal ids are the tracker's, asked alongside (GitHub may not answer).
    const compatibility = this.cardsCompatibility(catalogCommit)
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
    // A row with another card's name may be another numbering: its count would land on the wrong card.
    const skipped = new Set(
      mapped.renamed.map((row) => index.cardById(row.cardId)?.stockCardId).filter((id): id is string => !!id),
    )
    // An expansion the tracker has cards of and the export not a single row (ptcgpocket.gg may not know it, or write it
    // with another code): its cards are not compared, or the file would put them at 0 and take their registration off.
    const missing = dotggMissingExpansions(index, tracker.units, game.units, { registered: true })
    const uncovered = new Set(missing.map((item) => item.expansionId))
    for (const unit of index.catalog.stockUnits)
      if (uncovered.has(index.cardById(unit.id)?.expansionId ?? '')) skipped.add(unit.id)
    const gap = trackerGap(index, trackerUnits(tracker.units, index), game.units, skipped)
    const warnings: string[] = []
    const leftOut = missing.reduce((sum, item) => sum + item.cards, 0)
    if (missing.length > 0)
      warnings.push(
        `La exportación de ptcgpocket.gg no trae ninguna carta de ${missing.map((item) => item.expansionId).join(', ')} y el tracker tiene ${leftOut === 1 ? '1 carta' : `${leftOut} cartas`} ahí: no se comparan (puede que ptcgpocket.gg no conozca la expansión o la escriba con otro código).`,
      )
    if (mapped.renamed.length > 0)
      warnings.push(
        `ptcgpocket.gg trae ${mapped.renamed.length === 1 ? '1 carta' : `${mapped.renamed.length} cartas`} con el nombre de otra carta del catálogo (puede que numere distinto esa expansión): no se comparan.`,
      )
    // The file writes the catalog's internal ids (and the tracker side is read by them): only when they are the
    // tracker's own. Changed or unknown, the comparison is told as doubtful and no file is offered.
    const ids = await compatibility
    if (ids === 'changed')
      warnings.push(
        `El tracker tiene otros datos de cartas (cards.json) que el catálogo de la app (${(catalogCommit ?? '').slice(0, 7)}): sus internal_id pueden no coincidir y el archivo tocaría otras cartas. Sincronizá el catálogo con el tracker y volvé a comparar; mientras tanto no se arma el archivo.`,
      )
    if (ids === 'unknown')
      warnings.push(
        'No se pudo comprobar en GitHub que los internal_id del catálogo sean los del tracker: no se arma el archivo. Volvé a comparar en un rato.',
      )
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
        `ptcgpocket.gg trae ${mapped.unmatched.length === 1 ? '1 carta' : `${mapped.unmatched.length} cartas`} que el catálogo no tiene: no se comparan y no se arma el archivo, porque puede ser una carta conocida con otro código (sincronizá el catálogo).`,
      )
    const unknownTracker = tracker.unknownIds.map((id) => Number(id.replace('internal_id:', '')))
    if (unknownTracker.length > 0)
      warnings.push(
        `El tracker tiene ${unknownTracker.length === 1 ? '1 carta' : `${unknownTracker.length} cartas`} que el catálogo no conoce: no se comparan.`,
      )
    // A row the catalog does not know may be a known card under another code: its card would go to 0 in the file.
    const safe =
      parsed.errors.length === 0 && game.conflicts.length === 0 && mapped.unmatched.length === 0 && ids === 'same'
    const notCompared =
      mapped.renamed.length + mapped.unmatched.length + unknownTracker.length + parsed.errors.length + leftOut
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
        trackerCollected: row.trackerCollected,
        collected: row.collected,
      }
    })
    // Both reads and GitHub took seconds: if the friend id, the link or the catalog changed meanwhile (another tab, a
    // catalog sync), the pair is not one and the file would mix them. Compared under the configuration lock.
    const changed = await this.snapshots.whileSame(before, ['link', 'friend', 'catalog'])
    if (changed.length > 0 || this.catalog.requireIndex() !== index)
      throw new ConflictException({
        code: 'gap_config_changed',
        message: `Cambió ${this.snapshots.describe(changed.length > 0 ? changed : ['catalog'])} mientras se comparaba: volvé a comparar.`,
      })
    return {
      checkedAt: now.toISOString(),
      summary: gap.summary,
      rows,
      unmatchedGame: mapped.unmatched,
      unknownTracker,
      warnings,
      notCompared,
      complete: notCompared === 0 && game.conflicts.length === 0 && ids === 'same',
      trackerFile:
        safe && gap.rows.length > 0
          ? { fileName: TRACKER_FIX_FILE_NAME, rows: gap.rows.length, content: writeTrackerFixCsv(index, gap.rows) }
          : null,
      catalogCommit,
    }
  }

  /**
   * Whether the catalog's internal ids are the tracker's now: `same` when its `main` is the catalog's commit, or when
   * `frontend/assets/cards.json` (where the internal ids live) did not change between them in either direction (main
   * ahead, behind after a rollback, or diverged); `changed` when it did, or GitHub's list of files may be cut; `unknown`
   * when GitHub does not answer. Kept for `cacheMs` per catalog commit (GitHub allows few calls an hour), `unknown` never.
   */
  private async cardsCompatibility(commit: string | null): Promise<'same' | 'changed' | 'unknown'> {
    if (!commit) return 'unknown'
    const cached = this.compatibilityCache
    if (cached && cached.commit === commit && Date.now() - cached.at < this.cacheMs) return cached.result
    let result: 'same' | 'changed'
    try {
      const latest = await this.commits.latest()
      if (latest.sha === commit) result = 'same'
      else {
        const touched = (diff: { files: string[]; complete: boolean }) =>
          !diff.complete || diff.files.includes(TRACKER_PATHS.cardsJson)
        // commit...latest lists what main has since their common ancestor; latest...commit, what the catalog has.
        const forward = await this.commits.changedFiles(commit, latest.sha)
        let changed = forward.status !== 'identical' && touched(forward)
        if (!changed && (forward.status === 'behind' || forward.status === 'diverged'))
          changed = touched(await this.commits.changedFiles(latest.sha, commit))
        result = changed ? 'changed' : 'same'
      }
    } catch {
      return 'unknown'
    }
    this.compatibilityCache = { commit, at: Date.now(), result }
    return result
  }
}
