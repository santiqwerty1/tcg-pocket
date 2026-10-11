import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { TrackerSync } from './tracker-sync.service.js'

const applySchema = z.object({ id: z.string().regex(/^\d+$/) }).strict()
@Controller('api/collection/tracker-sync')
export class TrackerSyncController {
  constructor(private readonly sync: TrackerSync) {}
  @Get('status')
  status(@CurrentSession() _session: RequestSession) {
    return this.sync.status()
  }
  @Post('preview')
  @HttpCode(200)
  preview(@CurrentSession() _session: RequestSession) {
    return this.sync.preview()
  }
  @Post('apply')
  @HttpCode(200)
  apply(
    @CurrentSession() _session: RequestSession,
    @Body(new ZodValidationPipe(applySchema)) body: z.infer<typeof applySchema>,
  ) {
    return this.sync.apply(body.id)
  }
}
