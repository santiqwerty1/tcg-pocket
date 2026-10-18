import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { ApiExceptionFilter, toApiError } from './http-exception.filter.js'

describe('toApiError', () => {
  it('maps status codes to snake_case codes and keeps the Spanish message', () => {
    expect(toApiError(new NotFoundException('Carta no encontrada.'))).toEqual({
      status: 404,
      body: { error: { code: 'not_found', message: 'Carta no encontrada.' } },
    })
    expect(toApiError(new ConflictException('Ya hay una sincronización en curso.')).body.error.code).toBe('conflict')
    expect(toApiError(new HttpException('Too many', 429)).body.error.code).toBe('rate_limited')
    expect(toApiError(new HttpException('odd', 418)).body.error.code).toBe('http_418')
  })

  it('honours an explicit code and details carried by the exception', () => {
    const result = toApiError(
      new UnauthorizedException({ statusCode: 401, code: 'totp_required', message: 'Falta el código.' }),
    )
    expect(result).toEqual({ status: 401, body: { error: { code: 'totp_required', message: 'Falta el código.' } } })
    const validation = toApiError(
      new BadRequestException({ code: 'validation', message: 'Datos inválidos.', details: [{ path: 'email' }] }),
    )
    expect(validation.body.error).toEqual({
      code: 'validation',
      message: 'Datos inválidos.',
      details: [{ path: 'email' }],
    })
  })

  it('passes through bodies already in the envelope shape and joins message arrays', () => {
    const envelope = { error: { code: 'custom', message: 'x' } }
    expect(toApiError(new HttpException(envelope, 400)).body).toBe(envelope)
    expect(toApiError(new BadRequestException(['a', 'b'])).body.error.message).toBe('a; b')
  })

  it('a 503 says when to come back (Retry-After), and keeps one the route set', () => {
    const answer = (preset?: string) => {
      const headers = new Map<string, string>(preset ? [['Retry-After', preset]] : [])
      const response = {
        headersSent: false,
        getHeader: (name: string) => headers.get(name),
        setHeader: (name: string, value: string) => headers.set(name, value),
        status: () => response,
        json: () => response,
      }
      const host = { switchToHttp: () => ({ getResponse: () => response }) }
      new ApiExceptionFilter().catch(new ServiceUnavailableException('ocupado'), host as never)
      return headers.get('Retry-After')
    }
    expect(answer()).toBe('5')
    expect(answer('30')).toBe('30')
  })

  it('hides unknown errors behind a generic 500', () => {
    expect(toApiError(new Error('boom'))).toEqual({
      status: 500,
      body: { error: { code: 'internal_error', message: 'Error interno del servidor.' } },
    })
  })
})
