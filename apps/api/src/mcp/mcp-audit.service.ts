/**
 * Fase 43 (R-010): the record of every write Claude makes through the MCP, and the way back for the writes that
 * lose something — a deleted match (the row is kept here), a collection edit (the row before the edit) and a rival
 * note replaced or deleted (the text before). The owner sees it in Más → Tokens de API; `matches_restore` uses it
 * too.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { MCP_WRITE_TOOLS, opponentKey } from '@tcg/domain'
import { PinoLogger } from 'nestjs-pino'
import { type McpAudit, Prisma } from '../generated/prisma/client.js'
import { idToString, parseNumericId } from '../http/ids.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { RivalNotesService } from '../rivals/rival-notes.service.js'

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
        /** 14/10: the rival's cards seen (absent in a copy kept before them). */
        opponentCards?: { cardId: string; count: number }[]
        wentFirst: boolean | null
        mode: 'competitive' | 'casual' | 'beginner' | 'event' | 'friend'
        note: string
        playedAt: string
        source: 'ui' | 'mcp'
        clientRef: string | null
        createdAt: string
      }
      /**
       * When the match was deleted, written in the same transaction as the delete: an entry left «Sin terminar» is
       * undoable only with it (without it, the delete may never have happened).
       */
      deletedAt?: string
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
      /** The row's `updated_at` before the edit (null: no row): undoing a later edit hands its place back to this one. */
      beforeUpdatedAt?: string | null
      label: string
    }
  | {
      /** 18/10: a rank noted by Claude; undoing deletes it while it is still there. */
      kind: 'rank_change'
      id: string
      label: string
    }
  | {
      kind: 'rival_note'
      /** The note's key (`opponentKey`; missing in the first entries, which only kept `opponent`). */
      key?: string
      opponent: string
      /**
       * The whole note before the write (null: there was none), and its text after it (null: the write deleted it).
       * The first entries kept only the text before, as a string.
       */
      before: { label: string; archetypeId: string | null; text: string; createdAt: string } | string | null
      after: string | null
      /** The note's `updated_at` right after the write: any later change (label or archetype too) blocks undo. */
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
  /** `keep` inside the caller's transaction: recorded only if the write it goes with commits. */
  keepIn(tx: Prisma.TransactionClient, undo: AuditUndo): Promise<void>
}

/** What an entry says until the write finishes (it stays so if the server dies in between). */
export const AUDIT_PENDING = 'Sin terminar: el servidor no llegó a anotar el resultado.'

/**
 * What can be undone: a write that finished, or a deletion left «Sin terminar» whose delete committed (`deletedAt`,
 * written with it): the server died after deleting, before closing the entry.
 */
function undoable(row: Pick<McpAudit, 'ok' | 'error' | 'undo'>): boolean {
  const undo = row.undo as AuditUndo | null
  if (!undo) return false
  return row.ok || (row.error === AUDIT_PENDING && undo.kind === 'match_delete' && undo.deletedAt !== undefined)
}

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
  /** Right after undoing a deleted match: its id (another one if its own was taken meanwhile). */
  restoredMatchId?: number
}

const TITLES = new Map<string, string>(Object.values(MCP_WRITE_TOOLS).map((tool) => [tool.name, tool.title]))
const MAX_STRING = 2000
const MAX_JSON = 16_000

/** The first `max` UTF-16 units, without splitting a surrogate pair (a lone half is invalid in `jsonb`). */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text
  const last = text.charCodeAt(max - 1)
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max)
}

