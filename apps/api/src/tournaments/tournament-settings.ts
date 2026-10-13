/**
 * What the tournament statistics depend on besides the data: the minimum size of a tournament (`app_settings`
 * `minPlayers`), the era table (`set_releases`, seeded with PLAN A.5 and edited by the owner) and the archetype
 * merges. `TournamentDataVersion` changes whenever any of it (or the data) changes, so cached datasets expire.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import { DEFAULT_MIN_PLAYERS, DEFAULT_SET_RELEASES, type SetRelease } from '@tcg/domain'
import { z } from 'zod'
import { ENV, type Env } from '../config/env.js'
import { dateOnly } from '../config/time-zone.js'
import { PrismaService } from '../prisma/prisma.service.js'

@Injectable()
export class TournamentDataVersion {
  private value = 0

  current(): number {
    return this.value
  }

  bump(): void {
    this.value += 1
  }
}

const minPlayersSchema = z.number().int().min(1).max(10_000)

@Injectable()
export class TournamentSettings implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly version: TournamentDataVersion,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Known releases are inserted once; the owner's edits are never overwritten (as with the pack switches). */
  async onModuleInit(): Promise<void> {
    // A CLI shares the database with the API that is running: this is the server's start-up work, not its own.
    if (this.env.cli) return
    await this.seedSets()
  }

  async seedSets(): Promise<void> {
    await this.prisma.setRelease.createMany({
      data: DEFAULT_SET_RELEASES.map((set) => ({
        code: set.code,
        nameEn: set.nameEn,
        releaseDate: new Date(`${set.releaseDate}T00:00:00Z`),
        opensEra: set.opensEra,
      })),
      skipDuplicates: true,
    })
  }

  async minPlayers(): Promise<number> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: 'minPlayers' } })
    const parsed = minPlayersSchema.safeParse(row?.value)
    return parsed.success ? parsed.data : DEFAULT_MIN_PLAYERS
  }

  async sets(): Promise<SetRelease[]> {
    const rows = await this.prisma.setRelease.findMany({ orderBy: [{ releaseDate: 'asc' }, { code: 'asc' }] })
    if (rows.length === 0) return [...DEFAULT_SET_RELEASES]
    return rows.map((row) => ({
      code: row.code,
      nameEn: row.nameEn,
      releaseDate: dateOnly(row.releaseDate) as string,
      opensEra: row.opensEra,
    }))
  }

  async saveSet(set: SetRelease): Promise<SetRelease> {
    const data = {
      nameEn: set.nameEn,
      releaseDate: new Date(`${set.releaseDate}T00:00:00Z`),
      opensEra: set.opensEra,
    }
    await this.prisma.setRelease.upsert({
      where: { code: set.code },
      create: { code: set.code, ...data },
      update: data,
    })
    this.version.bump()
    return set
  }

  async aliases(): Promise<Map<string, string>> {
    const rows = await this.prisma.archetypeAlias.findMany()
    return new Map(rows.map((row) => [row.archetypeId, row.canonicalId]))
  }

  /** Shows `archetypeId` as `canonicalId`; null removes the merge. */
  async setAlias(archetypeId: string, canonicalId: string | null): Promise<void> {
    if (canonicalId === null || canonicalId === archetypeId) {
      await this.prisma.archetypeAlias.deleteMany({ where: { archetypeId } })
    } else {
      // Merging into an archetype that is itself merged follows the chain to its end.
      const target = await this.prisma.archetypeAlias.findUnique({ where: { archetypeId: canonicalId } })
      const finalId = target?.canonicalId ?? canonicalId
      await this.prisma.archetypeAlias.upsert({
        where: { archetypeId },
        create: { archetypeId, canonicalId: finalId },
        update: { canonicalId: finalId },
      })
      await this.prisma.archetypeAlias.updateMany({
        where: { canonicalId: archetypeId },
        data: { canonicalId: finalId },
      })
    }
    this.version.bump()
  }
}
