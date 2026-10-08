import { BadRequestException, Injectable } from '@nestjs/common'
import type { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'

/**
 * Keys of `app_settings` (PLAN §4.2): UI preferences plus the knobs of later phases, so the PWA can save them now.
 */
export const SETTING_KEYS = [
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
] as const
export type SettingKey = (typeof SETTING_KEYS)[number]

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(key)
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async all(): Promise<Record<string, unknown>> {
    const rows = await this.prisma.appSetting.findMany({ orderBy: { key: 'asc' } })
    return Object.fromEntries(rows.map((row) => [row.key, row.value]))
  }

  async set(key: string, value: unknown): Promise<{ key: string; value: unknown }> {
    if (!isSettingKey(key)) {
      throw new BadRequestException({
        code: 'validation',
        message: `Clave de configuración desconocida: ${key}.`,
        details: { known: SETTING_KEYS },
      })
    }
    const json = JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
    const row = await this.prisma.appSetting.upsert({
      where: { key },
      create: { key, value: json },
      update: { value: json },
    })
    return { key: row.key, value: row.value }
  }
}
