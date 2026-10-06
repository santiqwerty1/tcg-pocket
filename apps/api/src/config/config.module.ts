import { type DynamicModule, Module } from '@nestjs/common'
import { ENV, type Env } from './env.js'

@Module({})
export class ConfigModule {}

/** Makes the validated `Env` injectable everywhere (global): `@Inject(ENV) env: Env`. */
export function configModule(env: Env): DynamicModule {
  return {
    module: ConfigModule,
    global: true,
    providers: [{ provide: ENV, useValue: env }],
    exports: [ENV],
  }
}
