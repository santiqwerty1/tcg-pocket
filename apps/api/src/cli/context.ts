import { type INestApplicationContext, Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module.js'
import { type Env, EnvError, loadEnv } from '../config/env.js'

/** Env + Nest application context (no HTTP server) for the CLI scripts. Exits with a readable message on bad env. */
export async function createCliContext(): Promise<{ env: Env; context: INestApplicationContext }> {
  let env: Env
  try {
    env = loadEnv()
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(error.message)
      process.exit(1)
    }
    throw error
  }
  Logger.overrideLogger(['error', 'warn'])
  const context = await NestFactory.createApplicationContext(AppModule.forRoot({ ...env, logLevel: 'warn' }), {
    logger: ['error', 'warn'],
  })
  return { env, context }
}
