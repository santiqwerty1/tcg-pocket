/**
 * Backup (PLAN §3.9): export of everything the owner produced as gzip JSON, dry-run/replace import,
 * and the daily snapshots kept in `backup_blobs` (last 14). The catalog is not part of the backup (it re-syncs).
 */
import { gunzipSync, gzipSync } from 'node:zlib'
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { CatalogService } from '../catalog/catalog.service.js'
import { ENV, type Env } from '../config/env.js'
import { dateOnly } from '../config/time-zone.js'
import type { Prisma } from '../generated/prisma/client.js'
import { idToString, parseNumericId } from '../http/ids.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { TournamentDataVersion } from '../tournaments/tournament-settings.js'
import {
  BACKUP_SCHEMA_VERSION,
  type BackupCounts,
  type BackupDocument,
  backupCounts,
  backupDocumentSchema,
  READABLE_BACKUP_VERSIONS,
} from './backup-schema.js'

export const BACKUP_BLOBS_KEPT = 14
/** A restore (and the monthly drill) runs in one transaction of at most this long. */
const RESTORE_TIMEOUT_MS = 120_000
/**
 * Upper bound of an uploaded backup once inflated. A real backup is a few MB (one row per stock unit, per import row,
 * per deck revision); without a cap a 50 MB gzip of zeros inflates to ~50 GB and takes the 512 MB machine down.
 */
export const BACKUP_MAX_INFLATED_BYTES = 128 * 1024 * 1024

export interface BackupBlobView {
  id: string
  createdAt: Date
  sizeBytes: number
}

export interface BackupDryRun {
  schemaVersion: number
  exportedAt: string
  appVersion: string
  catalogCommit: string | null
  diff: {
    current: BackupCounts
    incoming: BackupCounts
    /** Spanish notices: catalog mismatch (`needs_review`), unknown cards, tokens not restored… */
    notices: string[]
    needsReview: boolean
    unknownCardIds: string[]
  }
}

/** Fase 35: the result of a restore drill, kept in `app_settings.backupDrill`. */
export interface BackupDrillResult {
  at: string
  ok: boolean
  /** The snapshot made for the drill (also one of the daily copies). */
  blobId: string | null
  sizeBytes: number
  counts: BackupCounts | null
  /** Sections of the document that came back different after restoring it (empty when ok). */
  differences: string[]
  ms: number
  error: string | null
}

