import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common'
import { SELECTABLE_ENERGIES } from '@tcg/domain'
import type { Response } from 'express'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import type { GroupDeckUsage } from '../catalog/catalog-views.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { DECK_IMPORT_FORMATS } from './deck-formats.js'
import type { DeckDetail, DeckSummary, ImportedDeckDraft, ValidateResult } from './deck-views.js'
import { DecksService } from './decks.service.js'

const queryBool = z.stringbool().optional()
const energies = z.array(z.enum(SELECTABLE_ENERGIES)).max(8)
const cards = z
  .array(z.object({ cardId: z.string().trim().min(1).max(20), count: z.number().int().min(1).max(60) }))
  .max(60)
const deckInputSchema = z.object({
  name: z.string().trim().min(1, 'Poné un nombre.').max(200),
  energies,
  cards,
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  notes: z.string().max(5000).optional(),
  variantOfId: z.string().trim().max(20).nullable().optional(),
  packPriority: z.number().int().min(0).max(3).optional(),
})
const deckPatchSchema = deckInputSchema.partial().extend({
  builtInGame: z.boolean().optional(),
  archived: z.boolean().optional(),
  note: z.string().max(500).optional(),
})
const listQuerySchema = z.object({
  tag: z.string().trim().max(50).optional(),
  archived: queryBool,
  builtInGame: queryBool,
})
const exportQuerySchema = z.object({ format: z.enum(['spanish', 'deckgym', 'limitless', 'json']).default('spanish') })
const validateSchema = z
  .object({
    text: z.string().max(200_000).optional(),
    format: z.enum(DECK_IMPORT_FORMATS).optional(),
    cards: cards.optional(),
    energies: energies.optional(),
  })
  .refine((body) => body.text !== undefined || body.cards !== undefined, { message: 'Mandá text o cards.' })
const importSchema = z.object({
  text: z.string().min(1, 'Pegá el texto del mazo.').max(500_000),
  format: z.enum(DECK_IMPORT_FORMATS).default('auto'),
})
const commitSchema = z.object({ decks: z.array(deckInputSchema).min(1).max(100) })
const duplicateSchema = z.object({ name: z.string().trim().min(1).max(200).optional() })

/** Session-protected deck API (docs/API.md «Mazos»). Static routes go first so they never match `:id`. */
@Controller('api/decks')
export class DecksController {
  constructor(private readonly decks: DecksService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<{ items: DeckSummary[] }> {
    return { items: await this.decks.list(query) }
  }

  @Post()
  @HttpCode(201)
  create(
    @Body(new ZodValidationPipe(deckInputSchema)) body: z.infer<typeof deckInputSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<DeckDetail> {
    return this.decks.create(body, 'ui')
  }

  @Post('validate')
  @HttpCode(200)
  validate(
    @Body(new ZodValidationPipe(validateSchema)) body: z.infer<typeof validateSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<ValidateResult> {
    return this.decks.validate(body)
  }

  @Post('import')
  @HttpCode(200)
  async importPreview(
    @Body(new ZodValidationPipe(importSchema)) body: z.infer<typeof importSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<{ drafts: ImportedDeckDraft[] }> {
    return { drafts: await this.decks.importPreview(body.text, body.format) }
  }

  @Post('import/commit')
  @HttpCode(201)
  async importCommit(
    @Body(new ZodValidationPipe(commitSchema)) body: z.infer<typeof commitSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<{ created: DeckSummary[] }> {
    return { created: await this.decks.importCommit(body.decks) }
  }

  @Get('by-card/:groupId')
  async byCard(
    @Param('groupId') groupId: string,
    @CurrentSession() _session: RequestSession,
  ): Promise<{ items: GroupDeckUsage[] }> {
    return { items: await this.decks.byGroup(groupId) }
  }

  @Get(':id')
  detail(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<DeckDetail> {
    return this.decks.detail(id)
  }

  @Patch(':id')
  patch(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(deckPatchSchema)) body: z.infer<typeof deckPatchSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<DeckDetail> {
    return this.decks.patch(id, body)
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<void> {
    await this.decks.delete(id)
  }

  @Post(':id/duplicate')
  @HttpCode(201)
  duplicate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(duplicateSchema)) body: z.infer<typeof duplicateSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<DeckDetail> {
    return this.decks.duplicate(id, body.name)
  }

  @Post(':id/revisions/:number/restore')
  @HttpCode(200)
  restore(
    @Param('id') id: string,
    @Param('number') number: string,
    @CurrentSession() _session: RequestSession,
  ): Promise<DeckDetail> {
    const parsed = Number(number)
    return this.decks.restoreRevision(id, Number.isInteger(parsed) ? parsed : -1)
  }

  @Get(':id/export')
  async export(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(exportQuerySchema)) query: z.infer<typeof exportQuerySchema>,
    @Res() res: Response,
    @CurrentSession() _session: RequestSession,
  ): Promise<void> {
    const result = await this.decks.export(id, query.format)
    res.setHeader('Content-Type', `${result.contentType}; charset=utf-8`)
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(result.fileName)}`)
    res.setHeader('Cache-Control', 'no-store')
    res.send(result.body)
  }
}
