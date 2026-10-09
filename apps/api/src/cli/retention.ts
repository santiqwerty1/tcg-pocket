/**
 * `pnpm -F @tcg/api retention [--apply]` (in production: `node /app/apps/api/dist/cli/retention.js [--apply]` through
 * `flyctl machine exec`). The cleanup of Fase 39: without `--apply` a dry run — what it would delete, nothing
 * deleted; with `--apply` it deletes. The daily run stays off until RETENTION_CRON=true.
 */
import { parseArgs } from 'node:util'
import { RetentionService } from '../ops/retention.service.js'
import { createCliContext } from './context.js'

const { values } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: true,
})

if (values.help) {
  console.log('Usage: retention [--apply]   (without --apply: dry run, nothing deleted)')
  process.exit(0)
}

const { context } = await createCliContext()
let exitCode = 0
try {
  const result = await context.get(RetentionService).run({ dryRun: !values.apply })
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(`retention failed: ${error instanceof Error ? error.message : String(error)}`)
  exitCode = 1
} finally {
  await context.close()
}
process.exit(exitCode)
