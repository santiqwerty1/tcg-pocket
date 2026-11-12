/**
 * infra-egress: the pool keeps one connection open for good (`min: 1`). A raw client whose session lock or transaction
 * could not be ended goes back to the pool destroyed (`release(error)`), never with the lock or the transaction still
 * on it. Each place that holds a raw client, with a fake one whose unlock or ROLLBACK fails.
 */
import { BadRequestException } from '@nestjs/common'
import type { Catalog, CatalogIndex } from '@tcg/domain'
import type { PinoLogger } from 'nestjs-pino'
import { describe, expect, it, vi } from 'vitest'
import type { CatalogService } from '../catalog/catalog.service.js'
import { CatalogRepository, type SyncOutcome } from '../catalog/catalog-repository.js'
import { CollectionService } from '../collection/collection.service.js'
import { DotggSync } from '../collection/dotgg-sync.service.js'
import { TrackerSync } from '../collection/tracker-sync.service.js'
import type { Env } from '../config/env.js'
import type { PrismaService } from './prisma.service.js'

/** A raw client that answers every statement except the ones `fails` names, which throw. */
function rawClient(fails: RegExp | null) {
  const statements: string[] = []
  const client = {
    query: vi.fn(async (sql: string) => {
      statements.push(sql)
      if (fails?.test(sql)) throw new Error(`falló: ${sql}`)
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    }),
    release: vi.fn(),
  }
  const prisma = { pool: { connect: async () => client } } as unknown as PrismaService
  return { client, prisma, statements }
}

const logger = { setContext: () => undefined, warn: () => undefined, info: () => undefined } as unknown as PinoLogger
const env = {} as Env

/** The error `release` got, or undefined. */
const releasedWith = (client: ReturnType<typeof rawClient>['client']) => client.release.mock.calls[0]?.[0]

function dotgg(prisma: PrismaService) {
  const collection = { importPreview: async () => ({ source: 'tracker' }) } as unknown as CollectionService
  const snapshots = { take: async () => ({ link: null, unreadable: false }) }
  const sync = new DotggSync({} as never, {} as never, snapshots as never, collection, prisma, logger, env)
  vi.spyOn(sync, 'status').mockResolvedValue({ enabled: false, lastAttemptAt: null } as never)
  return sync
}

function tracker(prisma: PrismaService) {
  const collection = { importPreview: async () => ({ source: 'dotgg' }) } as unknown as CollectionService
  const sync = new TrackerSync({} as never, collection, prisma, logger, env, {} as never, {} as never, {} as never)
  vi.spyOn(sync, 'status').mockResolvedValue({ enabled: false, lastAttemptAt: null } as never)
  return sync
}

describe('raw pool clients (infra-egress)', () => {
  describe.each([
    ['ptcgpocket.gg', dotgg],
    ['tracker', tracker],
  ] as const)('the %s sync lock', (_name, make) => {
    it('an unlock that fails destroys the connection, in the preview and in the apply', async () => {
      const preview = rawClient(/pg_advisory_unlock/)
      expect(await make(preview.prisma).preview(true)).toBeNull()
      expect(preview.statements.some((sql) => sql.includes('pg_advisory_unlock'))).toBe(true)
      expect(releasedWith(preview.client)).toBeInstanceOf(Error)
      const apply = rawClient(/pg_advisory_unlock/)
      await expect(make(apply.prisma).apply('7')).rejects.toBeInstanceOf(BadRequestException)
      expect(releasedWith(apply.client)).toBeInstanceOf(Error)
    })

    it('an unlock that works gives the connection back as it is', async () => {
      const preview = rawClient(null)
      expect(await make(preview.prisma).preview(true)).toBeNull()
      expect(preview.client.release).toHaveBeenCalledWith(undefined)
      const apply = rawClient(null)
      await expect(make(apply.prisma).apply('7')).rejects.toBeInstanceOf(BadRequestException)
      expect(apply.client.release).toHaveBeenCalledWith(undefined)
    })
  })

  describe('a transaction whose ROLLBACK fails destroys the connection', () => {
    // The catalog's replace and the collection's import (its preview and its apply) fail inside the transaction.
    const cases = [
      [
        'replaceCatalog',
        (prisma: PrismaService) => {
          const catalog = {
            get expansions(): never {
              throw new Error('catálogo roto')
            },
          } as unknown as Catalog
          return new CatalogRepository(prisma).replaceCatalog(catalog, {} as SyncOutcome)
        },
      ],
      [
        'the import preview',
        (prisma: PrismaService) => {
          const service = new CollectionService({} as CatalogService, prisma, {} as never, {} as never)
          const createRows = (service as unknown as { createRows: (...args: unknown[]) => Promise<unknown> }).createRows
          return createRows.call(
            service,
            {} as CatalogIndex,
            { rows: [], errors: [], bom: false, lineEnding: 'LF' },
            { bytes: Buffer.from(''), fileName: 'export.csv' },
          )
        },
      ],
      [
        'the import apply',
        (prisma: PrismaService) => {
          const catalog = { requireIndex: () => ({}) } as unknown as CatalogService
          const service = new CollectionService(catalog, prisma, {} as never, {} as never)
          vi.spyOn(service as unknown as { requireImport: () => Promise<unknown> }, 'requireImport').mockResolvedValue({
            id: 7,
            status: 'pending',
            source: 'csv',
            diffSummary: null,
            rows: [],
          })
          return service.applyImport('7')
        },
      ],
    ] as const

    it.each(cases)('%s', async (_name, run) => {
      // The first statement after BEGIN fails (or the transaction's own work), and then the ROLLBACK.
      const broken = rawClient(/^(LOCK TABLE|ROLLBACK)/)
      await expect(run(broken.prisma)).rejects.toThrow()
      expect(broken.statements[0]).toBe('BEGIN')
      expect(broken.statements.at(-1)).toBe('ROLLBACK')
      expect(releasedWith(broken.client)).toBeInstanceOf(Error)
      expect((releasedWith(broken.client) as Error).message).toContain('ROLLBACK')
    })

    it.each(cases)('%s: a ROLLBACK that works gives the connection back as it is', async (_name, run) => {
      const rolledBack = rawClient(/^LOCK TABLE/)
      await expect(run(rolledBack.prisma)).rejects.toThrow()
      expect(rolledBack.statements.at(-1)).toBe('ROLLBACK')
      expect(rolledBack.client.release).toHaveBeenCalledWith(undefined)
    })
  })
})
