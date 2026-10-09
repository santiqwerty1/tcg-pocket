import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { McpAuditService, type McpAuditView } from './mcp-audit.service.js'

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  tokenId: z
    .string()
    .regex(/^\d{1,10}$/)
    .optional(),
})

/** Fase 43 (R-010): what Claude wrote through the MCP (Más → Tokens de API), and «Deshacer». Session only. */
@Controller('api/mcp-audit')
export class McpAuditController {
  constructor(private readonly audit: McpAuditService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<{ items: McpAuditView[] }> {
    return { items: await this.audit.list(query) }
  }

  @Post(':id/undo')
  @HttpCode(200)
  undo(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<McpAuditView> {
    return this.audit.undo(id)
  }
}
