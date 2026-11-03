/**
 * pokemon-zone (2/11/2026, docs/API.md «pokemon-zone»): the game's counters that the owner's browser reads from
 * pokemon-zone.com with a bookmarklet and hands to the app. The domain (`@tcg/domain` pokemonZone) checks and
 * normalizes them; this service keeps each import (a history: two imports say what happened between them), writes
 * what Sobres uses (pack points and pack hourglasses) and answers the summary the screens and the MCP tool read.
 *
 * The payload is never logged nor stored as sent: only the normalized snapshot, and a keyed fingerprint of the
 * account (to tell an import of another account). The friend id never gets here: the bookmarklet sends its SHA-256.
 */
import { createHash, createHmac, hkdfSync } from 'node:crypto'
import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import {
  type BattlesBetween,
  battlesBetween,
  type GameBattles,
  gameBattles,
  type HourglassesUpdate,
  hourglassesUpdate,
  type LoggedComparison,
  loggedComparison,
  type PackPointsChange,
  type PokemonZoneLuck,
  type PokemonZonePayload,
  type PokemonZoneSnapshot,
  type PromoCouponStatus,
  packPointsUpdate,
  parsePokemonZone,
  pokemonZoneLuck,
  pokemonZoneSnapshotSchema,
  promoCoupons,
  samePackPoints,
} from '@tcg/domain'
import { z } from 'zod'
import { CatalogService } from '../catalog/catalog.service.js'
import { ENV, type Env } from '../config/env.js'
import type { PokemonZoneImport, Prisma } from '../generated/prisma/client.js'
import { idToString } from '../http/ids.js'
import { ADVISORY_LOCKS } from '../prisma/advisory-locks.js'
import { PrismaService } from '../prisma/prisma.service.js'

const IMPORT_LOCK = ADVISORY_LOCKS.pokemonZoneImport
/** Rows read to find the newest one that parses. */
const READ_AHEAD = 5
/** The first day of the game (TCG Pocket, 30/10/2024): an earlier read of it is not one. */
const GAME_LAUNCH = Date.parse('2024-10-30T00:00:00Z')
/** pokemon-zone's clock against ours: a read up to a day ahead passes, a later one is refused. */
const CLOCK_SLACK_MS = 24 * 60 * 60 * 1000

/**
 * The payload as an import keeps it, or a 400: what is saved reads back with its own schema, and its read of the game
 * is between the game's launch and tomorrow (a read dated in the future would make every real import «older»).
 */
function checkedSnapshot(payload: PokemonZonePayload, now: Date): PokemonZoneSnapshot {
  let snapshot: PokemonZoneSnapshot
  try {
    snapshot = parsePokemonZone(payload)
  } catch (error) {
    const issues = error instanceof z.ZodError ? error.issues : []
    throw new BadRequestException({
      code: 'validation',
      message: 'Los datos de pokemon-zone no tienen la forma esperada.',
      details: issues.slice(0, 20).map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    })
  }
  const read = Date.parse(snapshot.syncedAt)
  if (read < GAME_LAUNCH || read > now.getTime() + CLOCK_SLACK_MS) {
    throw new BadRequestException({
      code: 'validation',
      message: 'La fecha en que pokemon-zone leyó el juego no es posible (antes del juego o en el futuro).',
      details: [{ path: 'stats.syncedAt', message: 'fecha fuera de rango' }],
    })
  }
  return snapshot
}

/** The settings an import writes (their bounds are packs.service.ts'). */
const packPointsSetting = z.record(z.string(), z.number().int().min(0).max(1_000_000))
const hourglassesSetting = z.number().int().min(0).max(100_000)

/** What an import wrote to the settings, as `pokemon_zone_imports.applied` keeps it. */
const appliedSchema = z.object({
  packPoints: packPointsSetting.optional(),
  hourglasses: hourglassesSetting.optional(),
})
type Applied = z.infer<typeof appliedSchema>

export interface PokemonZoneImportRef {
  id: string
  importedAt: string
  /** When pokemon-zone last read the game. */
  syncedAt: string
}

