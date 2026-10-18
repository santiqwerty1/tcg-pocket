import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common'
import type { Response } from 'express'

/** Error envelope of docs/API.md: `{ error: { code, message, details? } }`. */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown }
}

const CODE_BY_STATUS: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'validation',
  429: 'rate_limited',
  500: 'internal_error',
  501: 'not_implemented',
  503: 'unavailable',
}

function isEnvelope(value: unknown): value is ApiErrorBody {
  if (!value || typeof value !== 'object') return false
  const error = (value as { error?: unknown }).error
  return !!error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
}

/** Maps any thrown value to a status and the contract body. Exceptions may carry `code` and `details` themselves. */
export function toApiError(exception: unknown): { status: number; body: ApiErrorBody } {
  if (!(exception instanceof HttpException)) {
    return { status: 500, body: { error: { code: 'internal_error', message: 'Error interno del servidor.' } } }
  }
  const status = exception.getStatus()
  const fallbackCode = CODE_BY_STATUS[status] ?? `http_${status}`
  const response = exception.getResponse()
  if (typeof response === 'string') return { status, body: { error: { code: fallbackCode, message: response } } }
  if (isEnvelope(response)) return { status, body: response }
  const raw = response as Record<string, unknown>
  const code = typeof raw.code === 'string' ? raw.code : fallbackCode
  const rawMessage = raw.message
  const message = Array.isArray(rawMessage)
    ? rawMessage.map(String).join('; ')
    : typeof rawMessage === 'string'
      ? rawMessage
      : exception.message
  const body: ApiErrorBody = { error: { code, message } }
  if (raw.details !== undefined) body.error.details = raw.details
  return { status, body }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()
    const { status, body } = toApiError(exception)
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception))
    }
    if (response.headersSent) return
    // A 503 is temporary: the bridges and the worker retry after `Retry-After` (the chat during an import, a catalog
    // that is still syncing).
    if (status === 503 && !response.getHeader('Retry-After')) response.setHeader('Retry-After', '5')
    response.status(status).json(body)
  }
}
