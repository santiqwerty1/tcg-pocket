import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common'
import { Throttle, ThrottlerGuard } from '@nestjs/throttler'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { AuthService, type MeResponse } from './auth.service.js'
import { CurrentSession, type RequestSession } from './request-auth.js'
import { SessionService } from './session.service.js'

export const LOGIN_THROTTLE = { limit: 5, ttl: 15 * 60 * 1000 } as const

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Ingresá tu correo.').max(200),
  password: z.string().min(1, 'Ingresá tu contraseña.').max(1000),
  totp: z.string().trim().max(16).optional(),
})

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(1000),
  newPassword: z.string().min(12, 'La contraseña nueva debe tener al menos 12 caracteres.').max(1000),
})

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Public. 5 attempts per 15 minutes per IP (successful ones count too); the 6th answers 429. Success: 204 + a new
   * session cookie; a still-valid session sent with the request is closed, not kept alive next to the new one.
   */
  @Post('login')
  @HttpCode(204)
  @UseGuards(ThrottlerGuard)
  @Throttle({ login: LOGIN_THROTTLE })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const { cookie } = await this.auth.login(body, { userAgent: req.headers['user-agent'] })
    if (req.session) await this.auth.logout(req.session.idHash)
    res.setHeader('Set-Cookie', cookie)
    res.setHeader('Cache-Control', 'no-store')
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentSession() session: RequestSession, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(session.idHash)
    res.setHeader('Set-Cookie', this.sessions.clearCookie())
    res.setHeader('Cache-Control', 'no-store')
  }

  @Get('me')
  me(@CurrentSession() _session: RequestSession): Promise<MeResponse> {
    return this.auth.me()
  }

  @Post('password')
  @HttpCode(204)
  async changePassword(
    @Body(new ZodValidationPipe(passwordSchema)) body: z.infer<typeof passwordSchema>,
    @CurrentSession() session: RequestSession,
  ): Promise<void> {
    await this.auth.changePassword(body, session.idHash)
  }
}
