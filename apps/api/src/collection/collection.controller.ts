import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { CSV_UPLOAD_LIMIT_BYTES, type UploadedFileShape, uploadOptions } from '../http/upload.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { CollectionService } from './collection.service.js'
import type {
  AdjustmentConversionResult,
  CollectionAdjustmentView,
  CollectionGroupItem,
  CollectionSummaryView,
  ImportListItem,
  ImportPreview,
  MissionsView,
  Page,
  StockItem,
  StockPatchResult,
} from './collection-views.js'

export const CSV_EXPORT_FILE_NAME = 'tcgcollectiontracterexport.csv'

/** Query booleans arrive as strings ('true' / 'false'); zod 4 coerces them. */
const queryBool = z.stringbool().optional()
const pagination = {
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}
const groupsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  expansion: z.string().trim().max(10).optional(),
  missingOnly: queryBool,
  ...pagination,
})
const stockQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  expansion: z.string().trim().max(10).optional(),
  onlyOwned: queryBool,
  ...pagination,
})
const stockPatchSchema = z
  .object({
    amountOwned: z.number().int().min(0).max(999).optional(),
    collected: z.boolean().optional(),
  })
  .refine((patch) => patch.amountOwned !== undefined || patch.collected !== undefined, {
    message: 'Indicá amountOwned o collected.',
  })
const csvBodySchema = z.object({ csv: z.string().min(1, 'El CSV está vacío.').max(CSV_UPLOAD_LIMIT_BYTES) })
const adjustmentsQuerySchema = z.object({ active: queryBool })
const adjustmentCreateSchema = z.object({
  functionalGroupId: z.string().trim().min(1).max(20),
  playableCopies: z.number().int().min(0).max(999),
  reason: z.string().trim().max(500).default(''),
})
const adjustmentResolveSchema = z.object({ resolution: z.enum(['user', 'csv_matches', 'manual_edit']) })
const adjustmentConvertSchema = z.object({ targetCardId: z.string().trim().min(1).max(20) })

/** Session-protected collection API (docs/API.md «Colección»). */
const missionsQuerySchema = z.object({
  expansion: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,8}$/)
    .optional(),
  incomplete: z.stringbool().optional(),
})

@Controller('api/collection')
export class CollectionController {
  constructor(private readonly collection: CollectionService) {}

  @Get('summary')
  summary(@CurrentSession() _session: RequestSession): Promise<CollectionSummaryView> {
    return this.collection.summary()
  }

  /** Themed-collection missions with what the collection has of each (Fase 8). */
  @Get('missions')
  missions(
    @Query(new ZodValidationPipe(missionsQuerySchema)) query: z.infer<typeof missionsQuerySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<MissionsView> {
    return this.collection.missions(query)
  }

  @Get('groups')
  groups(
    @Query(new ZodValidationPipe(groupsQuerySchema)) query: z.infer<typeof groupsQuerySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<Page<CollectionGroupItem>> {
    return this.collection.groups(query)
  }

  @Get('stock')
  stock(
    @Query(new ZodValidationPipe(stockQuerySchema)) query: z.infer<typeof stockQuerySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<Page<StockItem>> {
    return this.collection.stock(query)
  }

  @Patch('stock/:cardId')
  patchStock(
    @Param('cardId') cardId: string,
    @Body(new ZodValidationPipe(stockPatchSchema)) body: z.infer<typeof stockPatchSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<StockPatchResult> {
    return this.collection.patchStock(cardId, body)
  }

  /** `multipart/form-data` with `file` (≤ 5 MB) or JSON `{ csv }`. Creates a pending import and returns its preview. */
  @Post('imports')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', uploadOptions(CSV_UPLOAD_LIMIT_BYTES)))
  createImport(
    @UploadedFile() file: UploadedFileShape | undefined,
    @Body() body: unknown,
    @CurrentSession() _session: RequestSession,
  ): Promise<ImportPreview> {
    if (file) return this.collection.createImport({ bytes: file.buffer, fileName: file.originalname || null })
    const parsed = csvBodySchema.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'validation',
        message: 'Subí el archivo CSV en el campo «file» o mandá { csv: "…" }.',
        details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      })
    }
    return this.collection.createImport({ bytes: Buffer.from(parsed.data.csv, 'utf8'), fileName: null })
  }

  @Get('imports')
  async listImports(@CurrentSession() _session: RequestSession): Promise<{ items: ImportListItem[] }> {
    return { items: await this.collection.listImports() }
  }

  @Get('imports/:id')
  importPreview(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<ImportPreview> {
    return this.collection.importPreview(id)
  }

  @Post('imports/:id/apply')
  @HttpCode(200)
  applyImport(@Param('id') id: string, @CurrentSession() _session: RequestSession) {
    return this.collection.applyImport(id)
  }

  @Post('imports/:id/discard')
  @HttpCode(204)
  async discardImport(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<void> {
    await this.collection.discardImport(id)
  }

  @Get('export.csv')
  async exportCsv(@Res() res: Response, @CurrentSession() _session: RequestSession): Promise<void> {
    const csv = await this.collection.exportCsv()
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${CSV_EXPORT_FILE_NAME}"`)
    res.setHeader('Cache-Control', 'no-store')
    res.send(csv)
  }

  @Get('adjustments')
  async listAdjustments(
    @Query(new ZodValidationPipe(adjustmentsQuerySchema)) query: z.infer<typeof adjustmentsQuerySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<{ items: CollectionAdjustmentView[] }> {
    return { items: await this.collection.listAdjustments(query.active) }
  }

  @Post('adjustments')
  @HttpCode(201)
  createAdjustment(
    @Body(new ZodValidationPipe(adjustmentCreateSchema)) body: z.infer<typeof adjustmentCreateSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<CollectionAdjustmentView> {
    return this.collection.createAdjustment(body)
  }

  @Post('adjustments/:id/resolve')
  @HttpCode(200)
  resolveAdjustment(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adjustmentResolveSchema)) body: z.infer<typeof adjustmentResolveSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<CollectionAdjustmentView> {
    return this.collection.resolveAdjustment(id, body.resolution)
  }

  @Post('adjustments/:id/convert')
  @HttpCode(200)
  convertAdjustment(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adjustmentConvertSchema)) body: z.infer<typeof adjustmentConvertSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<AdjustmentConversionResult> {
    return this.collection.convertAdjustment(id, body.targetCardId)
  }
}