/** JSON with object keys sorted: Postgres `jsonb` reorders keys, so the order is not part of the data. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  )
}

/** Where two JSON values first differ («decks[2].updatedAt»), or null when they are equal (key order aside). */
export function firstDifference(a: unknown, b: unknown, path: string): string | null {
  if (canonical(a) === canonical(b)) return null
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path} (${a.length} → ${b.length})`
    for (let i = 0; i < a.length; i++) {
      const inner = firstDifference(a[i], b[i], `${path}[${i}]`)
      if (inner) return inner
    }
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const inner = firstDifference(left[key], right[key], `${path}.${key}`)
      if (inner) return inner
    }
  }
  return path
}

/** Tables a restore refills with their own ids; their sequences are set after it (and put back after a drill). */
const SERIAL_TABLES = [
  'collection_imports',
  'collection_adjustments',
  'decks',
  'deck_revisions',
  'deck_changes',
  'matches',
  'live_games',
  'events',
] as const

/** Thrown inside the drill's transaction so nothing it restored stays. */
class DrillRollback extends Error {}

export interface BackupReplaceResult {
  applied: true
  counts: BackupCounts
  notices: string[]
}

const GZIP_MAGIC = [0x1f, 0x8b] as const

/** Prisma 7 types Bytes as Uint8Array<ArrayBuffer>: copy the Buffer into a fresh, non-shared ArrayBuffer. */
export function toBytes(buffer: Buffer): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(buffer.byteLength))
  copy.set(buffer)
  return copy
}

function iso(date: Date): string {
  return date.toISOString()
}

function isoOrNull(date: Date | null): string | null {
  return date ? date.toISOString() : null
}

function jsonOrNull(value: unknown): unknown {
  return value === undefined ? null : value
}

/** Lets the JSON `null` of the document reach a nullable Json column (Prisma distinguishes DbNull from undefined). */
function nullableJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === null || value === undefined ? undefined : (value as Prisma.InputJsonValue)
}

/** Matches whose deck or revision is not in the document, so they could not be restored. */
export function danglingMatches(document: BackupDocument): { id: number; deckId: number; deckRevisionId: number }[] {
  const revisionsByDeck = new Map(
    document.decks.map((deck) => [deck.id, new Set(deck.revisions.map((revision) => revision.id))]),
  )
  return document.matches
    .filter((match) => !revisionsByDeck.get(match.deckId)?.has(match.deckRevisionId))
    .map((match) => ({ id: match.id, deckId: match.deckId, deckRevisionId: match.deckRevisionId }))
}

@Injectable()
export class BackupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly tournamentData: TournamentDataVersion,
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(BackupService.name)
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------------------------------------------

  /** Everything the owner produced; `db` lets the restore drill (Fase 35) read inside its transaction. */
  async exportDocument(db: Prisma.TransactionClient = this.prisma): Promise<BackupDocument> {
    const [
      settings,
      rarityRules,
      stock,
      imports,
      adjustments,
      decks,
      matches,
      packs,
      tokens,
      sets,
      aliases,
      games,
      notes,
      events,
    ] = await Promise.all([
      db.appSetting.findMany({ orderBy: { key: 'asc' } }),
      db.rarityRule.findMany({ orderBy: { rarity: 'asc' } }),
      db.collectionStock.findMany({ orderBy: { cardId: 'asc' } }),
      db.collectionImport.findMany({
        orderBy: { id: 'asc' },
        include: { rows: { orderBy: { cardId: 'asc' } } },
        omit: { rawFileGz: true },
      }),
      db.collectionAdjustment.findMany({ orderBy: { id: 'asc' } }),
      db.deck.findMany({
        orderBy: { id: 'asc' },
        include: { revisions: { orderBy: { number: 'asc' } }, changes: { orderBy: { id: 'asc' } } },
      }),
      db.match.findMany({ orderBy: { id: 'asc' } }),
      db.pack.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, available: true, pointsBalance: true, limited: true, limitedUntil: true },
      }),
      db.apiToken.findMany({ orderBy: { id: 'asc' } }),
      db.setRelease.findMany({ orderBy: [{ releaseDate: 'asc' }, { code: 'asc' }] }),
      db.archetypeAlias.findMany({ orderBy: { archetypeId: 'asc' } }),
      db.liveGame.findMany({ where: { status: 'done', winner: { not: null } }, orderBy: { id: 'asc' } }),
      db.rivalNote.findMany({ orderBy: { key: 'asc' } }),
      db.event.findMany({ orderBy: { id: 'asc' } }),
    ])
    return {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: iso(new Date()),
      appVersion: this.env.version,
      catalogCommit: this.catalog.trackerCommit,
      engineRev: this.catalog.engineRev,
      settings: settings.map((row) => ({ key: row.key, value: row.value, updatedAt: iso(row.updatedAt) })),
      rarityRules: rarityRules.map((row) => ({
        rarity: row.rarity,
        points: row.points,
        pointsVerified: row.pointsVerified,
        tradeable: row.tradeable,
      })),
      collection: {
        stock: stock.map((row) => ({
          cardId: row.cardId,
          amountOwned: row.amountOwned,
          collected: row.collected,
          source: row.source,
          importId: row.importId,
          updatedAt: iso(row.updatedAt),
        })),
        imports: imports.map((row) => ({
          id: row.id,
          fileName: row.fileName,
          sha256: row.sha256,
          importedAt: iso(row.importedAt),
          appliedAt: isoOrNull(row.appliedAt),
          status: row.status,
          rowCount: row.rowCount,
          naiveTotal: row.naiveTotal,
          dedupTotal: row.dedupTotal,
          unknownIds: row.unknownIds,
          diffSummary: jsonOrNull(row.diffSummary),
          rows: row.rows.map((item) => ({
            cardId: item.cardId,
            internalId: item.internalId,
            numberOwned: item.numberOwned,
            collected: item.collected,
          })),
        })),
        adjustments: adjustments.map((row) => ({
          id: row.id,
          functionalGroupId: row.functionalGroupId,
          playableCopies: row.playableCopies,
          reason: row.reason,
          active: row.active,
          createdAt: iso(row.createdAt),
          resolvedAt: isoOrNull(row.resolvedAt),
          resolution: row.resolution,
        })),
      },
      decks: decks.map((deck) => ({
        id: deck.id,
        name: deck.name,
        energies: deck.energies,
        tags: deck.tags,
        notes: deck.notes,
        builtInGame: deck.builtInGame,
        builtInGameSince: isoOrNull(deck.builtInGameSince),
        variantOfId: deck.variantOfId,
        packPriority: deck.packPriority,
        tournamentArchetypeId: deck.tournamentArchetypeId,
        keyCards: deck.keyCards,
        archivedAt: isoOrNull(deck.archivedAt),
        currentRevisionId: deck.currentRevisionId,
        createdAt: iso(deck.createdAt),
        updatedAt: iso(deck.updatedAt),
        revisions: deck.revisions.map((revision) => ({
          id: revision.id,
          number: revision.number,
          cards: revision.cards as { cardId: string; count: number }[],
          energies: revision.energies,
          note: revision.note,
          source: revision.source,
          createdAt: iso(revision.createdAt),
        })),
        changes: deck.changes.map((change) => ({
          id: change.id,
          field: change.field,
          old: jsonOrNull(change.old),
          new: jsonOrNull(change.new),
          at: iso(change.at),
          source: change.source,
        })),
      })),
      tournaments: {
        sets: sets.map((set) => ({
          code: set.code,
          nameEn: set.nameEn,
          releaseDate: dateOnly(set.releaseDate) as string,
          opensEra: set.opensEra,
        })),
        archetypeAliases: aliases.map((alias) => ({ archetypeId: alias.archetypeId, canonicalId: alias.canonicalId })),
      },
      packs: packs.map((pack) => ({
        id: pack.id,
        available: pack.available,
        pointsBalance: pack.pointsBalance,
        limited: pack.limited,
        limitedUntil: dateOnly(pack.limitedUntil),
      })),
      matches: matches.map((match) => ({
        id: match.id,
        deckId: match.deckId,
        deckRevisionId: match.deckRevisionId,
        result: match.result,
        opponentText: match.opponentText,
        wentFirst: match.wentFirst,
        mode: match.mode,
        note: match.note,
        playedAt: iso(match.playedAt),
        source: match.source,
        createdAt: iso(match.createdAt),
        updatedAt: iso(match.updatedAt),
      })),
      tokens: tokens.map((token) => ({
        id: token.id,
        name: token.name,
        kind: token.kind,
        scopes: token.scopes,
        prefix: token.prefix,
        createdAt: iso(token.createdAt),
        lastUsedAt: isoOrNull(token.lastUsedAt),
        expiresAt: isoOrNull(token.expiresAt),
        revokedAt: isoOrNull(token.revokedAt),
      })),
      playedGames: games.map((game) => ({
        id: game.id,
        humanLabel: game.humanLabel,
        rivalLabel: game.rivalLabel,
        bot: game.bot,
        seed: game.seed.toString(),
        engineRev: game.engineRev,
        winner: game.winner as 'you' | 'bot' | 'tie',
        turns: game.turns,
        createdAt: iso(game.createdAt),
        finishedAt: isoOrNull(game.finishedAt),
      })),
      rivalNotes: notes.map((note) => ({
        key: note.key,
        label: note.label,
        archetypeId: note.archetypeId,
        text: note.text,
        createdAt: iso(note.createdAt),
        updatedAt: iso(note.updatedAt),
      })),
      events: events.map((event) => ({
        id: event.id,
        name: event.name,
        startsOn: event.startsOn ? event.startsOn.toISOString().slice(0, 10) : null,
        endsOn: event.endsOn ? event.endsOn.toISOString().slice(0, 10) : null,
        rules: event.rules as Record<string, unknown>,
        notes: event.notes,
        createdAt: iso(event.createdAt),
        updatedAt: iso(event.updatedAt),
      })),
    } as BackupDocument
  }

  async exportGzip(): Promise<Buffer> {
    const document = await this.exportDocument()
    return gzipSync(Buffer.from(JSON.stringify(document), 'utf8'))
  }

  /** `tcgpocket-backup-AAAAMMDD.json.gz` */
  static fileName(date = new Date()): string {
    return `tcgpocket-backup-${date.toISOString().slice(0, 10).replace(/-/g, '')}.json.gz`
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------------------------------------------

  /** Decodes an uploaded file (gzip or plain JSON) and validates it against the schema; 400 on any problem. */
  parseUpload(bytes: Buffer): BackupDocument {
    let text: string
    try {
      const isGzip = bytes.length > 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1]
      text = (isGzip ? gunzipSync(bytes, { maxOutputLength: BACKUP_MAX_INFLATED_BYTES }) : bytes).toString('utf8')
    } catch (error) {
      const tooLarge = (error as { code?: unknown } | null)?.code === 'ERR_BUFFER_TOO_LARGE'
      throw new BadRequestException({
        code: 'invalid_backup',
        message: tooLarge
          ? `El archivo descomprimido supera los ${BACKUP_MAX_INFLATED_BYTES / (1024 * 1024)} MB; no parece un backup de esta app.`
          : 'No se pudo descomprimir el archivo.',
      })
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new BadRequestException({ code: 'invalid_backup', message: 'El archivo no contiene JSON válido.' })
    }
    const version = (raw as { schemaVersion?: unknown } | null)?.schemaVersion
    if (typeof version !== 'number' || !READABLE_BACKUP_VERSIONS.includes(version)) {
      throw new BadRequestException({
        code: 'unsupported_schema',
        message: `El backup tiene schemaVersion ${String(version)}; esta versión de la app lee ${READABLE_BACKUP_VERSIONS.join(' y ')}.`,
      })
    }
    const parsed = backupDocumentSchema.safeParse(raw)
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'invalid_backup',
        message: 'El backup no tiene la forma esperada.',
        details: parsed.error.issues
          .slice(0, 20)
          .map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      })
    }
    const dangling = danglingMatches(parsed.data)
    if (dangling.length > 0) {
      throw new BadRequestException({
        code: 'invalid_backup',
        message: `${dangling.length} partidas del backup apuntan a un mazo o una revisión que no están en el archivo.`,
        details: dangling.slice(0, 20),
      })
    }
    return parsed.data
  }

  async dryRun(document: BackupDocument): Promise<BackupDryRun> {
    const current = backupCounts(await this.exportDocument())
    const { notices, needsReview, unknownCardIds } = this.inspect(document)
    return {
      schemaVersion: document.schemaVersion,
      exportedAt: document.exportedAt,
      appVersion: document.appVersion,
      catalogCommit: document.catalogCommit,
      diff: { current, incoming: backupCounts(document), notices, needsReview, unknownCardIds },
    }
  }

  /** Replaces every owner table with the document's content in one transaction (ids and timestamps preserved). */
  async replace(document: BackupDocument): Promise<BackupReplaceResult> {
    const { notices, unknownCardIds } = this.inspect(document)
    if (unknownCardIds.length > 0) {
      throw new BadRequestException({
        code: 'unknown_card',
        message: `El backup referencia cartas que no están en el catálogo cargado: ${unknownCardIds.slice(0, 10).join(', ')}${unknownCardIds.length > 10 ? '…' : ''}.`,
        details: unknownCardIds,
      })
    }
    await this.prisma.$transaction((tx) => this.restoreInto(tx, document), {
      timeout: RESTORE_TIMEOUT_MS,
      maxWait: 10_000,
    })
    this.tournamentData.bump()
    this.logger.info({ counts: backupCounts(document) }, 'backup restored')
    return { applied: true, counts: backupCounts(document), notices }
  }

  /**
   * Prueba del backup (Fase 35): a fresh snapshot is stored, read back from `backup_blobs`, parsed like an upload and
   * restored inside a transaction; the export read inside that same transaction must equal the file (except
   * `exportedAt`), and then the transaction is rolled back — nothing changes. The tables are locked for the few
   * seconds it takes (it runs at 04:30 on the 1st of each month).
   */
  async drill(): Promise<BackupDrillResult> {
    const started = Date.now()
    const result: BackupDrillResult = {
      at: new Date().toISOString(),
      ok: false,
      blobId: null,
      sizeBytes: 0,
      counts: null,
      differences: [],
      ms: 0,
      error: null,
    }
    try {
      const snapshot = await this.snapshot()
      result.blobId = snapshot.id
      result.sizeBytes = snapshot.sizeBytes
      const document = this.parseUpload((await this.blob(snapshot.id)).dataGz)
      result.counts = backupCounts(document)
      const { unknownCardIds } = this.inspect(document)
      if (unknownCardIds.length > 0) throw new Error(`${unknownCardIds.length} cartas que el catálogo no conoce`)
      let restored: BackupDocument | null = null
      // `setval` is not undone with the transaction: the drill puts the sequences back where they were.
      const sequences = await this.sequenceValues()
      try {
        await this.prisma.$transaction(
          async (tx) => {
            await this.restoreInto(tx, document)
            restored = await this.exportDocument(tx)
            throw new DrillRollback()
          },
          { timeout: RESTORE_TIMEOUT_MS, maxWait: 10_000 },
        )
      } catch (error) {
        if (!(error instanceof DrillRollback)) throw error
      } finally {
        await this.restoreSequences(sequences)
      }
      if (!restored) throw new Error('la restauración no devolvió nada')
      const back = JSON.parse(JSON.stringify(restored)) as Record<string, unknown>
      const original = JSON.parse(JSON.stringify(document)) as Record<string, unknown>
      result.differences = Object.keys({ ...original, ...back }).flatMap((key) => {
        if (key === 'exportedAt') return []
        const where = firstDifference(original[key], back[key], key)
        return where === null ? [] : [where]
      })
      result.ok = result.differences.length === 0
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error)
    }
    result.ms = Date.now() - started
    await this.prisma.appSetting.upsert({
      where: { key: 'backupDrill' },
      create: { key: 'backupDrill', value: result as unknown as Prisma.InputJsonValue },
      update: { value: result as unknown as Prisma.InputJsonValue },
    })
    this.logger[result.ok ? 'info' : 'error']({ drill: result }, 'backup drill')
    return result
  }

  /** Where each sequence of the restored tables stands (the last id handed out, or 0). */
  private async sequenceValues(): Promise<Map<string, number>> {
    const values = new Map<string, number>()
    for (const table of SERIAL_TABLES) {
      const rows = await this.prisma.$queryRawUnsafe<{ value: bigint | number | null }[]>(
        `SELECT pg_sequence_last_value(pg_get_serial_sequence('"${table}"', 'id')::regclass) AS value`,
      )
      values.set(table, Number(rows[0]?.value ?? 0))
    }
    return values
  }

  /** Each sequence past what it had handed out before the drill and past every id: it never moves back. */
  private async restoreSequences(values: Map<string, number>): Promise<void> {
    for (const [table, value] of values) {
      await this.prisma.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), GREATEST(${Math.trunc(value)}, (SELECT COALESCE(MAX(id), 0) FROM "${table}"), 1), true)`,
      )
    }
  }

  async lastDrill(): Promise<BackupDrillResult | null> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: 'backupDrill' } })
    return (row?.value as unknown as BackupDrillResult | undefined) ?? null
  }

  /** Replaces every owner table with the document's content, inside the caller's transaction. */
  private async restoreInto(tx: Prisma.TransactionClient, document: BackupDocument): Promise<void> {
    // Matches first: they restrict the deletion of their deck and revision.
    await tx.match.deleteMany()
    await tx.deck.deleteMany()
    await tx.collectionAdjustment.deleteMany()
    await tx.collectionStock.deleteMany()
    await tx.collectionImport.deleteMany()
    await tx.appSetting.deleteMany()

    for (const item of document.collection.imports) {
      await tx.collectionImport.create({
        data: {
          id: item.id,
          fileName: item.fileName,
          sha256: item.sha256,
          importedAt: item.importedAt,
          appliedAt: item.appliedAt,
          status: item.status,
          rowCount: item.rowCount,
          naiveTotal: item.naiveTotal,
          dedupTotal: item.dedupTotal,
          unknownIds: item.unknownIds,
          diffSummary: nullableJson(item.diffSummary),
          rawFileGz: Buffer.alloc(0),
          rows: { createMany: { data: item.rows, skipDuplicates: true } },
        },
      })
    }
    if (document.collection.stock.length > 0) {
      await tx.collectionStock.createMany({ data: document.collection.stock })
    }
    if (document.collection.adjustments.length > 0) {
      await tx.collectionAdjustment.createMany({ data: document.collection.adjustments })
    }
    if (document.decks.length > 0) {
      await tx.deck.createMany({
        data: document.decks.map((deck) => ({
          id: deck.id,
          name: deck.name,
          energies: deck.energies,
          tags: deck.tags,
          notes: deck.notes,
          builtInGame: deck.builtInGame,
          builtInGameSince: deck.builtInGameSince,
          packPriority: deck.packPriority,
          tournamentArchetypeId: deck.tournamentArchetypeId,
          keyCards: deck.keyCards as Prisma.InputJsonValue,
          archivedAt: deck.archivedAt,
          currentRevisionId: deck.currentRevisionId,
          createdAt: deck.createdAt,
          updatedAt: deck.updatedAt,
        })),
      })
      await tx.deckRevision.createMany({
        data: document.decks.flatMap((deck) =>
          deck.revisions.map((revision) => ({
            id: revision.id,
            deckId: deck.id,
            number: revision.number,
            cards: revision.cards as Prisma.InputJsonValue,
            energies: revision.energies,
            note: revision.note,
            source: revision.source,
            createdAt: revision.createdAt,
          })),
        ),
      })
      await tx.deckChange.createMany({
        data: document.decks.flatMap((deck) =>
          deck.changes.map((change) => ({
            id: change.id,
            deckId: deck.id,
            field: change.field,
            old: nullableJson(change.old),
            new: nullableJson(change.new),
            at: change.at,
            source: change.source,
          })),
        ),
      })
      for (const deck of document.decks) {
        if (deck.variantOfId !== null) {
          await tx.deck.update({
            where: { id: deck.id },
            data: { variantOfId: deck.variantOfId, updatedAt: deck.updatedAt },
          })
        }
        const current =
          deck.revisions.find((revision) => revision.id === deck.currentRevisionId) ??
          deck.revisions[deck.revisions.length - 1]
        if (current && current.cards.length > 0) {
          await tx.deckCard.createMany({
            data: current.cards.map((entry, position) => ({
              deckId: deck.id,
              cardId: entry.cardId,
              count: entry.count,
              position,
            })),
            skipDuplicates: true,
          })
        }
      }
    }
    // Pack switches only touch packs the catalog has; a backup without them keeps the current ones.
    for (const pack of document.packs) {
      await tx.pack.updateMany({
        where: { id: pack.id },
        data: {
          available: pack.available,
          pointsBalance: pack.pointsBalance,
          ...(pack.limited === undefined ? {} : { limited: pack.limited }),
          ...(pack.limitedUntil === undefined
            ? {}
            : { limitedUntil: pack.limitedUntil === null ? null : new Date(`${pack.limitedUntil}T00:00:00Z`) }),
        },
      })
    }
    if (document.matches.length > 0) {
      await tx.match.createMany({ data: document.matches })
    }
    // Era table and archetype merges are replaced only when the file carries them (version 4).
    if (document.tournaments) {
      await tx.setRelease.deleteMany()
      if (document.tournaments.sets.length > 0) {
        await tx.setRelease.createMany({
          data: document.tournaments.sets.map((set) => ({
            code: set.code,
            nameEn: set.nameEn,
            releaseDate: new Date(`${set.releaseDate}T00:00:00Z`),
            opensEra: set.opensEra,
          })),
        })
      }
      await tx.archetypeAlias.deleteMany()
      if (document.tournaments.archetypeAliases.length > 0) {
        await tx.archetypeAlias.createMany({ data: document.tournaments.archetypeAliases })
      }
    }
    if (document.settings.length > 0) {
      await tx.appSetting.createMany({
        data: document.settings.map((setting) => ({
          key: setting.key,
          value: setting.value as Prisma.InputJsonValue,
          updatedAt: setting.updatedAt,
        })),
      })
    }
    // Games against the bot (version 5): the finished ones are replaced by the file's results (no moves, no
    // snapshots); games still being played keep going. Older files keep the current ones.
    if (document.playedGames) {
      await tx.liveGame.deleteMany({ where: { status: { in: ['done', 'abandoned', 'failed'] } } })
      if (document.playedGames.length > 0) {
        await tx.liveGame.createMany({
          skipDuplicates: true,
          data: document.playedGames.map((game) => ({
            id: game.id,
            status: 'done' as const,
            humanSnapshotId: 0,
            botSnapshotId: 0,
            humanLabel: game.humanLabel,
            rivalLabel: game.rivalLabel,
            bot: game.bot,
            seed: BigInt(game.seed),
            engineRev: game.engineRev,
            choices: [],
            winner: game.winner,
            turns: game.turns,
            createdAt: game.createdAt,
            finishedAt: game.finishedAt,
          })),
        })
      }
    }
    // Events (version 7): replaced by the file's; older files keep the current ones.
    if (document.events) {
      await tx.event.deleteMany()
      if (document.events.length > 0) {
        await tx.event.createMany({
          data: document.events.map((event) => ({
            id: event.id,
            name: event.name,
            startsOn: event.startsOn ? new Date(`${event.startsOn}T00:00:00Z`) : null,
            endsOn: event.endsOn ? new Date(`${event.endsOn}T00:00:00Z`) : null,
            rules: event.rules as Prisma.InputJsonValue,
            notes: event.notes,
            createdAt: event.createdAt,
            updatedAt: event.updatedAt,
          })),
        })
      }
    }
    // Notes by rival (version 6): replaced by the file's; older files keep the current ones.
    if (document.rivalNotes) {
      await tx.rivalNote.deleteMany()
      if (document.rivalNotes.length > 0) await tx.rivalNote.createMany({ data: document.rivalNotes })
    }
    for (const rule of document.rarityRules) {
      await tx.rarityRule.upsert({
        where: { rarity: rule.rarity },
        create: rule,
        update: { points: rule.points, pointsVerified: rule.pointsVerified, tradeable: rule.tradeable },
      })
    }
    for (const table of SERIAL_TABLES) {
      await tx.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1, false)`,
      )
    }
  }

  /** Catalog consistency of a document: notices for the UI, unknown ids that block a replace. */
  private inspect(document: BackupDocument): { notices: string[]; needsReview: boolean; unknownCardIds: string[] } {
    const index = this.catalog.requireIndex()
    const notices: string[] = []
    const unknown = new Set<string>()
    for (const row of document.collection.stock) if (!index.stockById(row.cardId)) unknown.add(row.cardId)
    for (const row of document.collection.adjustments) {
      if (!index.groupById(row.functionalGroupId)) unknown.add(row.functionalGroupId)
    }
    for (const deck of document.decks) {
      for (const revision of deck.revisions) {
        for (const entry of revision.cards) if (!index.cardById(entry.cardId)) unknown.add(entry.cardId)
      }
    }
    const needsReview = document.catalogCommit !== null && document.catalogCommit !== this.catalog.trackerCommit
    if (needsReview) {
      notices.push(
        `El backup se hizo con el catálogo ${document.catalogCommit?.slice(0, 7)} y la base tiene ${this.catalog.trackerCommit?.slice(0, 7) ?? 'ninguno'}: revisá colección y mazos después de restaurar (needs_review).`,
      )
    }
    if (unknown.size > 0) {
      notices.push(
        `${unknown.size} ids del backup no existen en el catálogo cargado; no se puede restaurar hasta sincronizarlo.`,
      )
    }
    if (document.schemaVersion < 7) {
      notices.push(
        `Backup de la versión ${document.schemaVersion}, anterior a la Fase 16: no trae eventos; se mantienen los que hay ahora.`,
      )
    }
    if (document.schemaVersion < 6) {
      notices.push(
        `Backup de la versión ${document.schemaVersion}, anterior a la Fase 12: no trae notas por rival; se mantienen las que hay ahora.`,
      )
    }
    if (document.schemaVersion < 5) {
      notices.push(
        `Backup de la versión ${document.schemaVersion}, anterior a la Fase 8: no trae las partidas contra el bot; se mantienen las que hay ahora.`,
      )
    }
    if (document.schemaVersion < 4) {
      notices.push(
        `Backup de la versión ${document.schemaVersion}, anterior a la Fase 5: no trae la tabla de eras ni los arquetipos fusionados; se mantiene lo que hay ahora.`,
      )
    }
    if (document.schemaVersion < 3) {
      notices.push(
        `Backup de la versión ${document.schemaVersion}, anterior a la Fase 4: no trae qué sobres están disponibles; se mantiene lo que hay ahora.`,
      )
    }
    if (document.schemaVersion < 2) {
      notices.push(
        `Backup de la versión ${document.schemaVersion}, anterior al registro de partidas: no trae partidas, así que restaurarlo borra las que hay ahora.`,
      )
    }
    if (document.tokens.length > 0) {
      notices.push(`Los ${document.tokens.length} tokens del backup son solo metadatos: hay que crearlos de nuevo.`)
    }
    return { notices, needsReview, unknownCardIds: [...unknown] }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Blobs (daily snapshots)
  // ---------------------------------------------------------------------------------------------------------------

  /** Stores today's export as a blob and keeps the newest `BACKUP_BLOBS_KEPT`. */
  async snapshot(): Promise<BackupBlobView> {
    const gz = await this.exportGzip()
    const created = await this.prisma.backupBlob.create({
      data: { sizeBytes: gz.length, dataGz: toBytes(gz) },
    })
    const stale = await this.prisma.backupBlob.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: BACKUP_BLOBS_KEPT,
      select: { id: true },
    })
    if (stale.length > 0) await this.prisma.backupBlob.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } })
    this.logger.info({ id: created.id, bytes: gz.length, deleted: stale.length }, 'backup snapshot stored')
    return { id: idToString(created.id), createdAt: created.createdAt, sizeBytes: created.sizeBytes }
  }

  async listBlobs(): Promise<BackupBlobView[]> {
    const rows = await this.prisma.backupBlob.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, createdAt: true, sizeBytes: true },
    })
    return rows.map((row) => ({ id: idToString(row.id), createdAt: row.createdAt, sizeBytes: row.sizeBytes }))
  }

  async blob(rawId: string): Promise<{ view: BackupBlobView; dataGz: Buffer }> {
    const id = parseNumericId(rawId, 'Copia')
    const row = await this.prisma.backupBlob.findUnique({ where: { id } })
    if (!row) throw new NotFoundException(`Copia ${rawId} no encontrada.`)
    return {
      view: { id: idToString(row.id), createdAt: row.createdAt, sizeBytes: row.sizeBytes },
      dataGz: Buffer.from(row.dataGz),
    }
  }
}
