/**
 * zod schemas for every response of docs/API.md (Fase 1). The API is the source of truth; these schemas are
 * deliberately tolerant on what the contract leaves open (unknown keys are stripped, open shapes are `unknown`).
 */
import { z } from 'zod'

// ---------- Shared vocabulary ----------

/** Mirrors `SELECTABLE_ENERGIES` from @tcg/domain (its .d.ts is not built yet, see README). */
export const SELECTABLE_ENERGIES = [
  'grass',
  'fire',
  'water',
  'lightning',
  'psychic',
  'fighting',
  'darkness',
  'metal',
] as const
export const selectableEnergySchema = z.enum(SELECTABLE_ENERGIES)
export type SelectableEnergy = z.infer<typeof selectableEnergySchema>

export const energyTypeSchema = z.enum([...SELECTABLE_ENERGIES, 'dragon', 'colorless'])
export type EnergyType = z.infer<typeof energyTypeSchema>

export const cardTypeSchema = z.enum(['pokemon', 'trainer'])
export const evolutionTypeSchema = z.enum(['basic', 'stage1', 'stage2', 'supporter', 'item', 'tool', 'stadium'])

export const isoDate = z.string()
export const nullableDate = z.string().nullable()

export const apiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
})

/**
 * A win rate (docs/API.md «Convenciones», PLAN I9): percentages 0–100 at full precision, Wilson 95 % interval over
 * `games`, «orientativo» decided on `samples`. `source` keeps own matches, tournament and simulation apart.
 */
export const winRateSchema = z.object({
  source: z.enum(['matches', 'tournament', 'simulation']),
  value: z.number(),
  games: z.number(),
  samples: z.number(),
  sampleKind: z.enum(['matches', 'lists', 'simulations']),
  ci95: z.tuple([z.number(), z.number()]),
  orientative: z.boolean(),
})
export type WinRate = z.infer<typeof winRateSchema>

export const gameRecordSchema = z.object({ wins: z.number(), losses: z.number(), ties: z.number() })
export type GameRecord = z.infer<typeof gameRecordSchema>

/** Generic percentage shape kept for the Stat component. */
export const percentageSchema = z.object({
  value: z.number(),
  games: z.number().optional(),
  samples: z.number().optional(),
  sampleKind: z.string().optional(),
  ci95: z.tuple([z.number(), z.number()]).optional(),
  orientative: z.boolean().optional(),
})
export type Percentage = z.infer<typeof percentageSchema>

// ---------- Catalog ----------

export const cardSummarySchema = z.object({
  id: z.string(),
  nameEs: z.string(),
  nameEn: z.string(),
  expansionId: z.string(),
  number: z.number(),
  rarity: z.string(),
  cardType: cardTypeSchema,
  evolutionType: evolutionTypeSchema,
  ex: z.boolean(),
  prizePoints: z.number(),
  imageUrl: z.string().nullable().optional(),
  functionalGroupId: z.string(),
  stockCardId: z.string(),
  isDisplayEdition: z.boolean(),
  /** Tracker pack name inside the expansion (Fase 41); optional so an older API still parses. */
  pack: z.string().optional(),
})
export type CardSummary = z.infer<typeof cardSummarySchema>

export const groupSummarySchema = z.object({
  id: z.string(),
  nameEs: z.string(),
  nameEn: z.string(),
  cardType: cardTypeSchema,
  displayCardId: z.string(),
  editionCount: z.number(),
})
export type GroupSummary = z.infer<typeof groupSummarySchema>

export const activeAdjustmentSchema = z.object({
  id: z.string(),
  playableCopies: z.number(),
  reason: z.string(),
  createdAt: isoDate,
})
export type ActiveAdjustment = z.infer<typeof activeAdjustmentSchema>

export const groupEditionSchema = z.object({
  card: cardSummarySchema,
  owned: z.number(),
  collected: z.boolean(),
  twinCardIds: z.array(z.string()),
})
export type GroupEdition = z.infer<typeof groupEditionSchema>

export const deckUsageSchema = z.object({
  id: z.string(),
  name: z.string(),
  count: z.number(),
  builtInGame: z.boolean(),
})
export type DeckUsage = z.infer<typeof deckUsageSchema>

export const groupDetailSchema = groupSummarySchema.extend({
  playable: z.number(),
  fromStock: z.number(),
  adjustment: activeAdjustmentSchema.nullable(),
  editions: z.array(groupEditionSchema),
  decks: z.array(deckUsageSchema),
})
export type GroupDetail = z.infer<typeof groupDetailSchema>

export const attackSchema = z.object({
  cost: z.array(energyTypeSchema),
  name: z.string(),
  damage: z.string().nullable(),
  effect: z.string().nullable(),
})
export const abilitySchema = z.object({ name: z.string(), effect: z.string() })

/** Full edition as stored by the catalog (@tcg/domain `CardEdition`). */
export const cardEditionSchema = cardSummarySchema.extend({
  internalId: z.number().optional(),
  hp: z.number().nullable().optional(),
  energy: z.string().optional(),
  evolvesFrom: z.string().nullable().optional(),
  isFossil: z.boolean().optional(),
  baby: z.boolean().optional(),
  artist: z.string().optional(),
  attacks: z.array(attackSchema).default([]),
  ability: abilitySchema.nullable().default(null),
  weakness: z.string().nullable().optional(),
  retreat: z.number().nullable().optional(),
  engineId: z.string().optional(),
})
export type CardEdition = z.infer<typeof cardEditionSchema>

export const cardSearchHitSchema = z.object({
  card: cardSummarySchema,
  group: groupSummarySchema,
  score: z.number().optional(),
})
export type CardSearchHit = z.infer<typeof cardSearchHitSchema>

export const cardSearchResponseSchema = z.object({ items: z.array(cardSearchHitSchema) })
export const cardResponseSchema = z.object({ card: cardEditionSchema, group: groupDetailSchema })
export const groupResponseSchema = z.object({ group: groupDetailSchema })

export const packSchema = z.object({
  id: z.string(),
  expansionId: z.string(),
  name: z.string(),
  nameEs: z.string(),
  color: z.string().nullable().optional(),
})
export const expansionSchema = z.object({
  id: z.string(),
  nameEn: z.string(),
  nameEs: z.string(),
  sortOrder: z.number().optional(),
  isPromo: z.boolean().optional(),
  tradeable: z.boolean().optional(),
  packs: z.array(packSchema).optional(),
})
export type Expansion = z.infer<typeof expansionSchema>
export const expansionsResponseSchema = z.object({ items: z.array(expansionSchema) })

export const catalogSyncSchema = z.object({
  id: z.union([z.string(), z.number()]),
  status: z.string(),
  startedAt: nullableDate.optional(),
  finishedAt: nullableDate.optional(),
  report: z.unknown().optional(),
})
export const catalogStatusSchema = z.object({
  /** A sync is still reloading the catalog (its row may already say «applied»). */
  syncRunning: z.boolean().optional(),
  trackerCommit: z.string().nullable(),
  engineRev: z.string().nullable(),
  syncedAt: nullableDate.optional(),
  counts: z
    .object({
      cards: z.number(),
      groups: z.number(),
      stockUnits: z.number(),
      expansions: z.number(),
      packs: z.number(),
    })
    .nullable(),
  lastSync: catalogSyncSchema.nullable(),
})
export type CatalogStatus = z.infer<typeof catalogStatusSchema>
export const catalogSyncStartedSchema = z.object({ syncId: z.union([z.string(), z.number()]) })

// ---------- Collection ----------

export const collectionSummarySchema = z.object({
  copies: z.number(),
  stockUnitsCollected: z.number(),
  groupsWithAtLeast: z.object({ one: z.number(), two: z.number() }),
  groupsMissing: z.number(),
  lastImportAt: nullableDate,
  activeAdjustments: z.number(),
})
export type CollectionSummary = z.infer<typeof collectionSummarySchema>

export const collectionGroupItemSchema = z.object({
  group: groupSummarySchema,
  playable: z.number(),
  fromStock: z.number(),
  hasAdjustment: z.boolean(),
})
export type CollectionGroupItem = z.infer<typeof collectionGroupItemSchema>
export const collectionGroupsResponseSchema = z.object({
  items: z.array(collectionGroupItemSchema),
  total: z.number(),
})

export const stockItemSchema = z.object({
  card: cardSummarySchema,
  owned: z.number(),
  collected: z.boolean(),
  twinCardIds: z.array(z.string()),
})
export type StockItem = z.infer<typeof stockItemSchema>
export const stockResponseSchema = z.object({ items: z.array(stockItemSchema), total: z.number() })

export const stockValueSchema = z.object({ amountOwned: z.number(), collected: z.boolean() })
export const stockPatchResultSchema = z.object({
  stockCardId: z.string(),
  affectedTwinIds: z.array(z.string()),
  before: stockValueSchema.nullable(),
  after: stockValueSchema,
  activeAdjustment: activeAdjustmentSchema.nullable(),
})
export type StockPatchResult = z.infer<typeof stockPatchResultSchema>

export const importSummarySchema = z.object({
  unitsChanged: z.number(),
  copiesDelta: z.number(),
  newUnits: z.number(),
  zeroedUnits: z.number(),
  collectedChanged: z.number(),
})
export const importStatusSchema = z.enum(['pending', 'applied', 'discarded'])

export const importChangeSchema = z.object({
  stockCardId: z.string(),
  cardIds: z.array(z.string()),
  nameEs: z.string(),
  before: stockValueSchema.nullable(),
  after: stockValueSchema,
})
export type ImportChange = z.infer<typeof importChangeSchema>

export const twinConflictSchema = z.object({
  stockCardId: z.string(),
  rows: z.array(
    z.object({
      cardId: z.string(),
      line: z.number(),
      amountOwned: z.number(),
      collected: z.boolean(),
    }),
  ),
})

