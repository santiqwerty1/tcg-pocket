/** Notas por rival (Fase 12, docs/API.md «Partidas»): session-protected. */
import { Body, Controller, Delete, Get, HttpCode, Module, Param, Put, Query } from '@nestjs/common'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { RIVAL_NOTE_MAX_LENGTH, RivalNotesService, type RivalNoteView } from './rival-notes.service.js'

const lookupSchema = z.object({ opponent: z.string().trim().min(1).max(200) })
const saveSchema = z.object({
  opponent: z.string().trim().min(1).max(200),
  text: z.string().max(RIVAL_NOTE_MAX_LENGTH),
  archetypeId: z.string().trim().min(1).max(200).nullable().optional(),
  append: z.boolean().optional(),
})

@Controller('api/rival-notes')
export class RivalNotesController {
  constructor(private readonly notes: RivalNotesService) {}

  @Get()
  async list(@CurrentSession() _session: RequestSession): Promise<{ items: RivalNoteView[] }> {
    return { items: await this.notes.list() }
  }

  /** The note of an opponent as typed (any spelling): `{ note: null }` when there is none. */
  @Get('lookup')
  async lookup(
    @Query(new ZodValidationPipe(lookupSchema)) query: z.infer<typeof lookupSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<{ note: RivalNoteView | null }> {
    return { note: await this.notes.lookup(query.opponent) }
  }

  /** Creates or replaces the note (empty text deletes it): `{ note }`. */
  @Put()
  async save(
    @Body(new ZodValidationPipe(saveSchema)) body: z.infer<typeof saveSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<{ note: RivalNoteView | null }> {
    return { note: await this.notes.save(body) }
  }

  @Delete(':key')
  @HttpCode(204)
  async remove(@Param('key') key: string, @CurrentSession() _session: RequestSession): Promise<void> {
    await this.notes.remove(key)
  }
}

@Module({
  controllers: [RivalNotesController],
  providers: [RivalNotesService],
  exports: [RivalNotesService],
})
export class RivalNotesModule {}
