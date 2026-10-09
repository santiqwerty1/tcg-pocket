/**
 * `pnpm -F @tcg/api catalog:sync [--commit <sha>] [--engine-rev <sha>] [--from-fixtures] [--confirm]`
 * Without `--commit`, the commit loaded now (Fase 40; the configured CATALOG_COMMIT only before the first sync);
 * the engine, ENGINE_REV. A sync that takes cards away (or leaves things to review) stops before writing unless
 * `--confirm` (look first with Más → Catálogo or `POST /api/catalog/preview`). `--from-fixtures` reads
 * packages/domain/test/fixtures instead of raw.githubusercontent.com (offline, tests).
 */
import { parseArgs } from 'node:util'
import { CatalogService } from '../catalog/catalog.service.js'
import { CatalogSyncService } from '../catalog/catalog-sync.service.js'
import { catalogSyncRequest } from './catalog-sync-args.js'
import { createCliContext } from './context.js'

const { values } = parseArgs({
  options: {
    commit: { type: 'string' },
    'engine-rev': { type: 'string' },
    'from-fixtures': { type: 'boolean', default: false },
    confirm: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: true,
})

if (values.help) {
  console.log('Usage: catalog:sync [--commit <sha>] [--engine-rev <sha>] [--from-fixtures] [--confirm]')
  process.exit(0)
}

const { env, context } = await createCliContext()
let exitCode = 0
try {
  const request = catalogSyncRequest(
    {
      commit: values.commit,
      engineRev: values['engine-rev'],
      fromFixtures: values['from-fixtures'],
      confirm: values.confirm,
    },
    env,
    context.get(CatalogService).trackerCommit,
  )
  const summary = await context.get(CatalogSyncService).sync(request)
  console.log(JSON.stringify(summary, null, 2))
  if (summary.status === 'needs_review') exitCode = 2
} catch (error) {
  console.error(`catalog sync failed: ${error instanceof Error ? error.message : String(error)}`)
  exitCode = 1
} finally {
  await context.close()
}
process.exit(exitCode)