export const importPreviewSchema = z.object({
  id: z.string(),
  fileName: z.string().nullable(),
  status: importStatusSchema,
  importedAt: isoDate,
  appliedAt: nullableDate,
  rowCount: z.number(),
  naiveTotal: z.number(),
  dedupTotal: z.number(),
  bom: z.boolean().optional(),
  lineEnding: z.string().optional(),
  errors: z.array(z.object({ line: z.number().nullable(), code: z.string(), message: z.string() })),
  unknownIds: z.array(z.string()),
  twinConflicts: z.array(twinConflictSchema),
  summary: importSummarySchema,
  changes: z.array(importChangeSchema),
  adjustmentsMatching: z.array(
    z.object({ adjustmentId: z.string(), groupId: z.string(), nameEs: z.string(), playableCopies: z.number() }),
  ),
  adjustmentsHidingChange: z.array(
    z.object({
      adjustmentId: z.string(),
      groupId: z.string(),
      nameEs: z.string(),
      playableCopies: z.number(),
      sumBefore: z.number(),
      sumAfter: z.number(),
    }),
  ),
})
export type ImportPreview = z.infer<typeof importPreviewSchema>

export const importListItemSchema = z.object({
  id: z.string(),
  fileName: z.string().nullable(),
  importedAt: isoDate,
  appliedAt: nullableDate,
  status: importStatusSchema,
  rowCount: z.number(),
  naiveTotal: z.number(),
  dedupTotal: z.number(),
  summary: importSummarySchema.nullable().optional(),
})
export type ImportListItem = z.infer<typeof importListItemSchema>
export const importsResponseSchema = z.object({ items: z.array(importListItemSchema) })
export const importAppliedSchema = z.object({ applied: z.boolean(), summary: importSummarySchema.optional() })

export const collectionAdjustmentSchema = z.object({
  id: z.string(),
  functionalGroupId: z.string(),
  /** Not in the contract yet (gap reported): shown when present, otherwise the group id links to its page. */
  nameEs: z.string().optional(),
  playableCopies: z.number(),
  reason: z.string(),
  active: z.boolean(),
  createdAt: isoDate,
  resolvedAt: nullableDate.optional(),
  resolution: z.string().nullable().optional(),
})
export type CollectionAdjustment = z.infer<typeof collectionAdjustmentSchema>
export const adjustmentsResponseSchema = z.object({ items: z.array(collectionAdjustmentSchema) })

// ---------- Decks ----------

export const issueSchema = z.object({
  code: z.string(),
  message: z.string(),
  cardIds: z.array(z.string()).optional(),
})
export type Issue = z.infer<typeof issueSchema>

export const validationSchema = z.object({
  ok: z.boolean(),
  errors: z.array(issueSchema),
  warnings: z.array(issueSchema),
  infos: z.array(issueSchema),
})
export type DeckValidation = z.infer<typeof validationSchema>

export const completenessSchema = z.object({
  complete: z.boolean(),
  missing: z.array(
    z.object({
      groupId: z.string(),
      nameEs: z.string(),
      need: z.number(),
      have: z.number(),
      cardIds: z.array(z.string()),
    }),
  ),
  missingCount: z.number(),
})
export type DeckCompleteness = z.infer<typeof completenessSchema>

export const deckCardInputSchema = z.object({ cardId: z.string(), count: z.number().int().min(1) })
export const deckInputSchema = z.object({
  name: z.string(),
  energies: z.array(selectableEnergySchema),
  cards: z.array(deckCardInputSchema),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  variantOfId: z.string().optional(),
  packPriority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
  tournamentArchetypeId: z.string().nullable().optional(),
})
export type DeckInput = z.infer<typeof deckInputSchema>

export const deckSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  energies: z.array(selectableEnergySchema),
  tags: z.array(z.string()),
  builtInGame: z.boolean(),
  variantOfId: z.string().nullable(),
  packPriority: z.number().nullable().optional(),
  tournamentArchetypeId: z.string().nullable().optional(),
  archivedAt: nullableDate,
  valid: z.boolean(),
  errorCount: z.number(),
  complete: z.boolean(),
  missingCount: z.number(),
  cardCount: z.number(),
  updatedAt: isoDate,
  revisionNumber: z.number(),
})
export type DeckSummary = z.infer<typeof deckSummarySchema>
export const decksResponseSchema = z.object({ items: z.array(deckSummarySchema) })

export const deckCardSchema = z.object({
  card: cardSummarySchema,
  count: z.number(),
  group: groupSummarySchema,
  playable: z.number(),
  missing: z.number(),
})
export type DeckCard = z.infer<typeof deckCardSchema>

export const deckRevisionSchema = z.object({
  number: z.number(),
  createdAt: isoDate,
  source: z.string(),
  note: z.string().nullable().optional(),
  cardCount: z.number(),
})
export const deckChangeSchema = z.object({
  field: z.string(),
  old: z.unknown(),
  new: z.unknown(),
  at: isoDate,
  source: z.string().nullable().optional(),
})

/** Best prints owned of each functional card (only the cards that improve; `cards` is the whole list rewritten). */
export const bestVersionsSchema = z.object({
  changed: z.boolean(),
  groups: z.array(
    z.object({
      groupId: z.string(),
      nameEs: z.string(),
      need: z.number(),
      current: z.array(z.object({ cardId: z.string(), count: z.number() })),
      recommended: z.array(
        z.object({ cardId: z.string(), nameEs: z.string(), rarity: z.string(), holo: z.boolean(), count: z.number() }),
      ),
    }),
  ),
  cards: z.array(z.object({ cardId: z.string(), count: z.number() })),
})
export type BestVersions = z.infer<typeof bestVersionsSchema>

export const deckDetailSchema = deckSummarySchema.extend({
  cards: z.array(deckCardSchema),
  validation: validationSchema,
  completeness: completenessSchema,
  revisions: z.array(deckRevisionSchema),
  changes: z.array(deckChangeSchema),
  notes: z.string().nullable(),
  bestVersions: bestVersionsSchema.optional(),
})
export type DeckDetail = z.infer<typeof deckDetailSchema>

const cardChangeSchema = z.object({
  groupId: z.string(),
  nameEs: z.string(),
  count: z.number(),
  cardIds: z.array(z.string()),
})
export type CardChange = z.infer<typeof cardChangeSchema>

export const deckDistanceSchema = z.object({
  deckId: z.string(),
  name: z.string(),
  builtInGame: z.boolean(),
  swaps: z.number(),
  keep: z.number(),
  toAdd: z.array(cardChangeSchema),
  toRemove: z.array(cardChangeSchema),
  otherEdition: z.array(cardChangeSchema),
  energies: z.object({ from: z.array(z.string()), to: z.array(z.string()), change: z.boolean() }),
})
export type DeckDistance = z.infer<typeof deckDistanceSchema>

export const closestDecksSchema = z.object({
  target: z.object({ deckId: z.string().nullable(), name: z.string().nullable(), cardCount: z.number() }),
  scope: z.enum(['built', 'all']),
  candidates: z.number(),
  builtInGameDecks: z.number(),
  results: z.array(deckDistanceSchema),
})
export type ClosestDecks = z.infer<typeof closestDecksSchema>

export const randomDeckSchema = z.object({ deck: deckSummarySchema, games: z.number(), candidates: z.number() })
export type RandomDeck = z.infer<typeof randomDeckSchema>

export const deckDraftSchema = z.object({
  name: z.string().optional(),
  energies: z.array(selectableEnergySchema),
  cards: z.array(deckCardInputSchema),
  notes: z.string().optional(),
  source: z.string().optional(),
})
export type DeckDraft = z.infer<typeof deckDraftSchema>

export const parseIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  line: z.number().optional(),
  candidates: z.array(z.string()).optional(),
})

export const validateResponseSchema = z.object({
  draft: deckDraftSchema.nullable(),
  validation: validationSchema,
  completeness: completenessSchema,
})
export type ValidateResponse = z.infer<typeof validateResponseSchema>

export const importedCardSchema = z.object({
  cardId: z.string(),
  count: z.number().int(),
  nameEs: z.string(),
  nameEn: z.string(),
  cardType: z.enum(['pokemon', 'trainer']).nullable(),
})
export type ImportedCard = z.infer<typeof importedCardSchema>

export const importedDeckDraftSchema = z.object({
  number: z.number().optional().nullable(),
  title: z.string().optional().nullable(),
  draft: deckDraftSchema.nullable(),
  cards: z.array(importedCardSchema).optional().default([]),
  errors: z.array(parseIssueSchema),
  warnings: z.array(parseIssueSchema),
  validation: validationSchema.nullable(),
  completeness: completenessSchema.nullable(),
})
export type ImportedDeckDraft = z.infer<typeof importedDeckDraftSchema>
export const importDecksResponseSchema = z.object({ drafts: z.array(importedDeckDraftSchema) })
export const commitDecksResponseSchema = z.object({ created: z.array(deckSummarySchema) })
export const decksByCardResponseSchema = z.object({ items: z.array(deckUsageSchema) })

export const DECK_EXPORT_FORMATS = ['spanish', 'deckgym', 'limitless', 'json'] as const
export type DeckExportFormat = (typeof DECK_EXPORT_FORMATS)[number]
export const DECK_IMPORT_FORMATS = ['auto', 'spanish', 'spanish-file', 'limitless', 'json'] as const
export type DeckImportFormat = (typeof DECK_IMPORT_FORMATS)[number]

// ---------- Matches (Fase 2) ----------

/** Mirrors MATCH_RESULTS / MATCH_MODES of @tcg/domain. */
export const MATCH_RESULTS = ['win', 'loss', 'tie'] as const
export const matchResultSchema = z.enum(MATCH_RESULTS)
export type MatchResult = z.infer<typeof matchResultSchema>
export const MATCH_MODES = ['competitive', 'casual', 'beginner', 'event', 'friend'] as const
export const matchModeSchema = z.enum(MATCH_MODES)
export type MatchMode = z.infer<typeof matchModeSchema>

export const matchDeckRefSchema = z.object({ id: z.string(), name: z.string(), archived: z.boolean() })
export type MatchDeckRef = z.infer<typeof matchDeckRefSchema>

export const matchSchema = z.object({
  id: z.string(),
  deck: matchDeckRefSchema,
  deckRevision: z.number(),
  result: matchResultSchema,
  opponent: z.string().nullable(),
  wentFirst: z.boolean().nullable(),
  mode: matchModeSchema,
  note: z.string(),
  playedAt: isoDate,
  source: z.string(),
  createdAt: isoDate,
  updatedAt: isoDate,
})
export type Match = z.infer<typeof matchSchema>
export const matchesResponseSchema = z.object({ items: z.array(matchSchema), total: z.number() })

