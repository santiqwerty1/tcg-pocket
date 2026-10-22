/**
 * Where the ptcgpocket.gg export link lives (T-020): `app_secrets`, sealed with AES-256-GCM under a key derived from
 * SESSION_SECRET (the same SecretBox as the TOTP secret, another purpose). Neither `GET /api/settings` nor the backup
 * read that table, and nothing serves the link: the API answers `maskDotggExportLink`.
 */
import { createHmac, hkdfSync } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { maskDotggExportLink } from '@tcg/domain'
import { SecretBox } from '../auth/secret-box.js'
import { ENV, type Env } from '../config/env.js'
import type { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'

export const DOTGG_LINK_KEY = 'dotggExportUrl'

/** The stored link as the API may show it. */
export interface DotggLinkState {
  /** The link, only for the server's own requests. */
  link: string | null
  masked: string | null
  /** A value is stored but cannot be opened (SESSION_SECRET changed): it counts as not configured. */
  unreadable: boolean
}

type SecretReader = Pick<Prisma.TransactionClient, 'appSecret'>

@Injectable()
export class DotggLinkStore {
  private readonly box: SecretBox
  private readonly idKey: Buffer

  constructor(
    @Inject(ENV) env: Env,
    private readonly prisma: PrismaService,
  ) {
    this.box = new SecretBox(env.sessionSecret, 'tcg-pocket/dotgg-export-link')
    this.idKey = Buffer.from(hkdfSync('sha256', env.sessionSecret, 'tcg-pocket', 'tcg-pocket/dotgg-link-id', 32))
  }

  seal(link: string): string {
    return this.box.seal(link)
  }

  /** The link inside a stored value, or null when there is none or it cannot be opened. */
  open(sealed: string | null | undefined): string | null {
    if (!sealed) return null
    try {
      return this.box.open(sealed)
    } catch {
      return null
    }
  }

  async state(db: SecretReader = this.prisma): Promise<DotggLinkState> {
    const row = await db.appSecret.findUnique({ where: { key: DOTGG_LINK_KEY } })
    const link = this.open(row?.value)
    return { link, masked: link ? maskDotggExportLink(link) : null, unreadable: !!row && !link }
  }

  async read(db: SecretReader = this.prisma): Promise<string | null> {
    return (await this.state(db)).link
  }

  /**
   * A link is stored, readable or not: ptcgpocket.gg is the source of the collection. An unreadable one (SESSION_SECRET
   * changed) still counts, so the tracker never takes the collection back by itself; Santi pastes it again or removes it.
   */
  async present(db: SecretReader = this.prisma): Promise<boolean> {
    return (await db.appSecret.count({ where: { key: DOTGG_LINK_KEY } })) > 0
  }

  /**
   * Which link a snapshot was read from, without keeping the link: an HMAC-SHA256 under a key derived from
   * SESSION_SECRET for this purpose only, so the value a preview stores (and a backup carries) cannot be checked
   * against guesses without the server's key. A preview applies only with the link it was read from.
   */
  fingerprint(link: string): string {
    return createHmac('sha256', this.idKey).update(link).digest('hex')
  }
}
