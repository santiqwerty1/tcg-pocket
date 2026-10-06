import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common'
import type { Request } from 'express'
import type { ApiTokenKind } from '../generated/prisma/enums.js'

/** Attached to the request by SessionMiddleware when a valid session cookie is present. */
export interface RequestSession {
  idHash: string
  createdAt: Date
  expiresAt: Date
  lastSeenAt: Date
}

/** Attached to the request by BearerTokenGuard. */
export interface RequestApiToken {
  id: number
  name: string
  kind: ApiTokenKind
  scopes: string[]
}

declare module 'express' {
  interface Request {
    session?: RequestSession
    apiToken?: RequestApiToken
  }
}

/** The current session (routes behind the session middleware always have one; 401 otherwise). */
export const CurrentSession = createParamDecorator((_data: unknown, context: ExecutionContext): RequestSession => {
  const request = context.switchToHttp().getRequest<Request>()
  if (!request.session) throw new UnauthorizedException('Necesitás iniciar sesión.')
  return request.session
})

export const CurrentApiToken = createParamDecorator((_data: unknown, context: ExecutionContext): RequestApiToken => {
  const request = context.switchToHttp().getRequest<Request>()
  if (!request.apiToken) throw new UnauthorizedException('Token inválido.')
  return request.apiToken
})
