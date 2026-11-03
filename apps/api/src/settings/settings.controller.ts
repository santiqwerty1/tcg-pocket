import { Body, Controller, Get, Param, Patch, Put } from '@nestjs/common'
import { EXPANSION_ID_PATTERN, PACK_POINTS_MAX } from '@tcg/domain'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { SettingsService } from './settings.service.js'

/** `value` is any JSON value (objects, arrays, numbers, strings, booleans, null). */
const settingSchema = z.object({ value: z.json() })

/**
 * Review of #170: the points of some expansions only. An expansion id as the import takes it (a capital first, review
 * of #171): «constructor» or a lowercase id is not one.
 */
const packPointsPatchSchema = z.object({
  changes: z
    .record(z.string().regex(EXPANSION_ID_PATTERN, 'expansión inválida'), z.number().int().min(0).max(PACK_POINTS_MAX))
    .refine((changes) => {
      const count = Object.keys(changes).length
      return count > 0 && count <= 200
    }, 'entre 1 y 200 expansiones'),
})

@Controller('api/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  all(@CurrentSession() _session: RequestSession): Promise<Record<string, unknown>> {
    return this.settings.all()
  }

  /** Review of #170: Sobres → Ajustes saves one expansion's points; the others stay as saved now (`{ changes }`). */
  @Patch('packPoints')
  patchPackPoints(
    @Body(new ZodValidationPipe(packPointsPatchSchema)) body: z.infer<typeof packPointsPatchSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<{ key: string; value: unknown }> {
    return this.settings.patchPackPoints(body.changes)
  }

  @Put(':key')
  set(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(settingSchema)) body: z.infer<typeof settingSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<{ key: string; value: unknown }> {
    return this.settings.set(key, body.value)
  }
}
