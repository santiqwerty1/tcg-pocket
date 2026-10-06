import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { toApiError } from './http-exception.filter.js'

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

  it('hides unknown errors behind a generic 500', () => {
    expect(toApiError(new Error('boom'))).toEqual({
      status: 500,
      body: { error: { code: 'internal_error', message: 'Error interno del servidor.' } },
    })
  })
})
