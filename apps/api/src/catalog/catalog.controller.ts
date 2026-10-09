import { Body, ConflictException, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common'
import type { CardEdition } from '@tcg/domain'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { ENV, type Env } from '../config/env.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { CatalogService, type CatalogStatus } from './catalog.service.js'
import { type CatalogPreview, CatalogSyncService } from './catalog-sync.service.js'
import type { CardSearchHit, CardSummary, ExpansionView, GroupDetail } from './catalog-views.js'
import { type TrackerCommit, TrackerCommitsService, type TrackerComparison } from './tracker-commits.service.js'

const gitSha = z.string().regex(/^[0-9a-f]{40}$/, 'debe ser un sha completo de 40 caracteres')

const syncSchema = z.object({
  commit: gitSha.optional(),
  engineRev: gitSha.optional(),
  /** Reads packages/domain/test/fixtures instead of GitHub (offline). */
  fromFixtures: z.boolean().optional(),
  /** Fase 40: apply even if it takes the owner's cards away or goes back to an older commit (after the preview). */
  confirm: z.boolean().optional(),
})

const previewSchema = z.object({
  /** Default: the newest commit of the tracker's main. */
  commit: gitSha.optional(),
  engineRev: gitSha.optional(),
  fromFixtures: z.boolean().optional(),
})

const searchSchema = z.object({
  q: z.string().trim().max(200).optional(),
  lang: z.enum(['es', 'en', 'any']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(20),
  expansion: z.string().trim().max(10).optional(),
})

const batchSchema = z.object({
  ids: z
    .string()
    .max(2000)
    .refine((value) => value.split(',').length <= 80, 'hasta 80 cartas'),
})

/** Session-protected read API over the in-memory catalog, plus the manual sync trigger (docs/API.md). */
@Controller('api')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly sync: CatalogSyncService,
    private readonly commits: TrackerCommitsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Fase 40: the tracker's newest commit and where it stands against the loaded one (`ahead` = there is something
   * new). `latest: null` with `error` when GitHub does not answer.
   */
  @Get('catalog/latest')
  async latest(@CurrentSession() _session: RequestSession): Promise<{
    current: string | null
    latest: TrackerCommit | null
    comparison: TrackerComparison | null
    error: string | null
  }> {
    const current = this.catalog.trackerCommit
    try {
      const latest = await this.commits.latest()
      const comparison = current && current !== latest.sha ? await this.commits.compare(current, latest.sha) : null
      return {
        current,
        latest,
        comparison: comparison ?? (current === latest.sha ? { status: 'identical', aheadBy: 0, behindBy: 0 } : null),
        error: null,
      }
    } catch (error) {
      return { current, latest: null, comparison: null, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Fase 40: what syncing a commit would change (cards, sets, the owner's data, what the engine plays), nothing
   * written. Without `commit`, the tracker's newest. Takes a few seconds (it downloads the tracker's files).
   */
  @Post('catalog/preview')
  @HttpCode(200)
  async preview(
    @Body(new ZodValidationPipe(previewSchema)) body: z.infer<typeof previewSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<CatalogPreview & { older: boolean }> {
    const commit = body.commit ?? (body.fromFixtures ? this.env.catalogCommit : (await this.commits.latest()).sha)
    const preview = await this.sync.preview({
      trackerCommit: commit,
      engineRev: body.engineRev ?? this.catalog.engineRev ?? this.env.engineRev,
      source: body.fromFixtures ? 'fixtures' : 'github',
    })
    const older = await this.isOlder(commit)
    return { ...preview, older, destructive: preview.destructive || older }
  }

  /** The commit is behind the loaded one on the tracker (going back); false when unknown or GitHub does not answer. */
  private async isOlder(commit: string): Promise<boolean> {
    const current = this.catalog.trackerCommit
    if (!current || current === commit) return false
    try {
      return (await this.commits.compare(current, commit)).status === 'behind'
    } catch {
      return false
    }
  }

  /**
   * `syncRunning`: a sync is still working — its row says «applied» once the tables are written, but the in-memory
   * catalog is reloaded right after, and a new sync is refused (409) until then.
   */
  @Get('catalog/status')
  async status(@CurrentSession() _session: RequestSession): Promise<CatalogStatus & { syncRunning: boolean }> {
    return { ...(await this.catalog.status()), syncRunning: this.sync.isRunning }
  }

  /**
   * Starts a sync in the background; follow it through `GET /api/catalog/status`. 409 while one is running.
   * H-004 (Fase 40): without `commit`, the loaded commit again (never back to the configured pin). Going back to an
   * older commit, or a sync that would take the owner's cards away, needs `confirm: true` (409 `confirm_required`,
   * or the sync row fails saying so, before writing anything).
   */
  @Post('catalog/sync')
  @HttpCode(202)
  async runSync(
    @Body(new ZodValidationPipe(syncSchema)) body: z.infer<typeof syncSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<{ syncId: number }> {
    const commit = body.commit ?? this.catalog.trackerCommit ?? this.env.catalogCommit
    if (!body.confirm && !body.fromFixtures && (await this.isOlder(commit))) {
      throw new ConflictException({
        code: 'confirm_required',
        message:
          'Ese commit del tracker es anterior al cargado: volver atrás puede sacar cartas de la colección y de los mazos. Mirá la vista previa y confirmalo.',
      })
    }
    return this.sync.start({
      trackerCommit: commit,
      engineRev: body.engineRev ?? this.catalog.engineRev ?? this.env.engineRev,
      source: body.fromFixtures ? 'fixtures' : 'github',
      guard: true,
      confirm: body.confirm ?? false,
    })
  }

  @Get('expansions')
  expansions(@CurrentSession() _session: RequestSession): { items: ExpansionView[] } {
    return { items: this.catalog.expansions() }
  }

  /** `?q=` searches ids, names (accent-insensitive) and rules text; `?expansion=` lists a set when `q` is absent. */
  @Get('cards')
  cards(
    @Query(new ZodValidationPipe(searchSchema)) query: z.infer<typeof searchSchema>,
    @CurrentSession() _session: RequestSession,
  ): { items: CardSearchHit[] } | { items: CardSummary[]; total: number } {
    if (query.q) return { items: this.catalog.search(query.q, { lang: query.lang, limit: query.limit }) }
    if (query.expansion) {
      const cards = this.catalog.cardsOfExpansion(query.expansion)
      return { items: cards.slice(0, query.limit), total: cards.length }
    }
    return { items: [] }
  }

  /** Fase 22: several editions at once (the cards of a game or a replay), unknown ids left out. */
  @Get('cards/batch')
  batch(
    @Query(new ZodValidationPipe(batchSchema)) query: z.infer<typeof batchSchema>,
    @CurrentSession() _session: RequestSession,
  ): { items: CardEdition[] } {
    const index = this.catalog.requireIndex()
    const ids = [...new Set(query.ids.split(',').map((id) => id.trim()))].filter(Boolean)
    return { items: ids.map((id) => index.cardById(id)).filter((card): card is CardEdition => card !== undefined) }
  }

  @Get('cards/:id')
  card(
    @Param('id') id: string,
    @CurrentSession() _session: RequestSession,
  ): Promise<{ card: CardEdition; group: GroupDetail }> {
    return this.catalog.card(id)
  }

  @Get('groups/:id')
  async group(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<{ group: GroupDetail }> {
    return { group: await this.catalog.groupDetail(id) }
  }
}
