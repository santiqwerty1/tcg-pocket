import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
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
import { BACKUP_UPLOAD_LIMIT_BYTES, type UploadedFileShape, uploadOptions } from '../http/upload.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { type BackupBlobView, type BackupDryRun, type BackupReplaceResult, BackupService } from './backup.service.js'

const importQuerySchema = z.object({ mode: z.enum(['dry-run', 'replace']).default('dry-run') })

function sendGzip(res: Response, bytes: Buffer, fileName: string): void {
  res.setHeader('Content-Type', 'application/gzip')
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Cache-Control', 'no-store')
  res.send(bytes)
}

/** Session-protected backup API (docs/API.md «Copia de seguridad»). */
@Controller('api/backup')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Get('export')
  async export(@Res() res: Response, @CurrentSession() _session: RequestSession): Promise<void> {
    sendGzip(res, await this.backup.exportGzip(), BackupService.fileName())
  }

  /** `multipart/form-data` with `file` (.json.gz or .json); `?mode=dry-run` (default) reports, `replace` restores. */
  @Post('import')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', uploadOptions(BACKUP_UPLOAD_LIMIT_BYTES)))
  async import(
    @UploadedFile() file: UploadedFileShape | undefined,
    @Query(new ZodValidationPipe(importQuerySchema)) query: z.infer<typeof importQuerySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<BackupDryRun | BackupReplaceResult> {
    if (!file) {
      throw new BadRequestException({ code: 'validation', message: 'Subí el archivo del backup en el campo «file».' })
    }
    const document = this.backup.parseUpload(file.buffer)
    return query.mode === 'replace' ? this.backup.replace(document) : this.backup.dryRun(document)
  }

  @Get('blobs')
  async blobs(@CurrentSession() _session: RequestSession): Promise<{ items: BackupBlobView[] }> {
    return { items: await this.backup.listBlobs() }
  }

  @Get('blobs/:id')
  async blob(@Param('id') id: string, @Res() res: Response, @CurrentSession() _session: RequestSession): Promise<void> {
    const { view, dataGz } = await this.backup.blob(id)
    sendGzip(res, dataGz, BackupService.fileName(view.createdAt))
  }
}
