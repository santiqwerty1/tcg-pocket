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

export interface CatalogSyncOrigins {
  trackerCommit: 'flag' | 'loaded' | 'pin'
  engineRev: 'flag' | 'env' | 'default'
}

/** Where each sha of the request comes from, as `catalogSyncRequest` picks it. */
export function catalogSyncOrigins(
  args: CatalogSyncArgs,
  loadedCommit: string | null,
  engineRevInEnv: boolean,
): CatalogSyncOrigins {
  return {
    trackerCommit: args.commit !== undefined ? 'flag' : loadedCommit !== null ? 'loaded' : 'pin',
    engineRev: args.engineRev !== undefined ? 'flag' : engineRevInEnv ? 'env' : 'default',
  }
}

const TRACKER_FROM = { flag: '--commit', loaded: 'the loaded catalog', pin: 'CATALOG_COMMIT' } as const
const ENGINE_FROM = {
  flag: '--engine-rev',
  env: 'ENGINE_REV in the environment',
  default: "this build's DEFAULT_ENGINE_REV",
} as const

/**
 * The line the CLI prints before syncing (19/10/2026: a sync after a deploy wrote the previous engine and nothing said
 * why): the build, and each sha with where it came from.
 */
export function describeSyncRequest(request: SyncRequest, origins: CatalogSyncOrigins, version: string): string {
  return (
    `catalog:sync ${version}: tracker ${request.trackerCommit.slice(0, 7)} (${TRACKER_FROM[origins.trackerCommit]}), ` +
    `engine ${request.engineRev.slice(0, 7)} (${ENGINE_FROM[origins.engineRev]})`
  )
}
