/**
 * The backup document (PLAN §3.9): everything the owner produced, versioned by `schemaVersion`. Version 2 (Fase 2)
 * adds `matches`; a version 1 file still reads, with no matches. Version 3 (Fase 4) adds the pack switches; version 4
 * (Fase 5) the era table, the archetype merges and each deck's tournament archetype; version 5 (Fase 8) the results of
 * the games against the bot (D-019: the result only, not the moves); version 6 (Fase 12) the notes by rival; version 7
 * (Fase 16) the events; version 8 (T-020) collection imports and stock with tracker origin; version 9 (14/10) the
 * rival's cards seen in each match. Tournament data is not in the
 * backup: it is Limitless's and the sync downloads it again (DECISIONES 5.7).
 * Dates are ISO strings; numeric ids keep their database values so a `replace` restores them verbatim.
 * Excluded on purpose: password hash, TOTP secret, token hashes (tokens travel as metadata only), raw CSV files.
 */
import { z } from 'zod'

export const BACKUP_SCHEMA_VERSION = 9
/** Versions this app reads. Exports always write BACKUP_SCHEMA_VERSION. */
export const READABLE_BACKUP_VERSIONS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9]

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'fecha ISO 8601 inválida')
const nullableDate = isoDate.nullable()
const json = z.json()

const settingSchema = z.object({ key: z.string(), value: json, updatedAt: isoDate })
const rarityRuleSchema = z.object({
  rarity: z.string(),
  points: z.number().int().nullable(),
  pointsVerified: z.boolean(),
  tradeable: z.boolean(),
})
const stockSchema = z.object({
  cardId: z.string(),
  amountOwned: z.number().int().min(0),
  collected: z.boolean(),
  source: z.enum(['import', 'manual', 'tracker']),
  importId: z.number().int().nullable(),
  updatedAt: isoDate,
})
const importRowSchema = z.object({
  cardId: z.string(),
  internalId: z.number().int(),
  numberOwned: z.number().int(),
  collected: z.boolean(),
})
const importSchema = z.object({
  source: z.enum(['csv', 'tracker']).default('csv'),
  id: z.number().int(),
  fileName: z.string(),
  sha256: z.string(),
  importedAt: isoDate,
  appliedAt: nullableDate,
  status: z.enum(['pending', 'applied', 'discarded']),
  rowCount: z.number().int(),
  naiveTotal: z.number().int(),
  dedupTotal: z.number().int(),
  unknownIds: z.array(z.string()),
  diffSummary: json.nullable(),
  rows: z.array(importRowSchema),
})
const adjustmentSchema = z.object({
  id: z.number().int(),
  functionalGroupId: z.string(),
  playableCopies: z.number().int().min(0),
  reason: z.string(),
  active: z.boolean(),
  createdAt: isoDate,
  resolvedAt: nullableDate,
  resolution: z.enum(['user', 'csv_matches', 'manual_edit', 'converted', 'catalog_change']).nullable(),
})
const deckSource = z.enum(['ui', 'import', 'mcp', 'duplicate', 'restore'])
const revisionSchema = z.object({
  id: z.number().int(),
  number: z.number().int(),
  cards: z.array(z.object({ cardId: z.string(), count: z.number().int().min(1) })),
  energies: z.array(z.string()),
  note: z.string(),
  source: deckSource,
  createdAt: isoDate,
})
const changeSchema = z.object({
  id: z.number().int(),
  field: z.string(),
  old: json.nullable(),
  new: json.nullable(),
  at: isoDate,
  source: deckSource,
})
const deckSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  energies: z.array(z.string()),
  tags: z.array(z.string()),
  notes: z.string(),
  builtInGame: z.boolean(),
  builtInGameSince: nullableDate,
  variantOfId: z.number().int().nullable(),
  packPriority: z.number().int(),
  /** Version 4; older files have none (guessed from the closest lists). */
  tournamentArchetypeId: z.string().nullable().default(null),
  keyCards: json,
  archivedAt: nullableDate,
  currentRevisionId: z.number().int().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
  revisions: z.array(revisionSchema),
  changes: z.array(changeSchema),
})
const matchSchema = z.object({
  id: z.number().int(),
  deckId: z.number().int(),
  deckRevisionId: z.number().int(),
  result: z.enum(['win', 'loss', 'tie']),
  opponentText: z.string().nullable(),
  /** Version 9: the rival's cards seen (`[]` before). */
  opponentCards: z
    .array(z.object({ cardId: z.string(), count: z.number().int().min(1).max(2) }))
    .default([]),
  wentFirst: z.boolean().nullable(),
  mode: z.enum(['competitive', 'casual', 'beginner', 'event', 'friend']),
  note: z.string(),
  playedAt: isoDate,
  source: z.enum(['ui', 'mcp']),
  createdAt: isoDate,
  updatedAt: isoDate,
})
const tokenSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  kind: z.enum(['worker', 'mcp']),
  scopes: z.array(z.string()),
  prefix: z.string(),
  createdAt: isoDate,
  lastUsedAt: nullableDate,
  expiresAt: nullableDate,
  revokedAt: nullableDate,
})

