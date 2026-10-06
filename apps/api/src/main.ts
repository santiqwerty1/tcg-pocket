import { Logger } from 'nestjs-pino'
import { createApp } from './app.js'
import { type Env, EnvError, loadEnv } from './config/env.js'

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

const app = await createApp(env)
await app.listen(env.port)
app.get(Logger).log(`tcg-pocket api ${env.version} listening on port ${env.port} (${env.nodeEnv})`)