export type PackPointsChangeView = PackPointsChange & { nameEs: string | null }

export interface PokemonZonePreview {
  syncedAt: string
  level: number | null
  /** «first»: there is no import yet; «same»: the same game account as the latest; «other»: another one. */
  account: 'first' | 'same' | 'other'
  /** The same numbers as an import already saved. */
  duplicate: boolean
  /** Older than the latest import of the account: it is kept, but it does not change the settings. */
  older: boolean
  packPoints: { changes: PackPointsChangeView[]; unchanged: number }
  hourglasses: HourglassesUpdate | null
  coupons: PromoCouponStatus[]
  battles: GameBattles
  totals: PokemonZoneSnapshot['totals']
  /** Since the latest import of the account with an earlier read of the game (real counts). */
  since: { from: PokemonZoneImportRef; packs: number; cards: number } | null
}

export interface PokemonZoneSaved {
  import: PokemonZoneImportRef
  /** An import with the same numbers was there already: it was not stored again. */
  duplicate: boolean
  /** What the settings of Sobres got; null when the import is older than the latest one. */
  applied: { packPoints: number; hourglasses: HourglassesUpdate | null } | null
}

export interface PokemonZoneLatest extends PokemonZoneImportRef {
  level: number | null
  packPoints: Record<string, number>
  hourglasses: PokemonZoneSnapshot['hourglasses']
  currencies: PokemonZoneSnapshot['currencies']
  coupons: PromoCouponStatus[]
  totals: PokemonZoneSnapshot['totals']
}

/** Whether a setting still holds what the latest import wrote, was edited afterwards, or the import did not write it. */
export type SettingOrigin = 'imported' | 'edited' | null

export interface LoggedCounts {
  all: number
  competitive: number
}

export interface PokemonZoneBattlesView {
  /** The game's counters, lifetime (real). */
  game: GameBattles
  /** Matches logged in the app, ever, and since when. */
  logged: LoggedCounts & { firstAt: string | null }
  lifetime: LoggedComparison[]
  /** Between the two latest imports of the account: what the game counted and what was logged in the app. */
  window: {
    from: string
    to: string
    game: BattlesBetween
    logged: LoggedCounts
    comparison: LoggedComparison[]
  } | null
}

export interface PokemonZoneSummary {
  imports: number
  latest: PokemonZoneLatest | null
  previous: PokemonZoneImportRef | null
  settings: { packPoints: SettingOrigin; hourglasses: SettingOrigin }
  battles: PokemonZoneBattlesView | null
  /** Null when the catalog is not loaded. `since` is null without a previous import or when a count went down. */
  luck: { lifetime: PokemonZoneLuck | null; since: PokemonZoneLuck | null } | null
}

interface StoredImport {
  row: Pick<PokemonZoneImport, 'id' | 'importedAt' | 'syncedAt' | 'account'>
  snapshot: PokemonZoneSnapshot
  applied: Applied
}

const SELECT = {
  id: true,
  importedAt: true,
  syncedAt: true,
  account: true,
  data: true,
  applied: true,
} as const

type Reader = Pick<Prisma.TransactionClient, 'pokemonZoneImport' | 'appSetting'>