export interface MatchInput {
  deckId: string
  result: MatchResult
  opponent?: string | null
  wentFirst?: boolean | null
  mode?: MatchMode
  note?: string
  playedAt?: string
  /** Fase 28: the phone's id of the match (a second send stores it once). */
  clientRef?: string
  /** Fase 28: how long ago it was played, measured on the phone (for a match saved without signal). */
  playedAgoMs?: number
}

export const pickerDeckSchema = z.object({
  id: z.string(),
  name: z.string(),
  energies: z.array(z.string()),
  builtInGame: z.boolean(),
  lastPlayedAt: nullableDate,
  games: z.number(),
})
export type PickerDeck = z.infer<typeof pickerDeckSchema>

export const opponentSuggestionSchema = z.object({
  key: z.string(),
  label: z.string(),
  games: z.number(),
  lastPlayedAt: isoDate,
})
export type OpponentSuggestion = z.infer<typeof opponentSuggestionSchema>

export const matchSuggestionsSchema = z.object({
  decks: z.array(pickerDeckSchema),
  lastDeckId: z.string().nullable(),
  lastMode: matchModeSchema,
  opponents: z.array(opponentSuggestionSchema),
  /** Archetypes of the current tournament era with ≥ 5 lists (Fase 5). */
  tournamentArchetypes: z.array(z.object({ name: z.string(), lists: z.number() })).default([]),
})
export type MatchSuggestions = z.infer<typeof matchSuggestionsSchema>

const rowFields = { record: gameRecordSchema, rate: winRateSchema.nullable() }
export const statRowSchema = z.object(rowFields)
export type StatRow = z.infer<typeof statRowSchema>

export const matchStatsSchema = z.object({
  filters: z.object({
    deckId: z.string().nullable(),
    mode: matchModeSchema.nullable(),
    from: nullableDate,
    to: nullableDate,
  }),
  overall: statRowSchema,
  byDeck: z.array(z.object({ ...rowFields, deck: matchDeckRefSchema })),
  byOpponent: z.array(z.object({ ...rowFields, key: z.string().nullable(), label: z.string() })),
  byWentFirst: z.array(z.object({ ...rowFields, key: z.enum(['first', 'second', 'unknown']), label: z.string() })),
  byMode: z.array(z.object({ ...rowFields, mode: matchModeSchema, label: z.string() })),
  byRevision: z.array(z.object({ ...rowFields, revision: z.number().nullable() })),
  /** Fase 25: going first against going second. */
  turnOrder: z
    .object({
      first: gameRecordSchema,
      second: gameRecordSchema,
      unknown: z.number(),
      coverage: z.number(),
      firstShare: z.number().nullable(),
      secondShare: z.number().nullable(),
      gap: z.number().nullable(),
      z: z.number().nullable(),
      p: z.number().nullable().default(null),
      verdict: z.enum(['few', 'clear', 'maybe']),
      text: z.string(),
    })
    .optional(),
})
export type MatchStats = z.infer<typeof matchStatsSchema>
export type TurnOrder = NonNullable<MatchStats['turnOrder']>

export const comparisonColumnSchema = z.object({
  source: z.enum(['matches', 'tournament', 'simulation']),
  label: z.string(),
  available: z.boolean(),
  record: gameRecordSchema.nullable(),
  rate: winRateSchema.nullable(),
  note: z.string(),
  rows: z
    .array(
      z.object({
        label: z.string(),
        record: gameRecordSchema,
        rate: winRateSchema.nullable(),
        note: z.string().optional(),
      }),
    )
    .optional(),
})
export type ComparisonColumn = z.infer<typeof comparisonColumnSchema>
export const deckComparisonSchema = z.object({ deck: matchDeckRefSchema, columns: z.array(comparisonColumnSchema) })

/** Fase 9: against each rival, own matches and the tournament matchup of the deck's archetype. */
export const deckMatchupsSchema = z.object({
  deck: matchDeckRefSchema,
  archetype: z.object({ id: z.string(), name: z.string(), source: z.enum(['owner', 'guessed']) }).nullable(),
  era: z.string(),
  tournamentsWithPairings: z.number(),
  expected: z
    .object({
      value: z.number(),
      ci95: z.tuple([z.number(), z.number()]).nullable().default(null),
      coverage: z.number(),
      matches: z.number(),
      rivals: z.number(),
    })
    .nullable(),
  rows: z.array(
    z.object({
      rival: z.object({ id: z.string().nullable(), name: z.string() }),
      share: z.number().nullable(),
      mine: z.object({ record: gameRecordSchema, rate: winRateSchema.nullable() }).nullable(),
      tournament: z.object({ record: gameRecordSchema, rate: winRateSchema.nullable() }).nullable(),
      luck: z.enum(['too_few', 'normal', 'unlucky', 'lucky']).nullable().default(null),
      turn: z.object({ first: gameRecordSchema, second: gameRecordSchema }).nullable().default(null),
    }),
  ),
  attribution: z.string(),
})
export type DeckMatchups = z.infer<typeof deckMatchupsSchema>

/** Fase 13: an own record against what tournaments expect, in words. */
export const luckSchema = z.object({
  deck: matchDeckRefSchema,
  opponent: z.string().nullable(),
  record: gameRecordSchema,
  expected: z
    .object({ value: z.number(), kind: z.enum(['matchup', 'archetype']), label: z.string(), games: z.number() })
    .nullable(),
  check: z
    .object({
      games: z.number(),
      actual: z.number(),
      expected: z.number(),
      lowerTail: z.number(),
      upperTail: z.number(),
      verdict: z.enum(['too_few', 'normal', 'unlucky', 'lucky']),
    })
    .nullable(),
  streak: z
    .object({ losses: z.number(), probability: z.number(), somewhere: z.number(), games: z.number() })
    .nullable(),
  text: z.string(),
})
export type Luck = z.infer<typeof luckSchema>
export type DeckComparison = z.infer<typeof deckComparisonSchema>

// ---------- Packs (Fase 4) ----------

/** Mirrors RARITIES of @tcg/domain (pack-obtainable ones first; «P» are promos). */
export const RARITIES = ['◊', '◊◊', '◊◊◊', '◊◊◊◊', '☆', '☆☆', '☆☆☆', '✵', '✵✵', 'Crown Rare', 'P'] as const
export const raritySchema = z.enum(RARITIES)
export type Rarity = z.infer<typeof raritySchema>
export const PACK_MODELS = ['corrected', 'tracker'] as const
export type PackModel = (typeof PACK_MODELS)[number]

export const packInfoSchema = z.object({
  id: z.string(),
  expansionId: z.string(),
  expansionNameEs: z.string(),
  name: z.string(),
  nameEs: z.string(),
  available: z.boolean(),
  limited: z.boolean(),
  limitedUntil: z.string().nullable(),
  cardsPerPack: z.number(),
  cardCount: z.number(),
  containsShinies: z.boolean(),
  containsBabies: z.boolean(),
  inTrackerOverview: z.boolean(),
})
export type PackInfo = z.infer<typeof packInfoSchema>
export const packsResponseSchema = z.object({ items: z.array(packInfoSchema) })

export const rarityRuleSchema = z.object({
  rarity: z.string(),
  points: z.number().nullable(),
  verified: z.boolean(),
  tradeable: z.boolean(),
})
export type RarityRuleInfo = z.infer<typeof rarityRuleSchema>
export const rarityRulesResponseSchema = z.object({ items: z.array(rarityRuleSchema) })

export const collectionGoalSchema = z.object({ rarities: z.array(raritySchema), copies: z.number() })
export type CollectionGoal = z.infer<typeof collectionGoalSchema>

const packRefFields = {
  packId: z.string(),
  nameEs: z.string(),
  expansionId: z.string(),
  expansionNameEs: z.string(),
}
const pullFields = z.object({ probability: z.number(), expected: z.number() })

/** A card only a limited-time pack gives: a functional card for the decks, a version (art, holo) for the collection. */
export const exclusiveVersionSchema = z.object({
  cardId: z.string(),
  nameEs: z.string(),
  rarity: z.string(),
  holo: z.boolean(),
  goal: z.enum(['decks', 'collection']),
})
export type ExclusiveVersion = z.infer<typeof exclusiveVersionSchema>

export const packRowSchema = z.object({
  ...packRefFields,
  available: z.boolean(),
  cardsPerPack: z.number(),
  wanted: z.number(),
  probability: z.number(),
  expected: z.number(),
  expectedValue: z.number(),
  packsFor50: z.number().nullable(),
  packsFor90: z.number().nullable(),
  decks: pullFields.nullable(),
  collection: pullFields.nullable(),
  otherModel: z.object({
    model: z.enum(PACK_MODELS),
    probability: z.number(),
    reasons: z.array(z.enum(['babies', 'reprints'])),
  }),
  limited: z
    .object({
      until: z.string().nullable(),
      daysLeft: z.number().nullable(),
      exclusive: z.array(exclusiveVersionSchema),
    })
    .nullable(),
})
export type PackRow = z.infer<typeof packRowSchema>

export const missingCardSchema = z.object({
  groupId: z.string(),
  nameEs: z.string(),
  missing: z.number(),
  weight: z.number(),
  decks: z.array(z.object({ deckId: z.string(), name: z.string(), priority: z.number(), need: z.number() })),
  cheapest: z
    .object({
      cardId: z.string(),
      rarity: z.string(),
      points: z.number(),
      verified: z.boolean(),
      tradeable: z.boolean(),
    })
    .nullable(),
  retiredCheapest: z
    .object({
      cardId: z.string(),
      rarity: z.string(),
      points: z.number(),
      verified: z.boolean(),
      tradeable: z.boolean(),
    })
    .nullable()
    .default(null),
  tradeable: z.boolean(),
  redeem: z
    .object({
      cardId: z.string(),
      rarity: z.string(),
      points: z.number(),
      verified: z.boolean(),
      tradeable: z.boolean(),
      saved: z.number(),
      copies: z.number(),
    })
    .nullable()
    .default(null),
  bestPack: z
    .object({ ...packRefFields, probability: z.number(), packsPerCopy: z.number(), limited: z.boolean() })
    .nullable(),
  afterLimited: z.object({ ...packRefFields, probability: z.number(), packsPerCopy: z.number() }).nullable(),
  pointsInPacks: z.number().nullable(),
  advice: z.enum(['redeem', 'buy', 'open', 'trade']).nullable(),
})
export type MissingCard = z.infer<typeof missingCardSchema>

