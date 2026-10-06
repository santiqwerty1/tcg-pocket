import { Body, Controller, Get, Param, Put } from '@nestjs/common'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { SettingsService } from './settings.service.js'

/** `value` is any JSON value (objects, arrays, numbers, strings, booleans, null). */
const settingSchema = z.object({ value: z.json() })

@Controller('api/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  all(@CurrentSession() _session: RequestSession): Promise<Record<string, unknown>> {
    return this.settings.all()
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
