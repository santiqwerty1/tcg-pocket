import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request, Response } from 'express'
import { hasScopes, parseBearer } from './token-format.js'
import { TokensService } from './tokens.service.js'

export const REQUIRED_SCOPES = 'requiredScopes'

/** Scopes an API-token route needs; combine with `@UseGuards(BearerTokenGuard)`. */
export const RequireScopes = (...scopes: string[]) => SetMetadata(REQUIRED_SCOPES, scopes)

/** `Authorization: Bearer tcg_wk_… | tcg_mcp_…` → request.apiToken. 401 without a valid token, 403 without the scopes. */
@Injectable()
export class BearerTokenGuard implements CanActivate {
  constructor(
    private readonly tokens: TokensService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>()
    const response = context.switchToHttp().getResponse<Response>()
    const token = parseBearer(request.headers.authorization)
    if (!token) {
      response.setHeader('WWW-Authenticate', 'Bearer')
      throw new UnauthorizedException('Falta el token (Authorization: Bearer …).')
    }
    const resolved = await this.tokens.authenticate(token)
    if (!resolved) {
      response.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"')
      throw new UnauthorizedException('Token inválido, vencido o revocado.')
    }
    const required =
      this.reflector.getAllAndOverride<string[] | undefined>(REQUIRED_SCOPES, [
        context.getHandler(),
        context.getClass(),
      ]) ?? []
    if (!hasScopes(resolved.scopes, required)) {
      throw new ForbiddenException(`El token no tiene el permiso requerido (${required.join(', ')}).`)
    }
    request.apiToken = { id: resolved.id, name: resolved.name, kind: resolved.kind, scopes: resolved.scopes }
    return true
  }
}
