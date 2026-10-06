import { Module } from '@nestjs/common'
import { CatalogModule } from '../catalog/catalog.module.js'
import { HealthController } from './health.controller.js'
import { LoginController } from './login.controller.js'
import { WellKnownController } from './well-known.controller.js'

/** Public surface: /healthz, /login, /.well-known/*. The session middleware itself is wired in AppModule. */
@Module({
  imports: [CatalogModule],
  controllers: [HealthController, LoginController, WellKnownController],
})
export class HttpModule {}
