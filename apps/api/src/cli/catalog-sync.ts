/**
 * `pnpm -F @tcg/api catalog:sync [--commit <sha>] [--engine-rev <sha>] [--from-fixtures]`
 * Defaults to the pinned CATALOG_COMMIT / ENGINE_REV. `--from-fixtures` reads packages/domain/test/fixtures
 * instead of raw.githubusercontent.com (offline, tests).
 */
import { parseArgs } from 'node:util'
import { CatalogSyncService } from '../catalog/catalog-sync.service.js'
import { createCliContext } from './context.js'

const { values } = parseArgs({
  options: {
    commit: { type: 'string' },
    'engine-rev': { type: 'string' },
    'from-fixtures': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: true,
})

if (values.help) {
  console.log('Usage: catalog:sync [--commit <sha>] [--engine-rev <sha>] [--from-fixtures]')
  process.exit(0)
}

const { env, context } = await createCliContext()
let exitCode = 0
try {
  const summary = await context.get(CatalogSyncService).sync({
    trackerCommit: values.commit ?? env.catalogCommit,
    engineRev: values['engine-rev'] ?? env.engineRev,
    source: values['from-fixtures'] ? 'fixtures' : 'github',
  })
  console.log(JSON.stringify(summary, null, 2))
  if (summary.status === 'needs_review') exitCode = 2
} catch (error) {
  console.error(`catalog sync failed: ${error instanceof Error ? error.message : String(error)}`)
  exitCode = 1
} finally {
  await context.close()
}
process.exit(exitCode)
