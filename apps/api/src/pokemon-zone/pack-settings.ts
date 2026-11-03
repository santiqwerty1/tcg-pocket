/**
 * The two settings of Sobres a pokemon-zone import writes (`packPoints`, `hourglasses`), and when Santi changed them by
 * hand (Codex on #170): `PUT /api/settings` records it here, per expansion for the points, under the import's lock; the
 * import reads it to keep what was changed by hand after its read of the game. An import's own writes are not recorded.
 */
import { type HandEdits, parseHandEdits, recordHourglassesEdit, recordPointsEdit } from '@tcg/domain'
import { z } from 'zod'
import type { Prisma } from '../generated/prisma/client.js'
import { ADVISORY_LOCKS } from '../prisma/advisory-locks.js'

/** The settings an import writes (their bounds are packs.service.ts'). */
export const packPointsSetting = z.record(z.string(), z.number().int().min(0).max(1_000_000))
export const hourglassesSetting = z.number().int().min(0).max(100_000)

export type PackSettingKey = 'packPoints' | 'hourglasses'

export function isPackSetting(key: string): key is PackSettingKey {
  return key === 'packPoints' || key === 'hourglasses'
}

/**
 * The server-only `app_settings` row with the `HandEdits` (GET /api/settings does not serve it; it travels in the
 * backup with the imports it is compared with).
 */
export const HAND_EDITS_KEY = 'packHandEdits'

/**
 * How long an import, or a hand save of these settings, waits for the lock (a restore or the monthly drill holds it up
 * to their 120 s): past it, a 503. Tests lower it.
 */
export const POKEMON_ZONE_LOCK = { waitMs: 30_000 }

/** The pokemon-zone lock, waited for at most `POKEMON_ZONE_LOCK.waitMs` (then Postgres' lock timeout, 55P03). */
export async function lockPackSettings(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${POKEMON_ZONE_LOCK.waitMs}ms`}, true)`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCKS.pokemonZoneImport}::bigint)`
}

/** A stored setting as Sobres reads it: a value that does not parse counts as not set. */
export function packPointsOf(value: unknown): Record<string, number> {
  const parsed = packPointsSetting.safeParse(value)
  return parsed.success ? parsed.data : {}
}

export function hourglassesOf(value: unknown): number {
  const parsed = hourglassesSetting.safeParse(value)
  return parsed.success ? parsed.data : 0
}

export async function readHandEdits(db: Pick<Prisma.TransactionClient, 'appSetting'>): Promise<HandEdits> {
  const row = await db.appSetting.findUnique({ where: { key: HAND_EDITS_KEY } })
  return parseHandEdits(row?.value)
}

/**
 * A save by hand of `key` (the stored value `before` and `after`), at `at`: what it changed takes that time. Inside
 * the save's transaction, after `lockPackSettings`, so an import reads either the save and its time or neither.
 */
export async function recordHandEdit(
  tx: Prisma.TransactionClient,
  key: PackSettingKey,
  before: unknown,
  after: unknown,
  at: Date,
): Promise<void> {
  const edits = await readHandEdits(tx)
  const next =
    key === 'packPoints'
      ? recordPointsEdit(edits, packPointsOf(before), packPointsOf(after), at)
      : recordHourglassesEdit(edits, hourglassesOf(before), hourglassesOf(after), at)
  if (next === edits) return
  const value = next as unknown as Prisma.InputJsonValue
  await tx.appSetting.upsert({
    where: { key: HAND_EDITS_KEY },
    create: { key: HAND_EDITS_KEY, value },
    update: { value },
  })
}
