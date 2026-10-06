import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { OwnerService } from './owner.service.js'
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password.js'
import { SessionService } from './session.service.js'
import { verifyTotp } from './totp.js'

export interface LoginInput {
  email: string
  password: string
  totp?: string | undefined
}

export interface MeResponse {
  email: string
  totpEnabled: boolean
}

export class LoginError extends UnauthorizedException {
  constructor(code: 'invalid_credentials' | 'totp_required') {
    super({
      statusCode: 401,
      error: 'Unauthorized',
      code,
      message: code === 'totp_required' ? 'Falta el código de 6 dígitos.' : 'Credenciales inválidas.',
    })
  }
}

@Injectable()
export class AuthService {
  constructor(
    private readonly owners: OwnerService,
    private readonly sessions: SessionService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AuthService.name)
  }

  /** Password + TOTP (when enrolled). Every failure is a generic 401 except a missing code, which the form can ask for. */
  async login(
    input: LoginInput,
    meta: { userAgent?: string | undefined },
  ): Promise<{ cookie: string; me: MeResponse }> {
    const owner = await this.owners.get()
    if (!owner || owner.email !== input.email.trim().toLowerCase()) {
      await verifyAgainstDummy(input.password)
      this.logger.warn('login failed: unknown email')
      throw new LoginError('invalid_credentials')
    }
    const passwordOk = await verifyPassword(owner.passwordHash, input.password)
    if (!passwordOk) {
      this.logger.warn('login failed: wrong password')
      throw new LoginError('invalid_credentials')
    }
    const totpSecret = this.owners.totpSecretOf(owner)
    if (totpSecret !== null) {
      const token = (input.totp ?? '').replace(/\s+/g, '')
      if (token === '') throw new LoginError('totp_required')
      if (!(await verifyTotp(totpSecret, token))) {
        this.logger.warn('login failed: wrong TOTP code')
        throw new LoginError('invalid_credentials')
      }
    }
    const { cookie } = await this.sessions.create({ userAgent: meta.userAgent })
    this.logger.info('login ok')
    return { cookie, me: { email: owner.email, totpEnabled: totpSecret !== null } }
  }

  async me(): Promise<MeResponse> {
    const owner = await this.owners.get()
    if (!owner) throw new UnauthorizedException('No hay usuario configurado.')
    return { email: owner.email, totpEnabled: owner.totpSecretEnc !== null }
  }

  async logout(idHash: string): Promise<void> {
    await this.sessions.destroy(idHash)
  }

  /** Changes the password after re-verifying the current one and logs every other session out. */
  async changePassword(input: { currentPassword: string; newPassword: string }, currentIdHash: string): Promise<void> {
    const owner = await this.owners.get()
    if (!owner || !(await verifyPassword(owner.passwordHash, input.currentPassword))) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        code: 'invalid_credentials',
        message: 'La contraseña actual no es correcta.',
      })
    }
    await this.owners.setPasswordHash(await hashPassword(input.newPassword))
    const closed = await this.sessions.destroyAllExcept(currentIdHash)
    this.logger.info({ closedSessions: closed }, 'password changed')
  }
}