export const deckCompletionSchema = z.object({
  deckId: z.string(),
  name: z.string(),
  priority: z.number(),
  missingCopies: z.number(),
  notInPacks: z.array(z.string()),
  bestPacks: z.array(
    z.object({
      ...packRefFields,
      covered: z.number(),
      limited: z.boolean(),
      expectedPacks: z.number(),
      method: z.enum(['exact', 'simulation']),
      ci95: z.tuple([z.number(), z.number()]).nullable(),
    }),
  ),
  /** Fase 14: the whole deck from the best packs, packs and days at the planner's pace. */
  plan: z
    .object({
      packs: z.object({ mean: z.number(), p50: z.number(), p80: z.number() }),
      days: z.object({ p50: z.number(), p80: z.number() }),
      groups: z.array(
        z.object({
          ...packRefFields,
          copies: z.number(),
          cards: z.array(z.string()),
          limited: z.boolean(),
          endsBeforeDone: z.boolean(),
        }),
      ),
      redeemable: z.array(z.string()),
    })
    .nullable()
    .default(null),
})
export type DeckCompletion = z.infer<typeof deckCompletionSchema>

/** What «Completar mazos» aims at: each deck's saved list or its «versión de torneo». */
export const DECK_TARGETS = ['saved', 'tournament'] as const
export type DeckTarget = (typeof DECK_TARGETS)[number]

export const recommendationSchema = z.object({
  model: z.enum(PACK_MODELS),
  alpha: z.number(),
  collection: collectionGoalSchema.nullable(),
  onlyAvailable: z.boolean(),
  limitedBoost: z.number(),
  today: z.string(),
  deckTarget: z.enum(DECK_TARGETS).default('saved'),
  goals: z.object({
    decks: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        priority: z.number(),
        target: z.enum(DECK_TARGETS).default('saved'),
        list: z.object({ key: z.string(), lists: z.number() }).nullable().default(null),
      }),
    ),
  }),
  rows: z.array(packRowSchema),
  missing: z.array(missingCardSchema),
  decks: z.array(deckCompletionSchema),
  collectionOutOfPacks: z.object({ versions: z.number(), tradeable: z.number() }).nullable(),
  planner: z.object({ packsPerDay: z.number(), hourglasses: z.number() }).default({ packsPerDay: 2, hourglasses: 0 }),
  assumptions: z.array(z.string()),
})
export type Recommendation = z.infer<typeof recommendationSchema>

export interface RecommendBody {
  model: PackModel
  alpha: number
  collection: CollectionGoal | null
  onlyAvailable: boolean
  limitedBoost: number
  deckTarget: DeckTarget
}

// ---------- Auth, tokens, settings, backup ----------

export const meSchema = z.object({ email: z.string(), totpEnabled: z.boolean() })
export type Me = z.infer<typeof meSchema>

export const tokenKindSchema = z.enum(['worker', 'mcp'])
export type TokenKind = z.infer<typeof tokenKindSchema>
export const SCOPES_BY_KIND: Record<TokenKind, readonly string[]> = {
  worker: ['worker:claim'],
  mcp: ['mcp:read', 'mcp:write'],
}

export const apiTokenSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string(),
  kind: tokenKindSchema,
  scopes: z.array(z.string()),
  prefix: z.string(),
  lastUsedAt: nullableDate.optional(),
  expiresAt: nullableDate.optional(),
  revokedAt: nullableDate.optional(),
  createdAt: isoDate,
  /** Fase 43: the clients seen with the token (a new one raises an alert). */
  clients: z.array(z.object({ client: z.string(), firstSeenAt: isoDate })).default([]),
})
export type ApiToken = z.infer<typeof apiTokenSchema>
export const tokensResponseSchema = z.object({ items: z.array(apiTokenSchema) })
export const createdTokenSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  token: z.string(),
})

export const settingsSchema = z.record(z.string(), z.unknown())
export const settingValueSchema = z.object({ key: z.string(), value: z.unknown() })
export const uiSettingsSchema = z.object({
  thumbnails: z.boolean().default(false),
  /** Fase 22: card images on the board (games against the bot and replays); off = text tiles. */
  boardImages: z.boolean().default(true),
  /** Fase 25: the quick match form does not save until who went first is answered. */
  askWentFirst: z.boolean().default(false),
})
export type UiSettings = z.infer<typeof uiSettingsSchema>

export const backupDryRunSchema = z.object({
  schemaVersion: z.union([z.string(), z.number()]),
  catalogCommit: z.string().nullable(),
  diff: z.record(z.string(), z.unknown()),
})
export type BackupDryRun = z.infer<typeof backupDryRunSchema>
export const backupReplaceSchema = z.object({ applied: z.boolean(), counts: z.record(z.string(), z.unknown()) })
export const backupBlobsSchema = z.object({
  items: z.array(z.object({ id: z.string(), createdAt: isoDate, sizeBytes: z.number() })),
})
export type BackupBlob = z.infer<typeof backupBlobsSchema>['items'][number]

export const healthSchema = z.object({
  ok: z.boolean(),
  version: z.string().optional(),
  catalogCommit: z.string().nullable().optional(),
  engineRev: z.string().nullable().optional(),
})

// ---------- Torneos (Fase 5) ----------

export const TOURNAMENT_FORMATS = ['STANDARD', 'NOEX'] as const
export type TournamentFormat = (typeof TOURNAMENT_FORMATS)[number]

export const recordRowSchema = z.object({
  lists: z.number(),
  record: gameRecordSchema,
  rate: winRateSchema.nullable(),
  share: z.number(),
})
export type RecordRow = z.infer<typeof recordRowSchema>

export const eraSchema = z.object({
  code: z.string(),
  nameEs: z.string(),
  from: z.string(),
  to: z.string().nullable(),
  current: z.boolean(),
})
export type Era = z.infer<typeof eraSchema>

export const scopeSchema = z.object({
  era: eraSchema,
  format: z.enum(TOURNAMENT_FORMATS),
  minPlayers: z.number(),
  tournaments: z.number(),
  lists: z.number(),
  games: z.number(),
  mean: recordRowSchema,
  conflicts: z.array(z.object({ tournamentId: z.string(), name: z.string(), date: z.string(), set: z.string() })),
  /** H-006: tournaments left out of the era (a set the era table lacks). */
  newSetTournaments: z
    .array(z.object({ tournamentId: z.string(), name: z.string(), date: z.string(), set: z.string() }))
    .default([]),
  unknownCards: z.number(),
  attribution: z.string(),
})
export type TournamentScope = z.infer<typeof scopeSchema>

export const archetypeRefSchema = z.object({ id: z.string().nullable(), name: z.string(), icons: z.array(z.string()) })
export const archetypeRowSchema = recordRowSchema.extend({ archetype: archetypeRefSchema })
export type ArchetypeRow = z.infer<typeof archetypeRowSchema>

export const cardLineSchema = z.object({
  groupId: z.string().nullable(),
  cardId: z.string().nullable(),
  nameEs: z.string(),
  nameEn: z.string(),
  set: z.string(),
  number: z.string(),
  count: z.number(),
  cardType: z.enum(['pokemon', 'trainer']).nullable(),
})
export type CardLine = z.infer<typeof cardLineSchema>

export const listRowSchema = recordRowSchema.extend({
  key: z.string(),
  kind: z.enum(['group', 'name']),
  archetype: archetypeRefSchema,
  cards: z.array(cardLineSchema),
  otherKey: z.string().nullable(),
})
export type ListRow = z.infer<typeof listRowSchema>

export const missingCopiesSchema = z.object({
  groupId: z.string(),
  nameEs: z.string(),
  need: z.number(),
  have: z.number(),
})
export const listAgainstSchema = listRowSchema.extend({
  missing: z.array(missingCopiesSchema),
  missingCopies: z.number(),
})
export type ListAgainstCollection = z.infer<typeof listAgainstSchema>

export const archetypesResponseSchema = z.object({ scope: scopeSchema, rows: z.array(archetypeRowSchema) })
export const listsResponseSchema = z.object({ scope: scopeSchema, rows: z.array(listRowSchema), total: z.number() })

export const withWithoutSchema = z.object({
  card: z.object({ groupId: z.string(), nameEs: z.string() }),
  minCount: z.number(),
  with: recordRowSchema,
  without: recordRowSchema,
})
// ---------- Matchups de torneo (Fase 9) ----------

export const expectedVsMetaSchema = z.object({
  value: z.number(),
  /** H-011: approximate 95 % interval. */
  ci95: z.tuple([z.number(), z.number()]).nullable().default(null),
  coverage: z.number(),
  matches: z.number(),
  rivals: z.number(),
})
export type ExpectedVsMeta = z.infer<typeof expectedVsMetaSchema>

export const archetypeMatchupsSchema = z.object({
  rows: z.array(
    z.object({
      rival: archetypeRefSchema,
      share: z.number(),
      record: gameRecordSchema,
      rate: winRateSchema.nullable(),
    }),
  ),
  expected: expectedVsMetaSchema.nullable(),
  tournamentsWithPairings: z.number(),
})
export type ArchetypeMatchups = z.infer<typeof archetypeMatchupsSchema>

const shareChangeFields = {
  now: z.object({ lists: z.number(), share: z.number() }),
  before: z.object({ lists: z.number(), share: z.number() }),
  delta: z.number(),
  clear: z.boolean(),
}
const trendWindowSchema = z.object({ from: z.string(), to: z.string(), tournaments: z.number(), lists: z.number() })

/** Fase 11: this week against the week before. */
export const metaTrendsSchema = z.object({
  scope: scopeSchema,
  days: z.number(),
  now: trendWindowSchema,
  before: trendWindowSchema,
  archetypes: z.array(
    z.object({
      ...shareChangeFields,
      archetype: archetypeRefSchema,
      record: gameRecordSchema,
      rate: winRateSchema.nullable(),
      isNew: z.boolean(),
    }),
  ),
  cards: z.array(z.object({ ...shareChangeFields, groupId: z.string(), nameEs: z.string() })),
  attribution: z.string(),
})
export type MetaTrends = z.infer<typeof metaTrendsSchema>

