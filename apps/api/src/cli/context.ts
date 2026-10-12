import { type INestApplicationContext, Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module.js'
import { type Env, EnvError, loadEnv } from '../config/env.js'

/**
 * Env + Nest application context (no HTTP server) for the CLI scripts, without the server's crons, watchers and
 * start-up work (`env.cli`): a CLI runs next to the API and must not touch its state. Exits with a readable message
 * on bad env.
 */
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
  return { env, context: await createCliApplication(env) }
}

/** The application context of a CLI for `env` (the e2e tests use it to check that it leaves the state alone). */
export async function createCliApplication(env: Env): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(AppModule.forRoot({ ...env, cli: true, logLevel: 'warn' }), {
    logger: ['error', 'warn'],
  })
}
