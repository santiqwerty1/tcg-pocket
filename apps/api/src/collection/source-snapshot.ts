/**
 * What a request against the collection sources depends on, taken when it starts and compared before it writes or
 * answers (T-020, Codex on #150): the ptcgpocket.gg link (by its keyed fingerprint), the tracker's friend id and the
 * catalog loaded in memory. A sync, an apply, «Tracker al día» and the sync's state and alert all take one; if
 * something changed while the request was in flight (another tab saved a link, a catalog sync reloaded), the result
 * is discarded or refused with a clear error instead of being written under the new configuration.
 *
 * The link itself travels in the snapshot only for the request that needs it; it is never logged or returned.
 */
import { Injectable } from '@nestjs/common'
import { CatalogService } from '../catalog/catalog.service.js'
import type { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { DotggLinkStore } from './dotgg-link.store.js'

export interface SourceSnapshot {
  /** The readable link, for the request that reads it (never logged or returned). */
  link: string | null
  /** Its keyed fingerprint, what gets compared and stored. */
  linkId: string | null
  /** A link is stored but cannot be opened. */
  unreadable: boolean
  friendId: string
  /** The catalog sync loaded in memory. */
  catalogSyncId: number | null
}

export type SnapshotPart = 'link' | 'friend' | 'catalog'

const LABELS: Record<SnapshotPart, string> = {
  link: 'el link de ptcgpocket.gg',
  friend: 'el friend_id del tracker',
  catalog: 'el catálogo',
}

type Reader = Pick<Prisma.TransactionClient, 'appSecret' | 'appSetting'>

@Injectable()
export class SourceSnapshots {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: DotggLinkStore,
    private readonly catalog: CatalogService,
  ) {}

  async take(db: Reader = this.prisma): Promise<SourceSnapshot> {
    const [state, friend] = await Promise.all([
      this.links.state(db),
      db.appSetting.findUnique({ where: { key: 'trackerFriendId' } }),
    ])
    return {
      link: state.link,
      linkId: state.link ? this.links.fingerprint(state.link) : null,
      unreadable: state.unreadable,
      friendId: typeof friend?.value === 'string' ? friend.value : '',
      catalogSyncId: this.catalog.loadedSyncId,
    }
  }

  /** What differs between two snapshots, among `parts`. */
  changes(before: SourceSnapshot, after: SourceSnapshot, parts: readonly SnapshotPart[]): SnapshotPart[] {
    return parts.filter((part) =>
      part === 'link'
        ? before.linkId !== after.linkId || before.unreadable !== after.unreadable
        : part === 'friend'
          ? before.friendId !== after.friendId
          : before.catalogSyncId !== after.catalogSyncId,
    )
  }

  /**
   * Takes a snapshot now, under the configuration lock (994202, the one saving a link or a friend id takes), and runs
   * `write` in that same transaction only if nothing in `parts` changed since `before`. Returns what changed.
   */
  async whileSame(
    before: SourceSnapshot,
    parts: readonly SnapshotPart[],
    write?: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ): Promise<SnapshotPart[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(994202)`
      const changed = this.changes(before, await this.take(tx), parts)
      if (changed.length === 0 && write) await write(tx)
      return changed
    })
  }

  /** «el link de ptcgpocket.gg y el catálogo», for an error message. */
  describe(changed: readonly SnapshotPart[]): string {
    const labels = changed.map((part) => LABELS[part])
    return labels.length <= 1 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} y ${labels.at(-1)}`
  }
}
