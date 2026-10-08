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

  async exportDocument(): Promise<BackupDocument> {
    const [settings, rarityRules, stock, imports, adjustments, decks, matches, packs, tokens, sets, aliases] =
      await Promise.all([
        this.prisma.appSetting.findMany({ orderBy: { key: 'asc' } }),
        this.prisma.rarityRule.findMany({ orderBy: { rarity: 'asc' } }),
        this.prisma.collectionStock.findMany({ orderBy: { cardId: 'asc' } }),
        this.prisma.collectionImport.findMany({
          orderBy: { id: 'asc' },
          include: { rows: { orderBy: { cardId: 'asc' } } },
          omit: { rawFileGz: true },
        }),
        this.prisma.collectionAdjustment.findMany({ orderBy: { id: 'asc' } }),
        this.prisma.deck.findMany({
          orderBy: { id: 'asc' },
          include: { revisions: { orderBy: { number: 'asc' } }, changes: { orderBy: { id: 'asc' } } },
        }),
        this.prisma.match.findMany({ orderBy: { id: 'asc' } }),
        this.prisma.pack.findMany({
          orderBy: { id: 'asc' },
          select: { id: true, available: true, pointsBalance: true, limited: true, limitedUntil: true },
        }),
        this.prisma.apiToken.findMany({ orderBy: { id: 'asc' } }),
        this.prisma.setRelease.findMany({ orderBy: [{ releaseDate: 'asc' }, { code: 'asc' }] }),
        this.prisma.archetypeAlias.findMany({ orderBy: { archetypeId: 'asc' } }),
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
    await this.prisma.$transaction(
      async (tx) => {
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
        for (const rule of document.rarityRules) {
          await tx.rarityRule.upsert({
            where: { rarity: rule.rarity },
            create: rule,
            update: { points: rule.points, pointsVerified: rule.pointsVerified, tradeable: rule.tradeable },
          })
        }
        for (const table of [
          'collection_imports',
          'collection_adjustments',
          'decks',
          'deck_revisions',
          'deck_changes',
          'matches',
        ]) {
          await tx.$executeRawUnsafe(
            `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1, false)`,
          )
        }
      },
      { timeout: 120_000, maxWait: 10_000 },
    )
    this.tournamentData.bump()
    this.logger.info({ counts: backupCounts(document) }, 'backup restored')
    return { applied: true, counts: backupCounts(document), notices }
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