export const matchupMatrixSchema = z.object({
  scope: scopeSchema,
  coverage: z.object({
    tournaments: z.number(),
    tournamentsWithPairings: z.number(),
    matches: z.number(),
    skipped: z.object({ byes: z.number(), doubleLosses: z.number(), noArchetype: z.number() }),
  }),
  archetypes: z.array(
    z.object({
      archetype: archetypeRefSchema,
      share: z.number(),
      lists: z.number(),
      field: z.object({ record: gameRecordSchema, rate: winRateSchema.nullable() }),
      expected: expectedVsMetaSchema.nullable(),
    }),
  ),
  cells: z.array(z.object({ a: z.string(), b: z.string(), record: gameRecordSchema, rate: winRateSchema.nullable() })),
  attribution: z.string(),
})
export type MatchupMatrix = z.infer<typeof matchupMatrixSchema>

export const archetypeDetailSchema = z.object({
  scope: scopeSchema,
  archetype: archetypeRowSchema,
  merged: z.array(z.string()),
  lists: z.array(listRowSchema),
  cards: z.array(
    z.object({
      groupId: z.string(),
      nameEs: z.string(),
      lists: z.number(),
      share: z.number(),
      byCopies: z.array(z.number()),
      averageCopies: z.number(),
    }),
  ),
  withWithout: withWithoutSchema.nullable(),
  matchups: archetypeMatchupsSchema.default({ rows: [], expected: null, tournamentsWithPairings: 0 }),
})
export type ArchetypeDetail = z.infer<typeof archetypeDetailSchema>

export const listDetailSchema = z.object({
  scope: scopeSchema,
  list: listAgainstSchema,
  /** Fase 8: what can take the place of each card the collection lacks. */
  substitutes: z
    .array(
      z.object({
        groupId: z.string(),
        nameEs: z.string(),
        need: z.number(),
        have: z.number(),
        options: z.array(
          z.object({
            groupId: z.string(),
            cardId: z.string(),
            nameEs: z.string(),
            reason: z.enum(['same_name', 'replaces', 'archetype']),
            reasonEs: z.string(),
            lists: z.number(),
            of: z.number(),
            have: z.number(),
          }),
        ),
      }),
    )
    .default([]),
  energies: z.array(z.string()),
  text: z.string(),
  entries: z.array(
    z.object({
      tournamentId: z.string(),
      tournamentName: z.string(),
      date: z.string(),
      playerName: z.string(),
      placing: z.number().nullable(),
      record: gameRecordSchema,
    }),
  ),
})
export type ListDetail = z.infer<typeof listDetailSchema>

export const buildableResponseSchema = z.object({
  scope: scopeSchema,
  buildable: z.array(listAgainstSchema),
  near: z.array(listAgainstSchema),
})
export const unlockResponseSchema = z.object({
  scope: scopeSchema,
  cards: z.array(
    z.object({
      groupId: z.string(),
      nameEs: z.string(),
      have: z.number(),
      copies: z.number(),
      lists: z.number(),
      listsWithOneCopy: z.number(),
      entries: z.number(),
      record: gameRecordSchema,
      rate: winRateSchema.nullable(),
      unlocked: z.array(listAgainstSchema),
    }),
  ),
})
export type UnlockCard = z.infer<typeof unlockResponseSchema>['cards'][number]

export const tournamentEventsSchema = z.object({
  scope: scopeSchema,
  rows: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      date: z.string(),
      players: z.number(),
      lists: z.number(),
      organizerName: z.string().nullable(),
      conflict: z.string().nullable(),
    }),
  ),
})

export const unknownCardsSchema = z.object({
  scope: scopeSchema,
  cards: z.array(
    z.object({ ref: z.string(), set: z.string(), number: z.string(), name: z.string(), occurrences: z.number() }),
  ),
})

export const tournamentStatusSchema = z.object({
  currentEra: eraSchema.nullable(),
  eras: z.array(eraSchema),
  newEra: z
    .object({ lastRelease: z.string(), releaseDate: z.string(), days: z.number(), likely: z.boolean() })
    .nullable(),
  minPlayers: z.number(),
  sync: z.object({
    enabled: z.boolean(),
    running: z.boolean(),
    progress: z
      .object({
        kind: z.string(),
        startedAt: z.string(),
        calls: z.number(),
        waitedMs: z.number(),
        listed: z.number(),
        done: z.number(),
        pending: z.number(),
        current: z.string().nullable(),
      })
      .nullable(),
    lastRun: z
      .object({
        id: z.number(),
        kind: z.string(),
        status: z.string(),
        startedAt: z.string(),
        finishedAt: z.string().nullable(),
        calls: z.number(),
        tournamentsListed: z.number(),
        tournamentsDone: z.number(),
        error: z.string().nullable(),
      })
      .nullable(),
    callsInWindow: z.number(),
    counts: z.object({
      listed: z.number(),
      complete: z.number(),
      incomplete: z.number(),
      excluded: z.number(),
      failed: z.number(),
    }),
    pairings: z.object({ fetched: z.number(), missing: z.number() }).default({ fetched: 0, missing: 0 }),
    newestTournament: z.string().nullable(),
  }),
})
export type TournamentStatus = z.infer<typeof tournamentStatusSchema>

export const setReleaseSchema = z.object({
  code: z.string(),
  nameEn: z.string(),
  nameEs: z.string().nullable(),
  releaseDate: z.string(),
  opensEra: z.boolean(),
})
export type SetReleaseInfo = z.infer<typeof setReleaseSchema>
export const setReleasesResponseSchema = z.object({ items: z.array(setReleaseSchema) })

// ---------- Simulación (Fase 6) ----------

export const SIMULATION_KINDS = ['matrix', 'compare', 'optimize', 'explore', 'consistency'] as const
export type SimulationKind = (typeof SIMULATION_KINDS)[number]
/** What the new-simulation screen queues: explore jobs start from the Laboratorio. */
export const QUEUEABLE_SIMULATION_KINDS = ['matrix', 'compare', 'optimize'] as const
export type QueueableSimulationKind = (typeof QUEUEABLE_SIMULATION_KINDS)[number]
export const SIMULATION_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const
export type SimulationStatus = (typeof SIMULATION_STATUSES)[number]

export const snapshotProblemSchema = z
  .object({
    kind: z.string(),
    message: z.string(),
    cardId: z.string().optional(),
    nameEs: z.string().optional(),
    suggested: z.array(selectableEnergySchema).nullable().optional(),
  })
  .passthrough()
export type SnapshotProblem = z.infer<typeof snapshotProblemSchema>

export const snapshotSchema = z.object({
  id: z.number(),
  key: z.string(),
  label: z.string(),
  sourceType: z.enum(['deck_revision', 'tournament_list', 'text', 'lab']),
  sourceId: z.string().nullable(),
  deckId: z.string().nullable(),
  energies: z.array(z.string()),
  simulable: z.boolean(),
  problems: z.array(snapshotProblemSchema),
  remapped: z.array(z.object({ cardId: z.string(), playedAs: z.string() })),
  deckgymText: z.string(),
})
export type Snapshot = z.infer<typeof snapshotSchema>

export const jobProgressSchema = z.object({
  totalGames: z.number(),
  gamesDone: z.number(),
  chunks: z.object({ total: z.number(), done: z.number(), running: z.number(), failed: z.number() }),
  etaSeconds: z.number().nullable(),
})

export const jobSummarySchema = z.object({
  id: z.number(),
  kind: z.enum(SIMULATION_KINDS),
  status: z.enum(SIMULATION_STATUSES),
  label: z.string(),
  players: z.tuple([z.string(), z.string()]),
  playersEs: z.tuple([z.string(), z.string()]),
  gamesPerPair: z.number(),
  baseSeed: z.string(),
  engineRev: z.string(),
  replaySample: z.number(),
  createdAt: isoDate,
  startedAt: nullableDate,
  finishedAt: nullableDate,
  error: z.string().nullable(),
  progress: jobProgressSchema,
  /** Laboratorio (T-008): a test against the meta bank or an automatic search. */
  lab: z.enum(['test', 'explore']).nullable().default(null),
  /** Hidden from the list; its results still count. */
  archived: z.boolean().default(false),
})
export type JobSummary = z.infer<typeof jobSummarySchema>
export const jobsResponseSchema = z.object({
  items: z.array(jobSummarySchema),
  counts: z
    .object({ archived: z.number(), cancelled: z.number(), done: z.number() })
    .default({ archived: 0, cancelled: 0, done: 0 }),
})
export type JobsResponse = z.infer<typeof jobsResponseSchema>

// ---------- Laboratorio de mazos (T-008) ----------

export const metaScoreSchema = z.object({
  value: z.number(),
  ci95: z.tuple([z.number(), z.number()]),
  se: z.number(),
  games: z.number(),
  rivals: z.number(),
  coverage: z.number(),
})
export type MetaScore = z.infer<typeof metaScoreSchema>

const labCardSchema = z.object({ cardId: z.string(), nameEs: z.string(), count: z.number() })
export type LabCard = z.infer<typeof labCardSchema>

export const labBankSchema = z.object({
  era: z.string(),
  format: z.enum(TOURNAMENT_FORMATS),
  size: z.number(),
  lists: z.number(),
  coverage: z.number(),
  rivals: z.array(
    z.object({
      archetypeId: z.string(),
      archetypeName: z.string(),
      share: z.number(),
      weight: z.number(),
      listKey: z.string(),
      listLists: z.number(),
      listRate: winRateSchema.nullable(),
      rank: z.number(),
      /** T-017 D3: the archetype's second list (it shares the archetype's weight). */
      second: z.boolean().default(false),
      energies: z.array(z.string()),
      cards: z.array(labCardSchema),
    }),
  ),
  skipped: z.array(
    z.object({ archetypeId: z.string(), archetypeName: z.string(), share: z.number(), reason: z.string() }),
  ),
  engineRev: z.string(),
  attribution: z.string(),
})
export type LabBank = z.infer<typeof labBankSchema>

const labScoreSchema = z.object({ score: metaScoreSchema.nullable(), text: z.string() })

