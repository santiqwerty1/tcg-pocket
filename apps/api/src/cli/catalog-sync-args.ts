/**
 * `catalog:sync` arguments (Fase 40, H-004 by the CLI's road): without `--commit`, the commit loaded now (never the
 * configured pin, which after an update is older: going back would remap the owner's new cards away). Guarded like
 * the app: a sync that takes cards away stops before writing unless `--confirm`.
 */
import type { SyncRequest } from '../catalog/catalog-sync.service.js'

export interface CatalogSyncArgs {
  commit?: string | undefined
  engineRev?: string | undefined
  fromFixtures: boolean
  confirm: boolean
}

export function catalogSyncRequest(
  args: CatalogSyncArgs,
  pins: { catalogCommit: string; engineRev: string },
  loadedCommit: string | null,
): SyncRequest {
  return {
    trackerCommit: args.commit ?? loadedCommit ?? pins.catalogCommit,
    engineRev: args.engineRev ?? pins.engineRev,
    source: args.fromFixtures ? 'fixtures' : 'github',
    guard: true,
    confirm: args.confirm,
  }
}