@Injectable()
export class PokemonZoneService {
  private readonly accountKey: Buffer

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    @Inject(ENV) env: Env,
  ) {
    this.accountKey = Buffer.from(
      hkdfSync('sha256', env.sessionSecret, 'tcg-pocket', 'tcg-pocket/pokemon-zone-account', 32),
    )
  }

  /**
   * Which game account an import is of: the bookmarklet's SHA-256 of the friend id under an HMAC-SHA256 with a key
   * derived from SESSION_SECRET for this purpose only (the backup carries it; a plain hash of a 16-digit id could be
   * checked against guesses, this cannot without the server's key).
   */
  account(accountHash: string): string {
    return createHmac('sha256', this.accountKey).update(accountHash).digest('hex')
  }

  /** What saving this payload would do; writes nothing. */
  async preview(payload: PokemonZonePayload, now: Date = new Date()): Promise<PokemonZonePreview> {
    const snapshot = checkedSnapshot(payload, now)
    const account = this.account(payload.mine.player.accountHash)
    return this.plan(this.prisma, snapshot, account)
  }

  /** Stores the import (once: the same numbers saved again are the same row) and writes the settings of Sobres. */
  async save(payload: PokemonZonePayload, now: Date = new Date()): Promise<PokemonZoneSaved> {
    const snapshot = checkedSnapshot(payload, now)
    const account = this.account(payload.mine.player.accountHash)
    const sha256 = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
    const syncedAt = new Date(snapshot.syncedAt)
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${IMPORT_LOCK}::bigint)`
      // A manual edit of these settings (PUT /api/settings) that commits in between is read, not overwritten: the rows
      // stay locked until this transaction ends.
      await tx.$queryRaw`SELECT key FROM app_settings WHERE key IN ('packPoints', 'hourglasses') FOR UPDATE`
      const plan = await this.plan(tx, snapshot, account)
      const applied: Applied = {}
      if (!plan.older) {
        const settings = await this.currentSettings(tx)
        const points = packPointsUpdate(settings.packPoints, snapshot)
        applied.packPoints = points.next
        await this.writeSetting(tx, 'packPoints', points.next)
        if (plan.hourglasses) {
          applied.hourglasses = plan.hourglasses.after
          await this.writeSetting(tx, 'hourglasses', plan.hourglasses.after)
        }
      }
      const unique = { account_syncedAt_sha256: { account, syncedAt, sha256 } }
      const existing = await tx.pokemonZoneImport.findUnique({ where: unique, select: { id: true } })
      const row = existing
        ? await tx.pokemonZoneImport.update({
            where: { id: existing.id },
            // A duplicate saved again («Guardar» once more) rewrites the settings, so it records what it wrote.
            data: plan.older ? {} : { applied: applied as Prisma.InputJsonValue },
            select: { id: true, importedAt: true, syncedAt: true },
          })
        : await tx.pokemonZoneImport.create({
            data: {
              syncedAt,
              account,
              sha256,
              data: snapshot as unknown as Prisma.InputJsonValue,
              applied: applied as Prisma.InputJsonValue,
            },
            select: { id: true, importedAt: true, syncedAt: true },
          })
      return {
        import: ref(row),
        duplicate: existing !== null,
        applied: plan.older ? null : { packPoints: plan.packPoints.changes.length, hourglasses: plan.hourglasses },
      }
    })
  }

  /** The latest import, the comparison with the previous one and with the matches logged, and the luck of the packs. */
  async summary(): Promise<PokemonZoneSummary> {
    const [imports, latest] = await Promise.all([this.prisma.pokemonZoneImport.count(), this.latest(this.prisma)])
    if (!latest) {
      return {
        imports,
        latest: null,
        previous: null,
        settings: { packPoints: null, hourglasses: null },
        battles: null,
        luck: null,
      }
    }
    const [previous, settings, logged, firstMatch] = await Promise.all([
      this.previousOf(this.prisma, latest.row.account, latest.row.syncedAt),
      this.currentSettings(this.prisma),
      this.loggedBetween(null, latest.row.syncedAt),
      this.prisma.match.findFirst({ orderBy: { playedAt: 'asc' }, select: { playedAt: true } }),
    ])
    const { snapshot } = latest
    const window = previous ? battlesBetween(previous.snapshot, snapshot) : null
    const windowLogged =
      previous && window ? await this.loggedBetween(previous.row.syncedAt, latest.row.syncedAt) : null
    const index = this.catalog.loaded ? this.catalog.requireIndex() : null
    return {
      imports,
      latest: this.latestView(latest),
      previous: previous ? ref(previous.row) : null,
      settings: {
        packPoints:
          latest.applied.packPoints === undefined
            ? null
            : samePackPoints(latest.applied.packPoints, settings.packPoints)
              ? 'imported'
              : 'edited',
        hourglasses:
          latest.applied.hourglasses === undefined
            ? null
            : latest.applied.hourglasses === settings.hourglasses
              ? 'imported'
              : 'edited',
      },
      battles: {
        game: gameBattles(snapshot),
        logged: { ...logged, firstAt: firstMatch?.playedAt.toISOString() ?? null },
        lifetime: loggedComparison(snapshot.battles, logged),
        window:
          previous && window && windowLogged
            ? {
                from: previous.row.syncedAt.toISOString(),
                to: latest.row.syncedAt.toISOString(),
                game: window,
                logged: windowLogged,
                comparison: loggedComparison(window, windowLogged),
              }
            : null,
      },
      luck: index
        ? {
            lifetime: pokemonZoneLuck(snapshot, null, index),
            since: previous ? pokemonZoneLuck(snapshot, previous.snapshot, index) : null,
          }
        : null,
    }
  }

  /** The promo coupons of the latest import (Sobres de promoción); null without imports. */
  async coupons(
    now: Date = new Date(),
  ): Promise<{ importedAt: string; syncedAt: string; items: PromoCouponStatus[] } | null> {
    const latest = await this.latest(this.prisma)
    if (!latest) return null
    return {
      importedAt: latest.row.importedAt.toISOString(),
      syncedAt: latest.row.syncedAt.toISOString(),
      items: promoCoupons(latest.snapshot, now),
    }
  }

  // ---------------------------------------------------------------------------------------------------------------

  private async plan(db: Reader, snapshot: PokemonZoneSnapshot, account: string): Promise<PokemonZonePreview> {
    const syncedAt = new Date(snapshot.syncedAt)
    const sha256 = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
    const existing = await db.pokemonZoneImport.findUnique({
      where: { account_syncedAt_sha256: { account, syncedAt, sha256 } },
      select: { id: true },
    })
    const [latest, newer, previous, settings] = await Promise.all([
      db.pokemonZoneImport.findFirst({ orderBy: [{ syncedAt: 'desc' }, { id: 'desc' }], select: { account: true } }),
      // Review of pz/import: older than any import, of any account, in the order of the summary's `latest` (newest
      // read, then the latest saved). The settings follow that same import, so «imported» or «edited» stays true. A
      // new import ranks after every saved one with its read; a duplicate keeps its row, so another import with the
      // same read saved after it is newer (Codex on #170).
      db.pokemonZoneImport.count({
        where: {
          OR: [{ syncedAt: { gt: syncedAt } }, ...(existing ? [{ syncedAt, id: { gt: existing.id } }] : [])],
        },
      }),
      this.previousOf(db, account, syncedAt),
      this.currentSettings(db),
    ])
    const points = packPointsUpdate(settings.packPoints, snapshot)
    const expansions = this.catalog.loaded ? this.catalog.requireIndex() : null
    const since = previous ? pokemonZoneSince(previous.snapshot, snapshot) : null
    return {
      syncedAt: snapshot.syncedAt,
      level: snapshot.level,
      account: latest === null ? 'first' : latest.account === account ? 'same' : 'other',
      duplicate: existing !== null,
      older: newer > 0,
      packPoints: {
        changes: points.changes.map((change) => ({
          ...change,
          nameEs: expansions?.expansionById(change.expansionId)?.nameEs ?? null,
        })),
        unchanged: points.unchanged,
      },
      hourglasses: hourglassesUpdate(settings.hourglasses, snapshot),
      coupons: promoCoupons(snapshot, new Date()),
      battles: gameBattles(snapshot),
      totals: snapshot.totals,
      since: previous && since ? { from: ref(previous.row), ...since } : null,
    }
  }

  private latestView(stored: StoredImport): PokemonZoneLatest {
    const { snapshot } = stored
    return {
      ...ref(stored.row),
      level: snapshot.level,
      packPoints: snapshot.packPoints,
      hourglasses: snapshot.hourglasses,
      currencies: snapshot.currencies,
      coupons: promoCoupons(snapshot, new Date()),
      totals: snapshot.totals,
    }
  }

  /** The import with the newest read of the game (the latest saved breaks a tie). */
  private async latest(db: Reader): Promise<StoredImport | null> {
    return this.firstReadable(db, {})
  }

  /** The latest import of the account with an earlier read of the game than `before`. */
  private async previousOf(db: Reader, account: string, before: Date): Promise<StoredImport | null> {
    return this.firstReadable(db, { account, syncedAt: { lt: before } })
  }

  /**
   * The newest import that reads back with the snapshot's schema. Every save checks it, so this only skips a row of a
   * future schema change; a few rows at a time, never the whole table.
   */
  private async firstReadable(db: Reader, where: Prisma.PokemonZoneImportWhereInput): Promise<StoredImport | null> {
    const rows = await db.pokemonZoneImport.findMany({
      where,
      orderBy: [{ syncedAt: 'desc' }, { id: 'desc' }],
      take: READ_AHEAD,
      select: SELECT,
    })
    for (const row of rows) {
      const item = stored(row)
      if (item) return item
    }
    return null
  }

  /** Matches logged with `playedAt` in (from, to]: every one and the competitive ones. */
  private async loggedBetween(from: Date | null, to: Date): Promise<LoggedCounts> {
    const groups = await this.prisma.match.groupBy({
      by: ['mode'],
      where: { playedAt: from ? { gt: from, lte: to } : { lte: to } },
      _count: { _all: true },
    })
    return {
      all: groups.reduce((sum, group) => sum + group._count._all, 0),
      competitive: groups.find((group) => group.mode === 'competitive')?._count._all ?? 0,
    }
  }

  /** `packPoints` and `hourglasses` as Sobres reads them: a value that does not parse counts as not set. */
  private async currentSettings(db: Reader): Promise<{ packPoints: Record<string, number>; hourglasses: number }> {
    const rows = await db.appSetting.findMany({ where: { key: { in: ['packPoints', 'hourglasses'] } } })
    const value = (key: string) => rows.find((row) => row.key === key)?.value
    const points = packPointsSetting.safeParse(value('packPoints'))
    const hourglasses = hourglassesSetting.safeParse(value('hourglasses'))
    return { packPoints: points.success ? points.data : {}, hourglasses: hourglasses.success ? hourglasses.data : 0 }
  }

  private async writeSetting(tx: Prisma.TransactionClient, key: string, value: unknown): Promise<void> {
    const json = value as Prisma.InputJsonValue
    await tx.appSetting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } })
  }
}

/** Packs opened and cards obtained between two imports (real), or null when a count went down. */
export function pokemonZoneSince(
  previous: Pick<PokemonZoneSnapshot, 'totals'>,
  current: Pick<PokemonZoneSnapshot, 'totals'>,
): { packs: number; cards: number } | null {
  const diff = (after: number | null, before: number | null) =>
    after === null || before === null ? null : after - before
  const packs = diff(current.totals.packsOpened, previous.totals.packsOpened)
  const cards = diff(current.totals.cardsObtained, previous.totals.cardsObtained)
  if (packs === null || cards === null || packs < 0 || cards < 0) return null
  return { packs, cards }
}

function ref(row: { id: number; importedAt: Date; syncedAt: Date }): PokemonZoneImportRef {
  return { id: idToString(row.id), importedAt: row.importedAt.toISOString(), syncedAt: row.syncedAt.toISOString() }
}

function stored(row: {
  id: number
  importedAt: Date
  syncedAt: Date
  account: string
  data: unknown
  applied: unknown
}): StoredImport | null {
  const snapshot = pokemonZoneSnapshotSchema.safeParse(row.data)
  if (!snapshot.success) return null
  const applied = appliedSchema.safeParse(row.applied)
  return {
    row: { id: row.id, importedAt: row.importedAt, syncedAt: row.syncedAt, account: row.account },
    snapshot: snapshot.data,
    applied: applied.success ? applied.data : {},
  }
}
