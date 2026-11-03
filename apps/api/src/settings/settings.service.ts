import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import type { Prisma } from '../generated/prisma/client.js'
import {
  HAND_EDITS_KEY,
  isPackSetting,
  lockPackSettings,
  POKEMON_ZONE_LOCK,
  recordHandEdit,
} from '../pokemon-zone/pack-settings.js'
import { isLockTimeout, isTransactionTimeout } from '../prisma/lock-errors.js'
import { PrismaService } from '../prisma/prisma.service.js'

/**
 * Keys of `app_settings` (PLAN §4.2): UI preferences plus the knobs of later phases, so the PWA can save them now.
 */
export const SETTING_KEYS = [
  'trackerFriendId',
  'trackerAutoSync',
  /** T-020: the daily sync with ptcgpocket.gg (off by default). The link itself is not a setting: see DotggLinkStore. */
  'dotggAutoSync',
  'ui',
  'alpha',
  'rarityFilter',
  'tradeableRarities',
  'rarityCosts',
  'minPlayers',
  'backfillDays',
  'cores',
  'defaultBot',
  'packModel',
  'limitedBoost',
  'packDeckTarget',
  /** { [expansionId]: pack points saved } (S-002, 8/10/2026). */
  'packPoints',
  /** Fase 14: packs opened a day and pack hourglasses saved, for «¿cuántos días me faltan?». */
  'packsPerDay',
  'hourglasses',
  /** Fase 44: the missions as a third goal of Sobres. */
  'packMissions',
  /** Fase 18: which notifications to send ({ liveGame, simulations, lab, alerts }). */
  'notifications',
  /** Fase 18: alerts already notified (keys), so each goes out once. */
  'notifiedAlerts',
] as const
export type SettingKey = (typeof SETTING_KEYS)[number]

/**
 * Rows of `app_settings` the server keeps for itself and `GET /api/settings` does not serve: the keyed fingerprint of
 * the ptcgpocket.gg link the last sync was read from (T-020; it travels in the backup so a restore can tell the links),
 * and when the pack points and hourglasses were changed by hand (Codex on #170, pokemon-zone/pack-settings.ts).
 */
export const SERVER_ONLY_SETTINGS: ReadonlySet<string> = new Set(['dotggLastAppliedLink', HAND_EDITS_KEY])

/** Room for a save of the pack settings once the pokemon-zone lock is taken. */
const PACK_SAVE_MS = 5_000

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(key)
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async all(): Promise<Record<string, unknown>> {
    const rows = await this.prisma.appSetting.findMany({ orderBy: { key: 'asc' } })
    return Object.fromEntries(
      rows.filter((row) => !SERVER_ONLY_SETTINGS.has(row.key)).map((row) => [row.key, row.value]),
    )
  }

  async set(key: string, value: unknown): Promise<{ key: string; value: unknown }> {
    if (key === 'trackerFriendId' && (typeof value !== 'string' || (value !== '' && !/^\d{16}$/.test(value)))) {
      throw new BadRequestException({ code: 'validation', message: 'Pegá el friend_id de 16 dígitos del tracker.' })
    }
    if ((key === 'trackerAutoSync' || key === 'dotggAutoSync') && typeof value !== 'boolean') {
      throw new BadRequestException({
        code: 'validation',
        message: 'La sincronización automática debe ser verdadera o falsa.',
      })
    }
    if (!isSettingKey(key)) {
      throw new BadRequestException({
        code: 'validation',
        message: `Clave de configuración desconocida: ${key}.`,
        details: { known: SETTING_KEYS },
      })
    }
    const json = JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
    // Codex on #170: the pack points and hourglasses are what a pokemon-zone import writes; a save by hand records,
    // per expansion, when it changed them, under the import's lock (the import reads both, or neither).
    const pack = isPackSetting(key)
    try {
      const row = await this.prisma.$transaction(
        async (tx) => {
          if (key === 'trackerAutoSync' || key === 'trackerFriendId' || key === 'dotggAutoSync')
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(994202)`
          if (pack) await lockPackSettings(tx)
          const before = pack ? await tx.appSetting.findUnique({ where: { key } }) : null
          const saved = await tx.appSetting.upsert({
            where: { key },
            create: { key, value: json },
            update: { value: json },
          })
          if (pack) await recordHandEdit(tx, key, before?.value, json, new Date())
          if ((key === 'trackerAutoSync' && value === false) || key === 'trackerFriendId')
            await tx.appSetting.deleteMany({ where: { key: 'trackerSyncWarning' } })
          if (key === 'dotggAutoSync' && value === false)
            await tx.appSetting.deleteMany({ where: { key: 'dotggSyncWarning' } })
          return saved
        },
        pack ? { timeout: POKEMON_ZONE_LOCK.waitMs + PACK_SAVE_MS } : {},
      )
      return { key: row.key, value: row.value }
    } catch (error) {
      if (pack && (isLockTimeout(error) || isTransactionTimeout(error))) {
        throw new ServiceUnavailableException({
          code: 'settings_busy',
          message: 'Hay una restauración del backup (o su prueba mensual) en curso: probá de nuevo en un rato.',
        })
      }
      throw error
    }
  }
}
