import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common'
import type { ZodType } from 'zod'

/** Validates a request body/query against a zod schema; 400 `validation` with field messages in Spanish on failure. */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value)
    if (result.success) return result.data
    const details = result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
    throw new BadRequestException({ code: 'validation', message: 'Datos inválidos.', details })
  }
}