export const labDeckSchema = z.object({
  snapshot: z.number(),
  label: z.string(),
  deckId: z.string().nullable(),
  role: z.enum(['base', 'best', 'variant', 'deck']),
  round: z.number().nullable(),
  search: labScoreSchema,
  confirm: labScoreSchema.nullable(),
  /** T-017 A2: what its games say beyond the rate; null without per-game results. */
  games: z
    .object({
      games: z.number(),
      first: z.object({ wins: z.number(), games: z.number() }),
      second: z.object({ wins: z.number(), games: z.number() }),
      losses: z.object({ points: z.number(), noPokemon: z.number() }),
      ties: z.object({ turnLimit: z.number(), other: z.number() }),
      stages: z.tuple([z.number(), z.number(), z.number()]),
      /** Games in those chunks; `games` is how many carry per-game results. */
      total: z.number(),
      hasStage2: z.boolean(),
      firstRate: winRateSchema.nullable(),
      secondRate: winRateSchema.nullable(),
    })
    .nullable()
    .default(null),
  perRival: z.array(z.object({ rival: z.number(), record: gameRecordSchema, rate: winRateSchema.nullable() })),
  changes: z.object({ add: z.array(labCardSchema), remove: z.array(labCardSchema) }).nullable(),
  /** T-017 E1: against the list it came from, in its round. */
  vsParent: z
    .object({
      text: z.string(),
      value: z.number().nullable(),
      ci95: z.tuple([z.number(), z.number()]).nullable(),
      paired: z.boolean(),
      measuredIn: z.enum(['verify', 'round']).default('round'),
      complete: z.boolean().default(true),
      selectionText: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
  /** T-017 C6: the Energy Zone, when it is not the starting list's. */
  energyChange: z
    .object({ from: z.array(z.string()), to: z.array(z.string()) })
    .nullable()
    .default(null),
  /** T-017 E1/E2: why each card that came in was proposed, and the copies the collection lacks. */
  why: z
    .array(
      z.object({
        cardId: z.string(),
        nameEs: z.string(),
        eraShare: z.number().nullable(),
        archetypeShare: z.number().nullable(),
        missing: z.number(),
      }),
    )
    .default([]),
  novelty: z.object({
    kind: z.enum(['played', 'known', 'new']),
    label: z.string(),
    swaps: z.number().nullable(),
    closestArchetype: z.string().nullable(),
    closestLists: z.number(),
    nearbyLists: z.number(),
    nearbyEntries: z.number(),
  }),
  cards: z.array(labCardSchema),
  energies: z.array(z.string()),
  simulable: z.boolean(),
})
export type LabDeck = z.infer<typeof labDeckSchema>

export const EXPLORE_POOLS = ['collection', 'all'] as const
export type ExplorePool = (typeof EXPLORE_POOLS)[number]

const exploreConfigSchema = z.object({
  gamesPerRival: z.number(),
  variantsPerRound: z.number(),
  maxRounds: z.number(),
  patience: z.number(),
  confirmGames: z.number(),
  pool: z.enum(EXPLORE_POOLS),
  acceptZ: z.number(),
  /** H-010: games per rival of the verification round (0: none; absent in searches from before). */
  verifyGames: z.number().optional(),
  verifyZ: z.number().optional(),
})
export type ExploreConfig = z.infer<typeof exploreConfigSchema>

export const labJobSchema = z.object({
  job: jobSummarySchema,
  mode: z.enum(['test', 'explore']),
  era: z.string(),
  format: z.enum(TOURNAMENT_FORMATS),
  size: z.number(),
  rivals: z.array(
    z.object({
      snapshot: z.number().nullable(),
      label: z.string(),
      archetypeId: z.string(),
      archetypeName: z.string(),
      share: z.number(),
      weight: z.number(),
      listKey: z.string(),
      second: z.boolean().default(false),
    }),
  ),
  decks: z.array(labDeckSchema),
  explore: z
    .object({
      config: exploreConfigSchema,
      poolEs: z.string(),
      phase: z.enum(['search', 'confirm', 'done']),
      stopReason: z.string().nullable(),
      stopReasonEs: z.string().nullable(),
      /** T-017 D2: «Frenar y confirmar» was asked and the search is finishing what is in play. */
      stopRequested: z.boolean().default(false),
      base: z.number(),
      best: z.number(),
      roundsDone: z.number(),
      rounds: z.array(
        z.object({
          index: z.number(),
          kind: z.enum(['search', 'verify', 'confirm']),
          incumbent: z.number(),
          candidates: z.array(z.number()),
          accepted: z.number().nullable(),
          /** H-010: the search round's best variant that passed the screen and went to verification. */
          screened: z.number().nullable().default(null),
          decided: z.boolean(),
          /** T-017 D2: «Frenar y confirmar» cut this round short. */
          stopped: z.boolean().default(false),
        }),
      ),
      /** T-017 E2: archetype cards the search could not try because the collection has none. */
      leftOut: z.array(z.object({ cardId: z.string(), nameEs: z.string(), archetypeShare: z.number() })).default([]),
      /** T-017 C4: what the rounds measured about each card change, the clearest first. */
      learned: z
        .array(
          z.object({
            sign: z.enum(['+', '-']),
            cardId: z.string(),
            nameEs: z.string(),
            mean: z.number(),
            n: z.number(),
          }),
        )
        .default([]),
      combos: z.array(z.number()).default([]),
      reverts: z.array(z.number()).default([]),
      /** H-010: what the confirmation says of the list found against the starting one. */
      confirmation: z
        .object({
          verdict: z.enum(['better', 'unclear', 'worse']),
          verdictEs: z.string(),
          differenceText: z.string(),
        })
        .nullable()
        .default(null),
      locked: z.array(labCardSchema),
      /** Fase 16: the event whose rules every variant keeps. */
      event: z
        .object({ id: z.string(), name: z.string(), rules: z.array(z.string()) })
        .nullable()
        .default(null),
    })
    .nullable(),
  note: z.string(),
})
export type LabJob = z.infer<typeof labJobSchema>

export const labJobsSchema = z.object({
  items: z.array(jobSummarySchema.extend({ mode: z.enum(['test', 'explore']), era: z.string().nullable() })),
})
export type LabJobItem = z.infer<typeof labJobsSchema>['items'][number]

export type LabDeckSource =
  | { deckId: string; energies?: SelectableEnergy[] }
  | { listKey: string; era?: string; format?: TournamentFormat; energies?: SelectableEnergy[] }
  | { text: string; name?: string; energies?: SelectableEnergy[] }
  | { cards: { cardId: string; count: number }[]; energies: SelectableEnergy[]; name?: string }

export interface LabRunInput {
  size?: number
  era?: string
  players?: [string, string]
  seed?: number
  label?: string
  cores?: number
}

export interface LabTestInput extends LabRunInput {
  decks: LabDeckSource[]
  gamesPerRival?: number
}

export interface LabExploreInput extends LabRunInput {
  deck: LabDeckSource
  locked?: string[]
  config?: Partial<Omit<ExploreConfig, 'acceptZ' | 'verifyZ'>>
  /** Fase 16: keep this event's rules in every variant. */
  eventId?: string
}

export const labExplorePlanSchema = z.object({
  base: snapshotSchema.omit({ id: true }),
  bank: labBankSchema,
  pool: z.number(),
  firstRound: z.array(z.object({ add: z.array(labCardSchema), remove: z.array(labCardSchema) })),
  config: exploreConfigSchema,
  /** H-021: the plan's seed; starting with it plays these same first-round variants. */
  seed: z.number().optional(),
  games: z.object({ perRound: z.number(), max: z.number() }),
  estimatedSeconds: z.object({ perRound: z.number(), max: z.number() }),
})
export type LabExplorePlan = z.infer<typeof labExplorePlanSchema>

const simulationCellSchema = z.object({
  rival: z.number(),
  record: gameRecordSchema.nullable(),
  rate: winRateSchema.nullable(),
})
export const matrixRowSchema = z.object({
  snapshot: z.number(),
  total: gameRecordSchema,
  rate: winRateSchema.nullable(),
  cells: z.array(simulationCellSchema),
})
export type MatrixRow = z.infer<typeof matrixRowSchema>

export const optimizeRowSchema = z.object({
  cards: z.array(z.object({ engineId: z.string(), cardId: z.string().nullable(), nameEs: z.string() })),
  record: gameRecordSchema,
  rate: winRateSchema.nullable(),
  perEnemy: z.array(z.object({ snapshot: z.number(), record: gameRecordSchema, rate: winRateSchema.nullable() })),
})
export type OptimizeRow = z.infer<typeof optimizeRowSchema>

export const replaySummarySchema = z.object({
  id: z.number(),
  chunkId: z.number(),
  a: z.number().nullable(),
  b: z.number().nullable(),
  gameIndex: z.number(),
  seed: z.string(),
  winner: z.enum(['a', 'b', 'tie']),
  sizeBytes: z.number(),
})
export type ReplaySummary = z.infer<typeof replaySummarySchema>

const curvePointSchema = z.object({
  turn: z.number(),
  ready: z.number(),
  games: z.number(),
  value: z.number(),
  ci95: z.tuple([z.number(), z.number()]),
})
export type CurvePoint = z.infer<typeof curvePointSchema>
const curvesSchema = z.object({
  first: z.array(curvePointSchema),
  second: z.array(curvePointSchema),
  all: z.array(curvePointSchema),
})
export const consistencySchema = z.object({
  /** goldfish: against a rival that does nothing; meta: real games against the meta bank (D-019). */
  mode: z.enum(['goldfish', 'meta']).default('goldfish'),
  era: z.string().nullable().default(null),
  rivals: z.array(z.object({ label: z.string(), share: z.number(), games: z.number() })).default([]),
  deckId: z.string().nullable(),
  deck: z.string(),
  keyCards: z.array(z.object({ cardId: z.string(), nameEs: z.string() })),
  bot: z.string(),
  botEs: z.string(),
  maxTurn: z.number(),
  ready: curvesSchema,
  attack: curvesSchema,
  games: z.object({ first: z.number(), second: z.number(), all: z.number() }),
})
export type Consistency = z.infer<typeof consistencySchema>

export const jobDetailSchema = jobSummarySchema.extend({
  snapshots: z.array(snapshotSchema),
  sideA: z.array(z.number()),
  sideB: z.array(z.number()),
  rows: z.array(matrixRowSchema),
  optimize: z.array(optimizeRowSchema).nullable(),
  consistency: consistencySchema.nullable().default(null),
  replays: z.array(replaySummarySchema),
  chunks: z.array(
    z.object({
      id: z.number(),
      idx: z.number(),
      a: z.number().nullable(),
      b: z.number().nullable(),
      games: z.number(),
      gamesDone: z.number(),
      status: z.string(),
      seed: z.string(),
      attempt: z.number(),
      error: z.string().nullable(),
    }),
  ),
})
export type JobDetail = z.infer<typeof jobDetailSchema>

export const workerInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  engineRev: z.string().nullable(),
  cliVersion: z.string().nullable(),
  cores: z.number(),
  version: z.string().nullable(),
  lastSeenAt: isoDate,
  online: z.boolean(),
  current: z.object({ jobId: z.number(), chunkId: z.number(), gamesDone: z.number(), games: z.number() }).nullable(),
})
export type WorkerInfo = z.infer<typeof workerInfoSchema>

