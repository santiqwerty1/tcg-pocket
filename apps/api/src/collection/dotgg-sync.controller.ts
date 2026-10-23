import { Body, Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { DotggSync } from './dotgg-sync.service.js'
import { TrackerGapService } from './tracker-gap.service.js'

/** The link travels only in this body (never in a URL, which the request log keeps); the answer masks it. */
const linkSchema = z.object({ url: z.string().max(2000) }).strict()
const applySchema = z.object({ id: z.string().regex(/^\d+$/) }).strict()

/** T-020: the collection from the game through ptcgpocket.gg. */
@Controller('api/collection/dotgg')
export class DotggSyncController {
  constructor(private readonly sync: DotggSync) {}

  @Get('status')
  status(@CurrentSession() _session: RequestSession) {
    return this.sync.status()
  }

  @Put('link')
  setLink(
    @CurrentSession() _session: RequestSession,
    @Body(new ZodValidationPipe(linkSchema)) body: z.infer<typeof linkSchema>,
  ) {
    return this.sync.setLink(body.url)
  }

  @Delete('link')
  clearLink(@CurrentSession() _session: RequestSession) {
    return this.sync.clearLink()
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

/** T-020: «Tracker al día», the tracker against the game, card by card, and the file for the tracker. */
@Controller('api/collection/tracker-gap')
export class TrackerGapController {
  constructor(private readonly gap: TrackerGapService) {}

  @Get()
  get(@CurrentSession() _session: RequestSession) {
    return this.gap.gap()
  }
}
