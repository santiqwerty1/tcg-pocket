import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { ApiToken } from '../generated/prisma/client.js'
import { idToString, parseNumericId } from '../http/ids.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { type ApiTokenKind, generateApiToken, hashApiToken, invalidScopes } from './token-format.js'

export interface ApiTokenView {
  /** Numeric database id, as a string like every other id in the API (docs/API.md «Convenciones»). */
  id: string
  name: string
  kind: ApiTokenKind
  scopes: string[]
  prefix: string
  createdAt: Date
  lastUsedAt: Date | null
  expiresAt: Date | null
  revokedAt: Date | null
}

export interface CreatedApiToken extends ApiTokenView {
  /** Shown exactly once. */
  token: string
}

/** How often `last_used_at` is written (per token), to keep the hot path to a single SELECT. */
const LAST_USED_WRITE_INTERVAL_MS = 60_000

function toView(row: ApiToken): ApiTokenView {
  return {
    id: idToString(row.id),
    name: row.name,
    kind: row.kind,
    scopes: row.scopes,
    prefix: row.prefix,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  }
}

@Injectable()
export class TokensService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    name: string
    kind: ApiTokenKind
    scopes: string[]
    expiresAt?: Date
  }): Promise<CreatedApiToken> {
    const bad = invalidScopes(input.kind, input.scopes)
    if (bad.length > 0) throw new BadRequestException(`Scopes inválidos para ${input.kind}: ${bad.join(', ')}`)
    const generated = generateApiToken(input.kind)
    const row = await this.prisma.apiToken.create({
      data: {
        name: input.name,
        kind: input.kind,
        scopes: [...new Set(input.scopes)],
        tokenHash: generated.hash,
        prefix: generated.prefix,
        expiresAt: input.expiresAt ?? null,
      },
    })
    return { ...toView(row), token: generated.token }
  }

  async list(): Promise<ApiTokenView[]> {
    const rows = await this.prisma.apiToken.findMany({ orderBy: { id: 'asc' } })
    return rows.map(toView)
  }

  /** Revokes by id (anything that is not a positive integer is a 404, like the other resources). */
  async revoke(rawId: string): Promise<ApiTokenView> {
    const id = parseNumericId(rawId, 'Token')
    const row = await this.prisma.apiToken.findUnique({ where: { id } })
    if (!row) throw new NotFoundException(`Token ${rawId} no encontrado.`)
    if (row.revokedAt) return toView(row)
    return toView(await this.prisma.apiToken.update({ where: { id }, data: { revokedAt: new Date() } }))
  }

  /** Resolves a plaintext token to its active row (null when unknown, revoked or expired) and records its use. */
  async authenticate(token: string): Promise<ApiTokenView | null> {
    const row = await this.prisma.apiToken.findUnique({ where: { tokenHash: hashApiToken(token) } })
    if (!row || row.revokedAt) return null
    const now = new Date()
    if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return null
    if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS) {
      await this.prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: now } })
      row.lastUsedAt = now
    }
    return toView(row)
  }
}