export const engineInfoSchema = z.object({
  engineRev: z.string(),
  cards: z.number(),
  incomplete: z.number(),
  source: z.enum(['worker', 'previous', 'fallback', 'none']),
  statusRev: z.string().nullable().default(null),
  /** deckgym-core's `main` against the pinned commit (T-010); null when not checked. */
  upstream: z
    .object({
      checkedAt: isoDate,
      pinned: z.string(),
      aheadBy: z.number(),
      latest: z.object({ sha: z.string(), date: z.string().nullable(), message: z.string() }).nullable(),
      compareUrl: z.string(),
    })
    .nullable()
    .default(null),
  workers: z.array(workerInfoSchema),
  bots: z.array(z.object({ code: z.string(), label: z.string() })),
})
export type EngineInfo = z.infer<typeof engineInfoSchema>

export const simulationPreviewSchema = z
  .object({
    sideA: z.array(snapshotSchema.extend({ id: z.number().optional() })),
    sideB: z.array(snapshotSchema.extend({ id: z.number().optional() })),
    pairings: z.number(),
    totalGames: z.number(),
    estimatedSeconds: z.number(),
  })
  .passthrough()
export type SimulationPreview = z.infer<typeof simulationPreviewSchema>

export type SimulationSource =
  | { deckId: string; energies?: SelectableEnergy[] }
  | { listKey: string; era?: string; format?: TournamentFormat; kind?: 'group' | 'name'; energies?: SelectableEnergy[] }

export interface SimulationInput {
  kind: QueueableSimulationKind
  label?: string
  sideA: SimulationSource[]
  sideB: SimulationSource[]
  gamesPerPair: number
  players: [string, string]
  seed?: number
  bothOrders?: boolean
  replaySample?: number
  cores?: number
  skipNotSimulable?: boolean
  optimize?: { remove: { cardId: string; count: number }[]; candidates: string[] }
}

export const replayResponseSchema = z.object({
  replay: z.unknown(),
  names: z.record(z.string(), z.string()),
  cardIds: z.record(z.string(), z.string()).default({}),
  game: z.object({
    jobId: z.number(),
    jobLabel: z.string(),
    engineRev: z.string(),
    gameIndex: z.number(),
    seed: z.string(),
    winner: z.enum(['a', 'b', 'tie']),
    decks: z.tuple([z.string().nullable(), z.string().nullable()]),
    playersEs: z.tuple([z.string(), z.string()]),
  }),
})
export type ReplayResponse = z.infer<typeof replayResponseSchema>

// ---------- Versión de torneo de un mazo ----------

const listChangeSchema = z.object({ groupId: z.string(), nameEs: z.string(), count: z.number() })

export const deckVersionSchema = z.object({
  deckId: z.string(),
  deckName: z.string(),
  archetype: archetypeRefSchema
    .extend({ source: z.enum(['owner', 'guessed']), swaps: z.number().nullable() })
    .nullable(),
  version: z
    .object({
      list: listRowSchema,
      swaps: z.number(),
      add: z.array(listChangeSchema),
      remove: z.array(listChangeSchema),
      missing: z.array(missingCopiesSchema),
      missingCopies: z.number(),
      alternatives: z.array(listRowSchema),
    })
    .nullable(),
})
export type DeckVersion = z.infer<typeof deckVersionSchema>
export const deckVersionDetailSchema = deckVersionSchema.extend({ scope: scopeSchema })
export const deckVersionsResponseSchema = z.object({ scope: scopeSchema, decks: z.array(deckVersionSchema) })

// ---------- Jugar contra un bot (Fase 8) ----------

export const LIVE_GAME_STATUSES = ['queued', 'running', 'waiting', 'done', 'abandoned', 'failed'] as const
export type LiveGameStatus = (typeof LIVE_GAME_STATUSES)[number]

export const liveDecisionSchema = z.object({
  ply: z.number(),
  turn: z.number(),
  state: z.record(z.string(), z.unknown()),
  actions: z.array(z.object({ i: z.number(), text: z.string(), action: z.unknown() })),
  /** Modo entrenador (Fase 20). */
  hintAvailable: z.boolean().default(false),
  hint: z.number().nullable().default(null),
})

export const COACH_VERDICTS = ['best', 'close', 'inaccuracy', 'mistake', 'blunder'] as const
export type CoachVerdict = (typeof COACH_VERDICTS)[number]
export const coachReviewSchema = z.object({
  ply: z.number(),
  turn: z.number(),
  options: z.number(),
  chosen: z.number(),
  best: z.number(),
  chosenText: z.string(),
  bestText: z.string(),
  gap: z.number(),
  rank: z.number(),
  verdict: z.enum(COACH_VERDICTS),
  hinted: z.boolean(),
  chosenAction: z.unknown().optional(),
  bestAction: z.unknown().optional(),
  ctx: z
    .object({ in_play: z.array(z.array(z.string().nullable())), stadium: z.string().nullable() })
    .nullable()
    .optional(),
})
export type CoachReview = z.infer<typeof coachReviewSchema>
export const coachSummarySchema = z.object({
  decisions: z.number(),
  counts: z.record(z.enum(COACH_VERDICTS), z.number()),
  agreement: z.number(),
  hints: z.number(),
  worst: z.array(coachReviewSchema),
})
export type CoachSummary = z.infer<typeof coachSummarySchema>
export type LiveDecision = z.infer<typeof liveDecisionSchema>

