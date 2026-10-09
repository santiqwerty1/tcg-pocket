/**
 * Fase 43 (R-010): the record of every write Claude makes through the MCP, and the way back for the two writes that
 * lose something — a deleted match (the row is kept here) and a collection edit (the row before the edit). The
 * owner sees it in Más → Tokens de API; `matches_restore` uses it too.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { MCP_WRITE_TOOLS } from '@tcg/domain'
import { PinoLogger } from 'nestjs-pino'
import { CollectionService } from '../collection/collection.service.js'
import type { McpAudit, Prisma } from '../generated/prisma/client.js'
import { idToString, parseNumericId } from '../http/ids.js'
import { PrismaService } from '../prisma/prisma.service.js'

type Json = Record<string, unknown>

/** What undoes a write: the deleted match as it was, or a collection row before (and after) the edit. */
export type AuditUndo =
  | {
      kind: 'match_delete'
      match: {
        id: number
        deckId: number
        deckRevisionId: number
        result: 'win' | 'loss' | 'tie'
        opponentText: string | null
        wentFirst: boolean | null
        mode: 'competitive' | 'casual' | 'beginner' | 'event' | 'friend'
        note: string
        playedAt: string
        source: 'ui' | 'mcp'
        clientRef: string | null
        createdAt: string
      }
      /** «Victoria con 7 Zoroark ex contra Mega-Blaziken» — for the list. */
      label: string
    }
  | {
      kind: 'collection_stock'
      cardId: string
      before: { amountOwned: number; collected: boolean } | null
      after: { amountOwned: number; collected: boolean }
      /** The row's `updated_at` right after the edit: any later write (even back to the same values) blocks undo. */
      afterUpdatedAt?: string
      label: string
    }

/**
 * Collects what a write tool wants recorded besides its arguments and answer. `keep` stores the undo at once, before
 * the write that loses something (a deleted match must not depend on the final update of the log).
 */
export interface AuditNote {
  undo: AuditUndo | null
  keep(undo: AuditUndo): Promise<void>
}

/** What an entry says until the write finishes (it stays so if the server dies in between). */
export const AUDIT_PENDING = 'Sin terminar: el servidor no llegó a anotar el resultado.'

export interface McpAuditView {
  id: string
  at: Date
  token: { id: string | null; name: string }
  client: string
  tool: string
  /** Spanish title of the tool («Registrar una partida»). */
  title: string
  args: unknown
  ok: boolean
  error: string | null
  ms: number
  /** What «Deshacer» would do, while it can still be undone. */
  undo: { kind: AuditUndo['kind']; label: string } | null
  undoneAt: Date | null
}

const TITLES = new Map<string, string>(Object.values(MCP_WRITE_TOOLS).map((tool) => [tool.name, tool.title]))
const MAX_STRING = 2000
const MAX_JSON = 16_000

/** Long texts (a pasted deck list) cut, and anything still too big kept as a preview. */
export function clipForAudit(value: unknown): Prisma.InputJsonValue {
  const walk = (item: unknown): unknown => {
    if (typeof item === 'string') {
      return item.length > MAX_STRING ? `${item.slice(0, MAX_STRING)}… (+${item.length - MAX_STRING})` : item
    }
    if (Array.isArray(item)) return item.map(walk)
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item as Json).map(([key, inner]) => [key, walk(inner)]))
    }
    return item ?? null
  }
  const clipped = walk(value)
  const text = JSON.stringify(clipped) ?? 'null'
  if (text.length <= MAX_JSON) return (clipped ?? {}) as Prisma.InputJsonValue
  return { truncated: true, preview: text.slice(0, MAX_JSON) }
}

