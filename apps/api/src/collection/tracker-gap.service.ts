/**
 * «Tracker al día» (T-020): the tracker's public collection (by friend id) against the game's (ptcgpocket.gg, read now),
 * card by card, and the file that brings the tracker up to date. Read-only: nothing in the app changes. Both sources are
 * read on each request (a few seconds); nothing is cached (512 MB machine).
 */
import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import {
  type DotggUnmatched,
  dotggGapCoverage,
  dotggListedExpansions,
  dotggUnplaced,
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
import { REMOTE_KEYS, seenExpansionsOf } from './collection.service.js'
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
  /**
   * Expansions the export has no row of that are compared as 0 anyway (S-E): an applied sync listed them before and the
   * app has no copy there. The file puts the tracker's cards there at 0. `cards`: the tracker's cards there.
   */
  emptyExpansions: { expansionId: string; nameEs: string; cards: number }[]
  /** Cards at 0 in the export that the app still has (S-K): a drop waits in the app, so they are not compared. */
  pendingDrops: number
  /** Cards left out of the comparison (rows the catalog does not have or with another name, the tracker's cards named
   * like them with no copy in the export, unknown internal ids, rows that could not be read). */
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
    // The reads and GitHub took seconds: if the friend id, the link or the catalog changed meanwhile (another tab, a
    // catalog sync), the pair is not one and the file would mix them. Compared under the configuration lock, where the
    // app's side is read too: the expansions it has copies in and those a sync listed (an apply writes both under it).
    const ids = await compatibility
    let heldUnits = new Set<string>()
    let held = new Set<string>()
    let seen = new Set<string>()
    const changed = await this.snapshots.whileSame(before, ['link', 'friend', 'catalog'], async (tx) => {
      const stock = await tx.collectionStock.findMany({ where: { amountOwned: { gt: 0 } }, select: { cardId: true } })
      const mark = await tx.appSetting.findUnique({ where: { key: REMOTE_KEYS.dotgg.seenExpansions } })
      heldUnits = new Set(stock.map((row) => row.cardId))
      held = dotggListedExpansions(index, heldUnits)
      // No mark yet (syncs applied before it existed): the applied imports still stored say what was written.
      seen = mark
        ? seenExpansionsOf(mark.value)
        : dotggListedExpansions(
            index,
            (
              await tx.collectionImportRow.findMany({
                where: { import: { source: 'dotgg', status: 'applied' } },
                select: { cardId: true },
                distinct: ['cardId'],
              })
            ).map((row) => row.cardId),
          )
    })
    if (changed.length > 0 || this.catalog.requireIndex() !== index)
      throw new ConflictException({
        code: 'gap_config_changed',
        message: `Cambió ${this.snapshots.describe(changed.length > 0 ? changed : ['catalog'])} mientras se comparaba: volvé a comparar.`,
      })
    // A row with another card's name may be another numbering: its count would land on the wrong card.
    const skipped = new Set(
      mapped.renamed.map((row) => index.cardById(row.cardId)?.stockCardId).filter((id): id is string => !!id),
    )
    // Rows the catalog cannot place (S-D): one of a set the catalog has no card of yet (SP1) is left out and the file is
    // built without it; one with a number the catalog lacks in a known set, or with no name, stops the file. Either
    // way, a card named like one of them with no copy in the export is not compared: the row may be it under another
    // code, and the file would zero it.
    const unplaced = dotggUnplaced(mapped, index)
    // What the export's silence means (S-B, S-E): the export lists only what is owned, so «no row» is 0 copies only
    // where ptcgpocket.gg knows the set code (it writes it now or an applied sync wrote it) and, for a whole expansion
    // with no row, where the app has 0 too. Elsewhere the cards are not compared, or the file would zero them.
    const coverage = dotggGapCoverage(index, {
      tracker: tracker.units,
      game: game.units,
      listed: dotggListedExpansions(
        index,
        mapped.rows.map((row) => row.id),
      ),
      seen,
      held,
      heldUnits,
      unplacedNames: unplaced.names,
    })
    for (const id of coverage.skipped) skipped.add(id)
    const gap = trackerGap(index, trackerUnits(tracker.units, index), game.units, skipped)
    const warnings: string[] = []
    const leftOut =
      coverage.leftOut.reduce((sum, item) => sum + item.cards, 0) +
      coverage.reprints.cards +
      coverage.pending +
      coverage.sameName.length
    // A card at 0 in the export that the app still has (S-K): a drop waits for Santi in the app.
    if (coverage.pending > 0)
      warnings.push(
        coverage.pending === 1
          ? 'Hay 1 carta en 0 en la exportación de ptcgpocket.gg que la colección de la app todavía tiene: no se compara, porque hay una baja sin aplicar. Aplicá la sincronización con el juego y volvé a comparar.'
          : `Hay ${coverage.pending} cartas en 0 en la exportación de ptcgpocket.gg que la colección de la app todavía tiene: no se comparan, porque hay bajas sin aplicar. Aplicá la sincronización con el juego y volvé a comparar.`,
      )
    for (const reason of ['unseen', 'held'] as const) {
      const group = coverage.leftOut.filter((item) => item.reason === reason)
      if (group.length === 0) continue
      const cards = group.reduce((sum, item) => sum + item.cards, 0)
      const one = cards === 1
      const where = listEs(group.map((item) => item.expansionId))
      warnings.push(
        reason === 'unseen'
          ? `La exportación de ptcgpocket.gg no trae ninguna carta de ${where}, donde el tracker tiene ${one ? '1 carta: no se compara' : `${cards} cartas: no se comparan`} (puede que ptcgpocket.gg no conozca la expansión o la escriba con otro código).`
          : `La exportación de ptcgpocket.gg no trae ${one ? 'la carta' : `ninguna de las ${cards} cartas`} que el tracker tiene en ${where}: no se ${one ? 'compara' : 'comparan'}, porque la colección de la app todavía tiene copias ahí (si ya no las tenés, aplicá la sincronización con el juego y volvé a comparar).`,
      )
    }
    if (coverage.reprints.cards > 0) {
      const one = coverage.reprints.cards === 1
      warnings.push(
        `${one ? '1 carta del tracker que' : `${coverage.reprints.cards} cartas del tracker que`} ptcgpocket.gg no trae ${one ? 'tiene' : 'tienen'} una reimpresión en ${listEs(coverage.reprints.expansionIds)}, que ptcgpocket.gg nunca trajo: no se ${one ? 'compara' : 'comparan'} (la copia puede ser esa reimpresión).`,
      )
    }
    if (mapped.renamed.length > 0)
      warnings.push(
        `ptcgpocket.gg trae ${mapped.renamed.length === 1 ? '1 carta' : `${mapped.renamed.length} cartas`} con el nombre de otra carta del catálogo (puede que numere distinto esa expansión): no se comparan.`,
      )
    // The file writes the catalog's internal ids (and the tracker side is read by them): only when they are the
    // tracker's own. Changed or unknown, the comparison is told as doubtful and no file is offered.
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
    if (unplaced.newSet.length > 0) {
      const rows = unplaced.newSet
      const one = rows.length === 1
      const sets = [...new Set(rows.map((row) => row.set))]
      const which =
        rows.length <= 5
          ? listEs(rows.map((row) => `${row.set}-${row.number} ${row.name}`))
          : `${rows.length} cartas de ${listEs(sets)}`
      warnings.push(
        `ptcgpocket.gg trae ${which}: el catálogo todavía no tiene ${sets.length === 1 ? 'esa expansión' : 'esas expansiones'}, así que no se ${one ? 'compara ni va' : 'comparan ni van'} en el archivo para el tracker. Cuando el tracker ${sets.length === 1 ? 'la cargue' : 'las cargue'}, sincronizá el catálogo y volvé a comparar.`,
      )
    }
    if (unplaced.otherNumber.length > 0) {
      const rows = unplaced.otherNumber
      const one = rows.length === 1
      warnings.push(
        `ptcgpocket.gg trae ${one ? '1 carta' : `${rows.length} cartas`} con un número que el catálogo no tiene en una expansión que sí tiene${cardCodes(rows)}: no se ${one ? 'compara' : 'comparan'} y no se arma el archivo, porque puede ser una carta conocida con otra numeración (sincronizá el catálogo).`,
      )
    }
    if (unplaced.nameless.length > 0) {
      const rows = unplaced.nameless
      const one = rows.length === 1
      warnings.push(
        `ptcgpocket.gg trae ${one ? '1 carta' : `${rows.length} cartas`} sin nombre de una expansión que el catálogo no tiene${cardCodes(rows)}: no se ${one ? 'compara' : 'comparan'} y no se arma el archivo, porque sin el nombre no se sabe si es una carta conocida con otro código (sincronizá el catálogo).`,
      )
    }
    if (coverage.sameName.length > 0) {
      const units = coverage.sameName
      const one = units.length === 1
      const which =
        units.length <= 5
          ? listEs(units.map((id) => `${index.cardById(id)?.nameEs ?? id} (${id})`))
          : `${units.length} cartas`
      warnings.push(
        `${which}: el tracker ${one ? 'la tiene' : 'las tiene'} y ptcgpocket.gg no trae copias, pero trae ${one ? 'otra carta' : 'otras cartas'} con el mismo nombre que no se ${one ? 'pudo' : 'pudieron'} ubicar en el catálogo, así que no se ${one ? 'compara' : 'comparan'} (la copia del juego puede ser esa carta con otro código).`,
      )
    }
    const unknownTracker = tracker.unknownIds.map((id) => Number(id.replace('internal_id:', '')))
    if (unknownTracker.length > 0)
      warnings.push(
        `El tracker tiene ${unknownTracker.length === 1 ? '1 carta' : `${unknownTracker.length} cartas`} que el catálogo no conoce: no se comparan.`,
      )
    // A row with a number the catalog lacks in a known set may be a known card with another numbering, and a row with no
    // name may be any card: its card would go to 0 in the file. A named row of a set the catalog has no card of only
    // hides cards of its name, which are left out above.
    const safe =
      parsed.errors.length === 0 &&
      game.conflicts.length === 0 &&
      unplaced.otherNumber.length === 0 &&
      unplaced.nameless.length === 0 &&
      ids === 'same'
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
    return {
      checkedAt: now.toISOString(),
      summary: gap.summary,
      rows,
      unmatchedGame: mapped.unmatched,
      unknownTracker,
      warnings,
      pendingDrops: coverage.pending,
      emptyExpansions: coverage.empty.map((item) => ({
        expansionId: item.expansionId,
        nameEs: index.expansionById(item.expansionId)?.nameEs ?? item.expansionId,
        cards: item.cards,
      })),
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

/** «A1, A2 y B4b». */
function listEs(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`
}

/** « (A1-300 y A1-301)» for up to five rows, nothing for more. */
function cardCodes(rows: readonly DotggUnmatched[]): string {
  return rows.length <= 5 ? ` (${listEs(rows.map((row) => `${row.set}-${row.number}`))})` : ''
}
