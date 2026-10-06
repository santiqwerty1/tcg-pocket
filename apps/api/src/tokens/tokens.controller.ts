import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { type ApiTokenView, type CreatedApiToken, TokensService } from './tokens.service.js'

const createTokenSchema = z.object({
  name: z.string().trim().min(1, 'Poné un nombre.').max(100),
  kind: z.enum(['worker', 'mcp']),
  scopes: z.array(z.string().min(1)).min(1, 'Elegí al menos un permiso.').max(10),
  expiresAt: z.coerce.date().optional(),
})

/** Session-protected management of worker/MCP tokens. The plaintext token is returned once, on creation. */
@Controller('api/tokens')
export class TokensController {
  constructor(private readonly tokens: TokensService) {}

  @Post()
  create(
    @Body(new ZodValidationPipe(createTokenSchema)) body: z.infer<typeof createTokenSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<CreatedApiToken> {
    return this.tokens.create(body)
  }

  @Get()
  async list(@CurrentSession() _session: RequestSession): Promise<{ items: ApiTokenView[] }> {
    return { items: await this.tokens.list() }
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<void> {
    await this.tokens.revoke(id)
  }
}