@Injectable()
export class McpAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly collection: CollectionService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(McpAuditService.name)
  }

  /** Opens the entry before the write runs: if it cannot be recorded, the write does not happen. */
  async start(entry: {
    tokenId: number | null
    tokenName: string
    client: string
    tool: string
    args: unknown
  }): Promise<number> {
    const row = await this.prisma.mcpAudit.create({
      data: {
        tokenId: entry.tokenId,
        tokenName: entry.tokenName,
        client: entry.client,
        tool: entry.tool,
        args: clipForAudit(entry.args ?? {}),
        ok: false,
        error: AUDIT_PENDING,
        ms: 0,
      },
      select: { id: true },
    })
    return row.id
  }

  async keepUndo(id: number, undo: AuditUndo): Promise<void> {
    await this.prisma.mcpAudit.update({ where: { id }, data: { undo: undo as unknown as Prisma.InputJsonValue } })
  }

  /** Closes the entry with what happened. */
  async finish(
    id: number,
    outcome: { ok: boolean; result: Json | null; error: string | null; ms: number; undo: AuditUndo | null },
  ): Promise<void> {
    await this.prisma.mcpAudit.update({
      where: { id },
      data: {
        ok: outcome.ok,
        ...(outcome.result ? { result: clipForAudit(outcome.result) } : {}),
        error: outcome.error,
        ms: outcome.ms,
        ...(outcome.undo ? { undo: outcome.undo as unknown as Prisma.InputJsonValue } : {}),
      },
    })
  }

  async list(query: { limit: number; tokenId?: string | undefined }): Promise<McpAuditView[]> {
    const rows = await this.prisma.mcpAudit.findMany({
      where: query.tokenId ? { tokenId: parseNumericId(query.tokenId, 'Token') } : {},
      orderBy: { id: 'desc' },
      take: query.limit,
    })
    return rows.map((row) => this.view(row))
  }

  /** Undoes a recorded write from the app (Más → Tokens de API). */
  async undo(rawId: string): Promise<McpAuditView> {
    const row = await this.prisma.mcpAudit.findUnique({ where: { id: parseNumericId(rawId, 'Registro') } })
    if (!row) throw new NotFoundException(`Registro ${rawId} no encontrado.`)
    return this.apply(row)
  }

  /** `matches_restore`: the latest deletion of that match by Claude, not undone yet. */
  async restoreMatch(matchId: number): Promise<McpAuditView> {
    const rows = await this.prisma.mcpAudit.findMany({
      where: { tool: MCP_WRITE_TOOLS.matchesDelete.name, ok: true, undoneAt: null },
      orderBy: { id: 'desc' },
      take: 200,
    })
    const row = rows.find((item) => {
      const undo = item.undo as AuditUndo | null
      return undo?.kind === 'match_delete' && undo.match.id === matchId
    })
    if (!row) {
      throw new NotFoundException(
        `No hay una partida ${matchId} borrada por Claude para devolver (las que se borran en la app no pasan por el registro).`,
      )
    }
    return this.apply(row)
  }

  private async apply(row: McpAudit): Promise<McpAuditView> {
    const undo = row.undo as AuditUndo | null
    if (!undo) throw new BadRequestException({ code: 'not_undoable', message: 'Esta escritura no se puede deshacer.' })
    // Claimed first, so two «Deshacer» at once do not both run; released again if undoing fails.
    const claimed = await this.prisma.mcpAudit.updateMany({
      where: { id: row.id, undoneAt: null },
      data: { undoneAt: new Date() },
    })
    if (claimed.count === 0) throw new ConflictException({ code: 'already_undone', message: 'Ya estaba deshecha.' })
    try {
      if (undo.kind === 'match_delete') await this.restoreMatchRow(undo.match)
      else await this.restoreStock(undo)
    } catch (error) {
      await this.prisma.mcpAudit.update({ where: { id: row.id }, data: { undoneAt: null } })
      throw error
    }
    const updated = await this.prisma.mcpAudit.findUniqueOrThrow({ where: { id: row.id } })
    this.logger.info({ audit: row.id, tool: row.tool, kind: undo.kind }, 'mcp write undone')
    return this.view(updated)
  }

  private async restoreMatchRow(match: Extract<AuditUndo, { kind: 'match_delete' }>['match']): Promise<void> {
    if (await this.prisma.match.findUnique({ where: { id: match.id }, select: { id: true } })) {
      throw new ConflictException({ code: 'match_exists', message: `La partida ${match.id} ya está en la app.` })
    }
    const revision = await this.prisma.deckRevision.findUnique({
      where: { id: match.deckRevisionId },
      select: { deckId: true },
    })
    if (!revision || revision.deckId !== match.deckId) {
      throw new ConflictException({
        code: 'deck_gone',
        message: 'El mazo (o la revisión) de esa partida ya no existe: no se puede devolver.',
      })
    }
    // The phone may have sent the same match again (Fase 28): restoring it too would count it twice.
    const resent = match.clientRef
      ? await this.prisma.match.findUnique({ where: { clientRef: match.clientRef }, select: { id: true } })
      : null
    if (resent) {
      throw new ConflictException({
        code: 'match_resent',
        message: `Esa partida ya volvió a entrar desde el celu (partida ${resent.id}): no la duplico.`,
      })
    }
    await this.prisma.match.create({
      data: {
        id: match.id,
        deckId: match.deckId,
        deckRevisionId: match.deckRevisionId,
        result: match.result,
        opponentText: match.opponentText,
        wentFirst: match.wentFirst,
        mode: match.mode,
        note: match.note,
        playedAt: new Date(match.playedAt),
        source: match.source,
        clientRef: match.clientRef,
        createdAt: new Date(match.createdAt),
      },
    })
  }

  private async restoreStock(undo: Extract<AuditUndo, { kind: 'collection_stock' }>): Promise<void> {
    const current = await this.prisma.collectionStock.findUnique({ where: { cardId: undo.cardId } })
    if (
      !current ||
      current.amountOwned !== undo.after.amountOwned ||
      current.collected !== undo.after.collected ||
      (undo.afterUpdatedAt !== undefined && current.updatedAt.toISOString() !== undo.afterUpdatedAt)
    ) {
      throw new ConflictException({
        code: 'collection_changed',
        message: `${undo.cardId} cambió después (otra edición o un CSV importado): no lo deshago para no pisarlo.`,
      })
    }
    await this.collection.patchStock(undo.cardId, {
      amountOwned: undo.before?.amountOwned ?? 0,
      collected: undo.before?.collected ?? false,
    })
  }

  private view(row: McpAudit): McpAuditView {
    const undo = row.undo as AuditUndo | null
    return {
      id: idToString(row.id),
      at: row.at,
      token: { id: row.tokenId === null ? null : idToString(row.tokenId), name: row.tokenName },
      client: row.client,
      tool: row.tool,
      title: TITLES.get(row.tool) ?? row.tool,
      args: row.args,
      ok: row.ok,
      error: row.error,
      ms: row.ms,
      undo: undo && !row.undoneAt ? { kind: undo.kind, label: undo.label } : null,
      undoneAt: row.undoneAt,
    }
  }
}
