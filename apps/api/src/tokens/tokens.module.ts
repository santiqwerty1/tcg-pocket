import { Module } from '@nestjs/common'
import { BearerTokenGuard } from './bearer-token.guard.js'
import { TokensController } from './tokens.controller.js'
import { TokensService } from './tokens.service.js'

@Module({
  controllers: [TokensController],
  providers: [TokensService, BearerTokenGuard],
  exports: [TokensService, BearerTokenGuard],
})
export class TokensModule {}
