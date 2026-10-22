/**
 * «Importar desde la hoja» (T-022): the owner's match sheet, exported as CSV or pasted, into matches. The preview
 * writes nothing; applying reads everything again under the locks of the matches and the ranks, checks the result is
 * the preview the owner saw (its fingerprint), and writes the matches, their ranks and the codes' decks in one
 * transaction: all or nothing. The rules (reading, keys, possible repeats, ranks, column K) are in @tcg/domain.
 */
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import {
  type Delimiter,
  duplicateTextEs,
  type MatchMode,
  normalizeSheetCode,
  type ParsedSheet,
  type PlannedSheetRow,
  parseSheet,
  planSheetImport,
  rankLabelEs,
  revisionAt,
  SHEET_DUPLICATE_WINDOW_MS,
  SHEET_IMPORT_MAX_NEW,
  SHEET_KEY_PREFIX,
  type SheetDeck,
  type SheetPlan,
  sheetColumnK,
} from '@tcg/domain'
import { OWNER_TIME_ZONE } from '../config/time-zone.js'
import type { Prisma } from '../generated/prisma/client.js'
import { idToString } from '../http/ids.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { RANK_NOTE_LOCK, RankedService } from '../ranked/ranked.service.js'
import type { SheetImportAppliedView, SheetImportRowView, SheetImportView } from './match-views.js'
import { storedOpponent } from './matches.service.js'

/** `app_settings` key of the codes' decks (`{ M08: '12', … }`), saved by each import and reused by the next. */
export const SHEET_DECK_MAP_KEY = 'sheetDeckMap'

/** Mode of the matches of an import when none is chosen: the sheet is the owner's ranked log. */
export const SHEET_DEFAULT_MODE: MatchMode = 'competitive'

export interface SheetImportInput {
  text: string
  /** The decks chosen for the codes (null: none); the saved ones fill the rest. */
  deckMap?: Record<string, string | null> | undefined
  mode?: MatchMode | undefined
  /** Rows of possible repeats to import anyway. */
  include?: number[] | undefined
}

const COUNT = new Intl.NumberFormat('es-AR')

/** The matches imported from the sheet this far around its dates are loaded, to find a row corrected (same day). */
const SHEET_ORPHAN_WINDOW_MS = 36 * 60 * 60 * 1000

const DELIMITER_NAME: Record<Delimiter, SheetImportView['delimiter']> = {
  ',': 'comma',
  ';': 'semicolon',
  '\t': 'tab',
}

/** The saved mapping as stored, keeping only what has the shape (a code and a deck id). */
function savedMap(value: Prisma.JsonValue | undefined): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([code, deckId]) =>
      typeof deckId === 'string' && /^\d{1,10}$/u.test(deckId) ? [[code, deckId] as const] : [],
    ),
  )
}

/** The chosen mapping with its codes written as the sheet's («m8» is M08). */
function chosenMap(input: SheetImportInput['deckMap']): Record<string, string | null> {
  const chosen: Record<string, string | null> = {}
  for (const [code, deckId] of Object.entries(input ?? {})) {
    const normalized = normalizeSheetCode(code)
    if (normalized) chosen[normalized] = deckId
  }
  return chosen
}

