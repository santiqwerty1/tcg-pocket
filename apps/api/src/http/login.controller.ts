import { randomBytes } from 'node:crypto'
import { Controller, Get, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { renderLoginPage } from './login-page.js'
import { contentSecurityPolicy } from './security-headers.middleware.js'

@Controller()
export class LoginController {
  /** Public. Already-authenticated browsers are sent to the app. */
  @Get('login')
  login(@Req() req: Request, @Res() res: Response): void {
    res.setHeader('Cache-Control', 'no-store')
    if (req.session) {
      res.redirect(302, '/')
      return
    }
    const nonce = randomBytes(16).toString('base64url')
    res.setHeader('Content-Security-Policy', contentSecurityPolicy(nonce))
    res.type('html').send(renderLoginPage({ nonce }))
  }
}
