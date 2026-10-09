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
  /** Fase 43 (R-010): the clients seen with the token, oldest first. */
  clients: { client: string; firstSeenAt: Date }[]
}

export interface CreatedApiToken extends ApiTokenView {
  /** Shown exactly once. */
  token: string
}

/** Fase 43: clients remembered per token; past this, a new one is not stored (a leaked token could vary it forever). */
export const MAX_CLIENTS_PER_TOKEN = 20
/** First key of the per-token advisory lock that guards that cap (the second one is the token's id). */
const CLIENTS_LOCK = 43_020

/** How often `last_used_at` is written (per token), to keep the hot path to a single SELECT. */
const LAST_USED_WRITE_INTERVAL_MS = 60_000

function toView(row: ApiToken, clients: ApiTokenView['clients'] = []): ApiTokenView {
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
    clients,
  }
}

/**
 * Fase 43 (R-010): a short, stable name of the client behind a request, from its User-Agent: the product inside
 * «(compatible; X/1.0)» when there is one, otherwise the first product, without its version.
 */
export function clientFromUserAgent(userAgent: string | undefined | null): string {
  const ua = (userAgent ?? '').trim()
  const compatible = /compatible;\s*([^\s;/)]+)/i.exec(ua)?.[1]
  const first = ua.split(/\s+/)[0]?.split('/')[0]
  const name = (compatible ?? first ?? '').replace(/[^\w.@+-]/g, '').slice(0, 60)
  return name || 'desconocido'
}

@Injectable()
export class TokensService {
  private readonly seenClients = new Set<string>()

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
    const [rows, clients] = await Promise.all([
      this.prisma.apiToken.findMany({ orderBy: { id: 'asc' } }),
      this.prisma.apiTokenClient.findMany({ orderBy: { firstSeenAt: 'asc' } }),
    ])
    return rows.map((row) =>
      toView(
        row,
        clients
          .filter((client) => client.tokenId === row.id)
          .map((client) => ({ client: client.client, firstSeenAt: client.firstSeenAt })),
      ),
    )
  }

  /**
   * Fase 43 (R-010): records that `client` used the token; true the first time (the alerts show it for a week).
   * Remembered in memory too, so the usual request costs nothing.
   */
  async noteClient(tokenId: number, client: string): Promise<boolean> {
    const key = `${tokenId}\u0000${client}`
    if (this.seenClients.has(key)) return false
    // One request per token at a time (an advisory lock on the token), so parallel new clients cannot pass the cap
    // together. Past the cap nothing is stored or remembered (the alerts already show the token is being abused).
    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CLIENTS_LOCK}::int, ${tokenId}::int)`
      if (await tx.apiTokenClient.findUnique({ where: { tokenId_client: { tokenId, client } } })) return 'known'
      if ((await tx.apiTokenClient.count({ where: { tokenId } })) >= MAX_CLIENTS_PER_TOKEN) return 'full'
      await tx.apiTokenClient.create({ data: { tokenId, client } })
      return 'new'
    })
    if (outcome !== 'full') this.seenClients.add(key)
    return outcome === 'new'
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
