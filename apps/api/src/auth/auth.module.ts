import { Module } from '@nestjs/common'
import { ThrottlerModule } from '@nestjs/throttler'
import { AuthController, LOGIN_THROTTLE } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { OwnerService } from './owner.service.js'
import { SessionService } from './session.service.js'

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'login', limit: LOGIN_THROTTLE.limit, ttl: LOGIN_THROTTLE.ttl }],
      errorMessage: 'Demasiados intentos. Esperá 15 minutos y volvé a probar.',
    }),
  ],
  controllers: [AuthController],
  providers: [OwnerService, SessionService, AuthService],
  exports: [OwnerService, SessionService, AuthService],
})
export class AuthModule {}