@Injectable()
export class SheetImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ranked: RankedService,
  ) {}

  /** What the import would do, without writing anything. */
  async preview(input: SheetImportInput, now = new Date()): Promise<SheetImportView> {
    const sheet = parseSheet(input.text, { timeZone: OWNER_TIME_ZONE, now })
    const loaded = await this.plan(this.prisma, sheet, input)
    return this.view(sheet, loaded.plan, loaded.decks, input.mode ?? SHEET_DEFAULT_MODE)
  }

  /**
   * Applies the preview whose fingerprint is given: in one transaction, under the ranks' lock and with the matches
   * table closed to other writes (the order the app uses to move, delete or restore a match), the sheet is planned
   * again against the matches and ranks as they are, and written only if it is still that preview.
   */
  async apply(input: SheetImportInput & { fingerprint: string }, now = new Date()): Promise<SheetImportAppliedView> {
    const sheet = parseSheet(input.text, { timeZone: OWNER_TIME_ZONE, now })
    if (sheet.error) throw new BadRequestException({ code: 'validation', message: sheet.error })
    const mode = input.mode ?? SHEET_DEFAULT_MODE
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RANK_NOTE_LOCK}::bigint)`
        // Review: decks before matches, the order of the backup drill's locks (it locks every table with ids, decks
        // before matches, in EXCLUSIVE mode); ROW SHARE only waits for that, never for an edit of a deck.
        await tx.$executeRawUnsafe('LOCK TABLE "decks", "deck_revisions" IN ROW SHARE MODE')
        // No match is created, edited or deleted until this commits: the repeats checked are the ones written against.
        await tx.$executeRawUnsafe('LOCK TABLE "matches" IN SHARE ROW EXCLUSIVE MODE')
        const { plan, saved } = await this.plan(tx, sheet, input)
        if (plan.tooMany) {
          throw new BadRequestException({
            code: 'too_many',
            message: `Son ${COUNT.format(plan.counts.write)} partidas nuevas: el máximo por importación es ${SHEET_IMPORT_MAX_NEW}. Partí la hoja.`,
          })
        }
        if (plan.fingerprint !== input.fingerprint) {
          throw new ConflictException({
            code: 'import_changed',
            message: 'Algo cambió desde la vista previa (una partida, un mazo o un rango): revisala de nuevo.',
          })
        }
        const written = plan.rows.filter((row) => row.write)
        const created = await this.writeMatches(tx, written, mode)
        const notes = written.flatMap((row) =>
          row.rankPlan?.action === 'note' && row.rankPlan.at && row.rank
            ? [{ at: row.rankPlan.at, rank: row.rank, points: null }]
            : [],
        )
        if (notes.length > 0) await tx.rankChange.createMany({ data: notes })
        // The codes' decks are kept for the next import: the ones of this one over the saved ones.
        const map: Record<string, string> = { ...saved }
        for (const code of plan.codes) {
          if (code.deckId) map[code.code] = code.deckId
          else delete map[code.code]
        }
        await tx.appSetting.upsert({
          where: { key: SHEET_DECK_MAP_KEY },
          create: { key: SHEET_DECK_MAP_KEY, value: map },
          update: { value: map },
        })
        const imported = new Map(written.map((row) => [row.row, created.get(row.key as string) as string]))
        return {
          imported: written.map((row) => ({ row: row.row, matchId: imported.get(row.row) as string })),
          ranks: notes.length,
          counts: plan.counts,
          columnK: sheetColumnK(sheet, plan.rows, imported),
        }
      },
      // Up to 500 matches on the database in São Paulo: more than Prisma's 5 s by default.
      { timeout: 60_000, maxWait: 15_000 },
    )
  }

  /** The matches of the rows written, in one insert; their ids by key (each row has its own). */
  private async writeMatches(
    tx: Prisma.TransactionClient,
    rows: readonly PlannedSheetRow[],
    mode: MatchMode,
  ): Promise<Map<string, string>> {
    if (rows.length === 0) return new Map()
    const deckIds = [...new Set(rows.map((row) => Number(row.deckId)))]
    const revisions = await tx.deckRevision.findMany({
      where: { deckId: { in: deckIds } },
      select: { id: true, number: true, createdAt: true, deckId: true },
    })
    const created = await tx.match.createManyAndReturn({
      data: rows.map((row) => {
        const playedAt = row.playedAt as Date
        // The revision that was current when it was played (the first one, for a date before the deck).
        const revision = revisionAt(
          revisions.filter((item) => item.deckId === Number(row.deckId)),
          playedAt,
        )
        return {
          deckId: Number(row.deckId),
          deckRevisionId: revision.id,
          result: row.result as NonNullable<PlannedSheetRow['result']>,
          opponentText: storedOpponent(row.opponent),
          wentFirst: row.wentFirst,
          mode,
          note: row.note,
          playedAt,
          source: 'ui' as const,
          clientRef: row.key,
        }
      }),
      select: { id: true, clientRef: true },
    })
    return new Map(created.map((match) => [match.clientRef as string, idToString(match.id)]))
  }

  /** Loads what the plan needs (through `db`: the transaction's client when applying) and plans the sheet. */
  private async plan(
    db: Prisma.TransactionClient,
    sheet: ParsedSheet,
    input: SheetImportInput,
  ): Promise<{ plan: SheetPlan; decks: SheetDeck[]; saved: Record<string, string> }> {
    const deckRows = await db.deck.findMany({
      select: { id: true, name: true, archivedAt: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    })
    const decks = deckRows.map((deck) => ({
      id: idToString(deck.id),
      name: deck.name,
      archived: deck.archivedAt !== null,
    }))
    const saved = savedMap((await db.appSetting.findUnique({ where: { key: SHEET_DECK_MAP_KEY } }))?.value)
    const seasons = await this.ranked.seasons(db)
    const changes = await this.ranked.changes(db)
    // The app's matches a row may be: those of column K, those with its key, and those around the dates of the sheet.
    const ids = [...new Set(sheet.rows.flatMap((row) => (row.appId ? [Number(row.appId)] : [])))]
    const keys = sheet.rows.flatMap((row) => (row.key ? [row.key] : []))
    const times = sheet.rows.flatMap((row) => (row.playedAt ? [row.playedAt.getTime()] : []))
    // Review: and the matches imported from the sheet a day and a half around its dates, so a row corrected after its
    // import finds the match of its old version (the same day, in the owner's time zone).
    const first = times.length > 0 ? Math.min(...times) : 0
    const last = times.length > 0 ? Math.max(...times) : 0
    const or: Prisma.MatchWhereInput[] = [
      ...(ids.length > 0 ? [{ id: { in: ids } }] : []),
      ...(keys.length > 0 ? [{ clientRef: { in: keys } }] : []),
      ...(times.length > 0
        ? [
            {
              playedAt: {
                gte: new Date(first - SHEET_DUPLICATE_WINDOW_MS),
                lte: new Date(last + SHEET_DUPLICATE_WINDOW_MS),
              },
            },
            {
              clientRef: { startsWith: SHEET_KEY_PREFIX },
              playedAt: { gte: new Date(first - SHEET_ORPHAN_WINDOW_MS), lte: new Date(last + SHEET_ORPHAN_WINDOW_MS) },
            },
          ]
        : []),
    ]
    const existing =
      or.length === 0
        ? []
        : await db.match.findMany({
            where: { OR: or },
            select: { id: true, deckId: true, result: true, playedAt: true, clientRef: true },
          })
    const plan = planSheetImport(sheet, {
      decks,
      saved,
      chosen: chosenMap(input.deckMap),
      existing: existing.map((match) => ({
        id: idToString(match.id),
        deckId: idToString(match.deckId),
        result: match.result,
        playedAt: match.playedAt,
        clientRef: match.clientRef,
      })),
      include: input.include ?? [],
      mode: input.mode ?? SHEET_DEFAULT_MODE,
      seasons,
      changes,
      timeZone: OWNER_TIME_ZONE,
    })
    return { plan, decks, saved }
  }

  private view(sheet: ParsedSheet, plan: SheetPlan, decks: SheetDeck[], mode: MatchMode): SheetImportView {
    const deckById = new Map(decks.map((deck) => [deck.id, deck]))
    const rows: SheetImportRowView[] = plan.rows.map((row) => {
      const deck = row.deckId ? deckById.get(row.deckId) : undefined
      return {
        row: row.row,
        status: row.status,
        code: row.code,
        deckName: row.deckName,
        deck: deck ? { id: deck.id, name: deck.name } : null,
        result: row.result,
        wentFirst: row.wentFirst,
        playedAt: row.playedAt?.toISOString() ?? null,
        dateText: row.dateText,
        opponent: row.opponent,
        note: row.note,
        rank: row.rank
          ? { label: rankLabelEs(row.rank), action: row.rankPlan?.action ?? null, text: row.rankPlan?.text ?? null }
          : null,
        matchId: row.matchId,
        duplicateOf: row.duplicateOf
          ? { id: row.duplicateOf.id, text: duplicateTextEs(row.duplicateOf, OWNER_TIME_ZONE, row.duplicateKind) }
          : null,
        write: row.write,
        errors: row.errors,
        warnings: row.warnings,
      }
    })
    return {
      delimiter: sheet.delimiter ? DELIMITER_NAME[sheet.delimiter] : null,
      headerRow: sheet.headerRow,
      firstRow: sheet.firstRow,
      error: sheet.error,
      mode,
      maxNew: SHEET_IMPORT_MAX_NEW,
      tooMany: plan.tooMany,
      counts: plan.counts,
      codes: plan.codes,
      decks,
      rows,
      columnK: sheetColumnK(sheet, plan.rows),
      fingerprint: plan.fingerprint,
      orphans: plan.orphans.map((match) => ({ id: match.id, text: duplicateTextEs(match, OWNER_TIME_ZONE) })),
    }
  }
}
