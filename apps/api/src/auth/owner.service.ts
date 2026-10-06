import { Inject, Injectable } from '@nestjs/common'
import { ENV, type Env } from '../config/env.js'
import type { Owner } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { SecretBox } from './secret-box.js'

export const OWNER_ID = 1

/** The single owner row (id = 1). The TOTP secret is sealed with a key derived from SESSION_SECRET. */
@Injectable()
export class OwnerService {
  private readonly box: SecretBox

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) env: Env,
  ) {
    this.box = new SecretBox(env.sessionSecret)
  }

  get(): Promise<Owner | null> {
    return this.prisma.owner.findUnique({ where: { id: OWNER_ID } })
  }

  /** Creates or replaces the owner credentials. `totpSecret` null disables TOTP. */
  async upsert(input: { email: string; passwordHash: string; totpSecret: string | null }): Promise<Owner> {
    const totpSecretEnc = input.totpSecret === null ? null : this.box.seal(input.totpSecret)
    const email = input.email.trim().toLowerCase()
    return this.prisma.owner.upsert({
      where: { id: OWNER_ID },
      create: { id: OWNER_ID, email, passwordHash: input.passwordHash, totpSecretEnc },
      update: { email, passwordHash: input.passwordHash, totpSecretEnc },
    })
  }

  setPasswordHash(passwordHash: string): Promise<Owner> {
    return this.prisma.owner.update({ where: { id: OWNER_ID }, data: { passwordHash } })
  }

  totpSecretOf(owner: Owner): string | null {
    return owner.totpSecretEnc === null ? null : this.box.open(owner.totpSecretEnc)
  }
}