export const backupDocumentSchema = z.object({
  schemaVersion: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
    z.literal(7),
    z.literal(8),
    z.literal(9),
  ]),
  exportedAt: isoDate,
  appVersion: z.string(),
  catalogCommit: z.string().nullable(),
  engineRev: z.string().nullable(),
  settings: z.array(settingSchema),
  rarityRules: z.array(rarityRuleSchema),
  collection: z.object({
    stock: z.array(stockSchema),
    imports: z.array(importSchema),
    adjustments: z.array(adjustmentSchema),
  }),
  decks: z.array(deckSchema),
  /** Own matches (version 2); a version 1 file has none. */
  matches: z.array(matchSchema).default([]),
  /**
   * Owner switches of the packs (version 3, Fase 4): «disponible», the optional points balance and «tiempo limitado»
   * with its last day (added later in version 3: a file without them keeps the current ones).
   */
  packs: z
    .array(
      z.object({
        id: z.string(),
        available: z.boolean(),
        pointsBalance: z.number().int().nullable(),
        limited: z.boolean().optional(),
        limitedUntil: z.iso.date().nullable().optional(),
      }),
    )
    .default([]),
  /** Owner's tournament settings (version 4): era table and archetype merges. Absent = keep the current ones. */
  tournaments: z
    .object({
      sets: z.array(
        z.object({ code: z.string(), nameEn: z.string(), releaseDate: z.iso.date(), opensEra: z.boolean() }),
      ),
      archetypeAliases: z.array(z.object({ archetypeId: z.string(), canonicalId: z.string() })),
    })
    .optional(),
  /** Metadata only: hashes are never exported, so tokens are not restored (they are created again). */
  tokens: z.array(tokenSchema),
  /** Finished games against the bot (version 5): who played, the bot, the seed and the result. Absent = keep them. */
  playedGames: z
    .array(
      z.object({
        id: z.number().int(),
        humanLabel: z.string(),
        rivalLabel: z.string(),
        bot: z.string(),
        seed: z.string().regex(/^\d{1,20}$/),
        engineRev: z.string(),
        winner: z.enum(['you', 'bot', 'tie']),
        turns: z.number().int().nullable(),
        createdAt: isoDate,
        finishedAt: nullableDate,
      }),
    )
    .optional(),
  /** Events with deck rules (version 7). Absent = keep the current ones. */
  events: z
    .array(
      z.object({
        id: z.number().int(),
        name: z.string().min(1),
        startsOn: z.iso.date().nullable(),
        endsOn: z.iso.date().nullable(),
        rules: z.record(z.string(), z.unknown()),
        notes: z.string(),
        createdAt: isoDate,
        updatedAt: isoDate,
      }),
    )
    .optional(),
  /** Notes by rival (version 6). Absent = keep the current ones. */
  rivalNotes: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        archetypeId: z.string().nullable(),
        text: z.string(),
        createdAt: isoDate,
        updatedAt: isoDate,
      }),
    )
    .optional(),
})

export type BackupDocument = z.infer<typeof backupDocumentSchema>

export interface BackupCounts {
  settings: number
  rarityRules: number
  stock: number
  imports: number
  importRows: number
  adjustments: number
  decks: number
  revisions: number
  changes: number
  matches: number
  packs: number
  setReleases: number
  archetypeAliases: number
  tokens: number
  playedGames: number
  rivalNotes: number
  events: number
}

export function backupCounts(document: BackupDocument): BackupCounts {
  return {
    settings: document.settings.length,
    rarityRules: document.rarityRules.length,
    stock: document.collection.stock.length,
    imports: document.collection.imports.length,
    importRows: document.collection.imports.reduce((sum, item) => sum + item.rows.length, 0),
    adjustments: document.collection.adjustments.length,
    decks: document.decks.length,
    revisions: document.decks.reduce((sum, deck) => sum + deck.revisions.length, 0),
    changes: document.decks.reduce((sum, deck) => sum + deck.changes.length, 0),
    matches: document.matches.length,
    packs: document.packs.length,
    setReleases: document.tournaments?.sets.length ?? 0,
    archetypeAliases: document.tournaments?.archetypeAliases.length ?? 0,
    tokens: document.tokens.length,
    playedGames: document.playedGames?.length ?? 0,
    rivalNotes: document.rivalNotes?.length ?? 0,
    events: document.events?.length ?? 0,
  }
}