/** Long texts (a pasted deck list) cut, and anything still too big kept as a preview. */
export function clipForAudit(value: unknown): Prisma.InputJsonValue {
  const walk = (item: unknown): unknown => {
    if (typeof item === 'string') {
      return item.length > MAX_STRING ? `${cutText(item, MAX_STRING)}… (+${item.length - MAX_STRING})` : item
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
  return { truncated: true, preview: cutText(text, MAX_JSON) }
}

@Injectable()
export class McpAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rivalNotes: RivalNotesService,
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

  async keepUndo(id: number, undo: AuditUndo, db: Prisma.TransactionClient = this.prisma): Promise<void> {
    await db.mcpAudit.update({ where: { id }, data: { undo: undo as unknown as Prisma.InputJsonValue } })
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
        // A failed write has nothing to undo, even if it kept a copy before failing.
        undo: outcome.ok && outcome.undo ? (outcome.undo as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
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
      where: {
        tool: MCP_WRITE_TOOLS.matchesDelete.name,
        OR: [{ ok: true }, { error: AUDIT_PENDING }],
        undoneAt: null,
        undo: { path: ['match', 'id'], equals: matchId },
      },
      orderBy: { id: 'desc' },
    })
    const row = rows.find(undoable)
    if (!row) {
      throw new NotFoundException(
        `No hay una partida ${matchId} borrada por Claude para devolver (las que se borran en la app no pasan por el registro).`,
      )
    }
    return this.apply(row)
  }

  private async apply(row: McpAudit): Promise<McpAuditView> {
    const undo = row.undo as AuditUndo | null
    if (!undo || !undoable(row)) {
      throw new BadRequestException({ code: 'not_undoable', message: 'Esta escritura no se puede deshacer.' })
    }
    // Claimed first, so two «Deshacer» at once do not both run; released again if undoing fails.
    const claimed = await this.prisma.mcpAudit.updateMany({
      where: { id: row.id, undoneAt: null },
      data: { undoneAt: new Date() },
    })
    if (claimed.count === 0) throw new ConflictException({ code: 'already_undone', message: 'Ya estaba deshecha.' })
    let restoredMatchId: number | undefined
    try {
      if (undo.kind === 'match_delete') restoredMatchId = await this.restoreMatchRow(undo.match)
      else if (undo.kind === 'collection_stock') await this.restoreStock(undo)
      else if (undo.kind === 'rank_change') await this.removeRankChange(undo)
      else await this.restoreRivalNote(undo)
    } catch (error) {
      await this.prisma.mcpAudit.update({ where: { id: row.id }, data: { undoneAt: null } })
      throw error
    }
    const updated = await this.prisma.mcpAudit.findUniqueOrThrow({ where: { id: row.id } })
    this.logger.info({ audit: row.id, tool: row.tool, kind: undo.kind }, 'mcp write undone')
    return { ...this.view(updated), ...(restoredMatchId !== undefined ? { restoredMatchId } : {}) }
  }

  /**
   * The deleted match again, with its id when it is free. The id is taken by another match only after something
   * moved the sequence back (the monthly backup drill could, before Fase 43's follow-up): then it gets a new id.
   */
  private async restoreMatchRow(match: Extract<AuditUndo, { kind: 'match_delete' }>['match']): Promise<number> {
    // One transaction: if the sequence cannot be fixed, the match is not back either (and «Deshacer» can be retried).
    return this.prisma.$transaction(async (tx) => {
      // No other insert into matches until this commits, and the checks below run after any insert in flight:
      // nobody takes the id or the phone's clientRef in between.
      await tx.$executeRawUnsafe('LOCK TABLE "matches" IN SHARE ROW EXCLUSIVE MODE')
      const holder = await tx.match.findUnique({ where: { id: match.id }, select: { createdAt: true } })
      if (holder && holder.createdAt.toISOString() === match.createdAt) {
        throw new ConflictException({ code: 'match_exists', message: `La partida ${match.id} ya está en la app.` })
      }
      const revision = await tx.deckRevision.findUnique({
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
        ? await tx.match.findUnique({ where: { clientRef: match.clientRef }, select: { id: true } })
        : null
      if (resent) {
        throw new ConflictException({
          code: 'match_resent',
          message: `Esa partida ya volvió a entrar desde el celu (partida ${resent.id}): no la duplico.`,
        })
      }
      // A taken id means the sequence was moved back: past every id first, or the new one could be taken too.
      if (holder) await this.matchSequencePastIds(tx)
      const created = await tx.match.create({
        data: {
          ...(holder ? {} : { id: match.id }),
          deckId: match.deckId,
          deckRevisionId: match.deckRevisionId,
          result: match.result,
          opponentText: match.opponentText,
          opponentCards: match.opponentCards ?? [],
          wentFirst: match.wentFirst,
          mode: match.mode,
          note: match.note,
          playedAt: new Date(match.playedAt),
          source: match.source,
          clientRef: match.clientRef,
          createdAt: new Date(match.createdAt),
        },
        select: { id: true },
      })
      // An explicit id does not move the sequence: keep it past every id.
      await this.matchSequencePastIds(tx)
      return created.id
    })
  }

  /** The matches sequence past every id, never moved back (one statement). */
  private async matchSequencePastIds(db: Prisma.TransactionClient): Promise<void> {
    await db.$executeRawUnsafe(
      `SELECT setval(s.seq, GREATEST(COALESCE(pg_sequence_last_value(s.seq), 1), (SELECT COALESCE(MAX(id), 1) FROM "matches")), true)
       FROM (SELECT pg_get_serial_sequence('"matches"', 'id')::regclass AS seq) s`,
    )
  }

  /**
   * Back to the row before the edit, in one conditional write: only if the row is still exactly what the edit left
   * (values and `updated_at`), so a later edit or CSV import, even one landing right now, is never overwritten.
   * Undoing the newest of two edits of the same card hands the row back to the older one, which can then be undone
   * too (in reverse order).
   */
  private async restoreStock(undo: Extract<AuditUndo, { kind: 'collection_stock' }>): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const restored = await tx.collectionStock.updateMany({
        where: {
          cardId: undo.cardId,
          amountOwned: undo.after.amountOwned,
          collected: undo.after.collected,
          ...(undo.afterUpdatedAt !== undefined ? { updatedAt: new Date(undo.afterUpdatedAt) } : {}),
        },
        data: {
          amountOwned: undo.before?.amountOwned ?? 0,
          collected: undo.before?.collected ?? false,
          source: 'manual',
          importId: null,
        },
      })
      if (restored.count === 0) {
        throw new ConflictException({
          code: 'collection_changed',
          message: `${undo.cardId} cambió después (otra edición o un CSV importado): no lo deshago para no pisarlo.`,
        })
      }
      if (!undo.beforeUpdatedAt) return
      const row = await tx.collectionStock.findUniqueOrThrow({ where: { cardId: undo.cardId } })
      // The edit right before this one (the row had not changed in between) now matches the row again.
      const previous = await tx.mcpAudit.findFirst({
        where: {
          tool: MCP_WRITE_TOOLS.collectionSet.name,
          ok: true,
          undoneAt: null,
          AND: [
            { undo: { path: ['cardId'], equals: undo.cardId } },
            { undo: { path: ['afterUpdatedAt'], equals: undo.beforeUpdatedAt } },
          ],
        },
        orderBy: { id: 'desc' },
      })
      if (!previous) return
      const handed = { ...(previous.undo as Extract<AuditUndo, { kind: 'collection_stock' }>) }
      handed.afterUpdatedAt = row.updatedAt.toISOString()
      await tx.mcpAudit.update({
        where: { id: previous.id },
        data: { undo: handed as unknown as Prisma.InputJsonValue },
      })
    })
  }

  /**
   * The note as it was (label and archetype too), in one conditional write: only while it is still what the write left.
   * An entry of the first shape (no key, the text before as a string) gives back the text only.
   */
  private async removeRankChange(undo: Extract<AuditUndo, { kind: 'rank_change' }>): Promise<void> {
    const { count } = await this.prisma.rankChange.deleteMany({ where: { id: Number(undo.id) } })
    if (count === 0) throw new ConflictException({ code: 'changed', message: 'Ese rango ya se borró.' })
  }

  private async restoreRivalNote(undo: Extract<AuditUndo, { kind: 'rival_note' }>): Promise<void> {
    const key = undo.key ?? opponentKey(undo.opponent)
    const before = typeof undo.before === 'string' ? { text: undo.before } : undo.before
    if (!key || !(await this.rivalNotes.restore(key, undo.after, before, undo.afterUpdatedAt, undo.opponent))) {
      throw new ConflictException({
        code: 'note_changed',
        message: `La nota sobre «${undo.opponent}» cambió después: no la deshago para no pisarla.`,
      })
    }
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
      undo: undo && undoable(row) && !row.undoneAt ? { kind: undo.kind, label: undo.label } : null,
      undoneAt: row.undoneAt,
    }
  }
}