export const liveLogEntrySchema = z
  .object({
    ply: z.number().optional(),
    turn: z.number(),
    actor: z.number(),
    forced: z.boolean().optional(),
    text: z.string(),
    action: z.unknown(),
    ctx: z
      .object({
        in_play: z.array(z.array(z.string().nullable())).optional(),
        stadium: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
export type LiveLogEntry = z.infer<typeof liveLogEntrySchema>

export const liveGameSchema = z.object({
  id: z.number(),
  status: z.enum(LIVE_GAME_STATUSES),
  bot: z.string(),
  botEs: z.string(),
  seed: z.string(),
  engineRev: z.string(),
  human: z.object({ snapshot: z.number(), label: z.string(), deckId: z.string().nullable() }),
  rival: z.object({
    snapshot: z.number(),
    label: z.string(),
    deckId: z.string().nullable(),
    listKey: z.string().nullable(),
  }),
  decision: liveDecisionSchema.nullable(),
  log: z.array(liveLogEntrySchema),
  choices: z.number(),
  coach: z.boolean().default(false),
  coachReviews: z.array(coachReviewSchema).default([]),
  coachSummary: coachSummarySchema.nullable().default(null),
  /** Fase 22: engine id → catalog card id, both lists and the undos. */
  cardIds: z.record(z.string(), z.string()).default({}),
  decks: z
    .object({
      human: z.array(z.object({ engineId: z.string(), count: z.number() })),
      rival: z.array(z.object({ engineId: z.string(), count: z.number() })),
    })
    .default({ human: [], rival: [] }),
  undos: z.number().default(0),
  winner: z.enum(['you', 'bot', 'tie']).nullable(),
  turns: z.number().nullable(),
  finalState: z.record(z.string(), z.unknown()).nullable(),
  replay: z.boolean(),
  names: z.record(z.string(), z.string()),
  cards: z.record(z.string(), z.object({ id: z.string(), name: z.string() })),
  workerOnline: z.boolean(),
  error: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
  finishedAt: nullableDate,
})
export type LiveGame = z.infer<typeof liveGameSchema>

export const liveGamesSchema = z.object({
  items: z.array(
    z.object({
      id: z.number(),
      status: z.enum(LIVE_GAME_STATUSES),
      coach: z.boolean().default(false),
      botEs: z.string(),
      human: z.string(),
      rival: z.string(),
      winner: z.enum(['you', 'bot', 'tie']).nullable(),
      turns: z.number().nullable(),
      createdAt: isoDate,
      finishedAt: nullableDate,
    }),
  ),
})
export type LiveGameItem = z.infer<typeof liveGamesSchema>['items'][number]

export type PlaySource =
  | { deckId: string; energies?: SelectableEnergy[] }
  | { listKey: string; era?: string; format?: TournamentFormat; energies?: SelectableEnergy[] }

export interface PlayInput {
  human: PlaySource
  rival: PlaySource
  bot?: string
  seed?: number
  /** Modo entrenador (Fase 20). */
  coach?: boolean
}

// ---------- Avisos (Fase 8) ----------

export const alertsSchema = z.object({
  items: z.array(
    z.object({
      code: z.string(),
      level: z.enum(['info', 'warning']),
      title: z.string(),
      detail: z.string(),
      link: z.string().nullable(),
    }),
  ),
})
export type AlertItem = z.infer<typeof alertsSchema>['items'][number]

// ---------- Misiones (Fase 8) ----------

export const missionsSchema = z.object({
  total: z.number(),
  complete: z.number(),
  expansions: z.array(z.object({ id: z.string(), nameEs: z.string(), missions: z.number() })),
  items: z.array(
    z.object({
      expansionId: z.string(),
      expansionNameEs: z.string(),
      name: z.string(),
      reward: z.string().nullable(),
      secret: z.boolean(),
      complete: z.boolean(),
      missingCopies: z.number(),
      slots: z.array(
        z.object({
          amount: z.number(),
          have: z.number(),
          nameEs: z.string(),
          options: z.array(z.object({ cardId: z.string(), rarity: z.string().nullable() })),
        }),
      ),
    }),
  ),
})
export type Missions = z.infer<typeof missionsSchema>

// ---------- Mano inicial (Fase 10) ----------

export const drawOddsSchema = z.object({
  deck: z.object({ id: z.string(), name: z.string() }).nullable(),
  deckSize: z.number(),
  basics: z.number(),
  groups: z.array(
    z.object({
      cards: z.array(z.object({ groupId: z.string(), nameEs: z.string() })),
      copies: z.number(),
      basicCopies: z.number(),
    }),
  ),
  rows: z.array(
    z.object({ turn: z.number(), cardsSeen: z.number(), each: z.array(z.number()), all: z.number().nullable() }),
  ),
  basicsInHand: z.array(z.object({ count: z.number(), probability: z.number() })),
  note: z.string(),
})
export type DrawOdds = z.infer<typeof drawOddsSchema>

// ---------- Notas por rival (Fase 12) ----------

export const rivalNoteSchema = z.object({
  key: z.string(),
  label: z.string(),
  archetypeId: z.string().nullable(),
  text: z.string(),
  createdAt: isoDate,
  updatedAt: isoDate,
})
export type RivalNote = z.infer<typeof rivalNoteSchema>
export const rivalNotesSchema = z.object({ items: z.array(rivalNoteSchema) })
export const rivalNoteResponseSchema = z.object({ note: rivalNoteSchema.nullable() })

// ---------- ¿Qué mazo llevo hoy? (Fase 15) ----------

export const PICK_SORTS = ['tournament', 'matches', 'lab'] as const
export type PickSort = (typeof PICK_SORTS)[number]
export const pickSchema = z.object({
  sort: z.enum(PICK_SORTS),
  meta: z.object({ era: z.string(), kind: z.enum(['recent', 'era']), days: z.number(), lists: z.number() }).nullable(),
  items: z.array(
    z.object({
      deck: z.object({ id: z.string(), name: z.string() }),
      archetype: z.object({ id: z.string(), name: z.string(), source: z.enum(['owner', 'guessed']) }).nullable(),
      mine: z.object({ record: gameRecordSchema, rate: winRateSchema.nullable() }).nullable(),
      tournament: z
        .object({ value: z.number(), coverage: z.number(), matches: z.number(), rivals: z.number() })
        .nullable(),
      lab: z
        .object({
          value: z.number(),
          ci95: z.tuple([z.number(), z.number()]),
          games: z.number(),
          text: z.string(),
          jobId: z.number(),
          era: z.string(),
        })
        .nullable(),
    }),
  ),
  note: z.string(),
})
export type Pick = z.infer<typeof pickSchema>

// ---------- Eventos con restricciones (Fase 16) ----------

export const EVENT_TYPES = [
  'grass',
  'fire',
  'water',
  'lightning',
  'psychic',
  'fighting',
  'darkness',
  'metal',
  'dragon',
  'colorless',
] as const
export type EventType = (typeof EVENT_TYPES)[number]
export const eventRulesSchema = z.object({
  types: z.array(z.enum(EVENT_TYPES)).optional(),
  minOfType: z.object({ type: z.enum(EVENT_TYPES), count: z.number() }).optional(),
  noEx: z.boolean().optional(),
  rarities: z.array(z.string()).optional(),
  expansions: z.array(z.string()).optional(),
  banned: z.array(z.string()).optional(),
})
export type EventRules = z.infer<typeof eventRulesSchema>
export const eventSchema = z.object({
  id: z.string(),
  name: z.string(),
  startsOn: z.string().nullable(),
  endsOn: z.string().nullable(),
  rules: eventRulesSchema,
  rulesEs: z.array(z.string()),
  notes: z.string(),
  createdAt: isoDate,
  updatedAt: isoDate,
})
export type GameEvent = z.infer<typeof eventSchema>
export const eventsSchema = z.object({ items: z.array(eventSchema) })
export const eventDetailSchema = eventSchema.extend({
  decks: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      builtInGame: z.boolean(),
      ok: z.boolean(),
      problems: z.array(z.string()),
    }),
  ),
  lists: z.array(
    z.object({
      key: z.string(),
      archetype: z.string().nullable(),
      lists: z.number(),
      rate: winRateSchema.nullable(),
      missingCopies: z.number(),
      pokemon: z.array(z.string()),
    }),
  ),
  era: z.string().nullable(),
})
export type GameEventDetail = z.infer<typeof eventDetailSchema>
export interface EventInput {
  name: string
  startsOn?: string | null
  endsOn?: string | null
  rules: EventRules
  notes?: string
}

// ---------- Suerte de los sobres (Fase 17) ----------

const luckCheckSchema = z.object({
  games: z.number(),
  wins: z.number(),
  actual: z.number(),
  expected: z.number(),
  lowerTail: z.number(),
  upperTail: z.number(),
  verdict: z.enum(['too_few', 'normal', 'unlucky', 'lucky']),
})
const packLuckTierSchema = z.object({
  observed: z.number(),
  expectedShare: z.number(),
  expected: z.number(),
  check: luckCheckSchema,
})
export const packLuckSchema = z.object({
  gained: z.number(),
  byRarity: z.record(z.string(), z.number()),
  rare: packLuckTierSchema,
  ex: packLuckTierSchema,
  packsEstimate: z.number(),
  /** H-005: copies of versions printed in more than one expansion, left out. */
  ambiguous: z.number().default(0),
})
const importRefSchema = z.object({ id: z.string(), fileName: z.string(), appliedAt: z.string() })
export const packLuckViewSchema = z.object({
  imports: z.number(),
  intervals: z.array(z.object({ from: importRefSchema, to: importRefSchema, luck: packLuckSchema })),
  overall: z.object({ from: importRefSchema, to: importRefSchema, luck: packLuckSchema }).nullable(),
})
export type PackLuckView = z.infer<typeof packLuckViewSchema>

// ---------- Notificaciones (Fase 18) ----------

export const NOTIFICATION_KINDS = ['liveGame', 'simulations', 'lab', 'alerts', 'weekly'] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]
export const notificationsSchema = z.object({
  enabled: z.boolean(),
  publicKey: z.string().nullable(),
  devices: z.array(
    z.object({
      id: z.number(),
      userAgent: z.string(),
      createdAt: isoDate,
      lastSuccessAt: nullableDate,
      endpoint: z.string(),
    }),
  ),
  preferences: z.object({
    liveGame: z.boolean(),
    simulations: z.boolean(),
    lab: z.boolean(),
    alerts: z.boolean(),
    // Fase 32 (an older server does not send it).
    weekly: z.boolean().default(true),
  }),
})
export type NotificationsStatus = z.infer<typeof notificationsSchema>

// ---------- Armar desde un núcleo (Fase 19) ----------

export const labCoreSchema = z.object({
  era: z.string(),
  format: z.string(),
  pool: z.enum(['collection', 'all']),
  event: z.object({ id: z.string(), name: z.string() }).nullable(),
  basis: z.object({ kind: z.enum(['together', 'partial', 'era']), lists: z.number(), text: z.string() }),
  energies: z.array(selectableEnergySchema),
  cards: z.array(
    z.object({
      cardId: z.string(),
      groupId: z.string(),
      nameEs: z.string(),
      count: z.number(),
      reason: z.enum(['core', 'line', 'usage']),
      share: z.number().nullable(),
    }),
  ),
  left: z.array(z.object({ cardId: z.string(), nameEs: z.string(), reason: z.string() })),
  problems: z.array(z.string()),
  total: z.number(),
  attribution: z.string(),
})
export type LabCore = z.infer<typeof labCoreSchema>

export interface LabCoreInput {
  cards: string[]
  energies?: SelectableEnergy[]
  pool?: 'collection' | 'all'
  era?: string
  eventId?: string
}

// ---------- Listas de torneo para jugar (Fase 23) ----------

export const recentListsSchema = z.object({
  era: z.string(),
  format: z.string(),
  days: z.number(),
  from: nullableDate,
  to: nullableDate,
  attribution: z.string(),
  items: z.array(
    z.object({
      listKey: z.string(),
      archetypeId: z.string().nullable(),
      archetypeName: z.string().nullable(),
      tournamentId: z.string(),
      tournamentName: z.string(),
      date: isoDate,
      players: z.number(),
      playerName: z.string(),
      placing: z.number(),
      record: z.object({ wins: z.number(), losses: z.number(), ties: z.number() }),
      pilots: z.number(),
      energies: z.array(selectableEnergySchema),
      playable: z.boolean(),
      problem: z.string().nullable(),
    }),
  ),
})
export type RecentLists = z.infer<typeof recentListsSchema>

// ---------- Situaciones para resolver (Fase 24) ----------

export const puzzleItemSchema = z.object({
  id: z.string(),
  gameId: z.number(),
  step: z.number(),
  ply: z.number(),
  turn: z.number(),
  options: z.number(),
  verdict: z.enum(COACH_VERDICTS),
  gap: z.number(),
  human: z.string(),
  rival: z.string(),
  finishedAt: nullableDate,
  attempts: z.number(),
  solved: z.boolean(),
  lastVerdict: z.enum(COACH_VERDICTS).nullable(),
  lastAt: nullableDate,
})
export type PuzzleItem = z.infer<typeof puzzleItemSchema>
export const puzzleListSchema = z.object({
  items: z.array(puzzleItemSchema),
  counts: z.object({ total: z.number(), pending: z.number(), solved: z.number() }),
  coachGames: z.number(),
})
export const puzzleSchema = z.object({
  id: z.string(),
  gameId: z.number(),
  ply: z.number(),
  turn: z.number(),
  state: z.record(z.string(), z.unknown()),
  actions: z.array(z.object({ i: z.number(), text: z.string(), action: z.unknown() })),
  human: z.string(),
  rival: z.string(),
  names: z.record(z.string(), z.string()),
  cards: z.record(z.string(), z.object({ id: z.string(), name: z.string() })),
  cardIds: z.record(z.string(), z.string()),
  attempts: z.number(),
  solved: z.boolean(),
})
export type Puzzle = z.infer<typeof puzzleSchema>
export const puzzleAnswerSchema = z.object({
  answer: z.number(),
  verdict: z.enum(COACH_VERDICTS),
  gap: z.number(),
  rank: z.number(),
  best: z.number(),
  solved: z.boolean(),
  scores: z.array(z.number()),
  original: z.object({ chosen: z.number(), verdict: z.enum(COACH_VERDICTS), gap: z.number() }),
  attempts: z.number(),
  next: z.string().nullable(),
})
export type PuzzleAnswer = z.infer<typeof puzzleAnswerSchema>
