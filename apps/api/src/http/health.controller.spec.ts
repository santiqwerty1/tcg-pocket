import { ServiceUnavailableException } from '@nestjs/common'
import type { CatalogService } from '../catalog/catalog.service.js'
import type { Env } from '../config/env.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import { HealthController } from './health.controller.js'

function controller(queryRaw: () => Promise<unknown>): HealthController {
  const env = { version: '1.2.3' } as Env
  const catalog = { trackerCommit: 'abc', engineRev: 'def' } as CatalogService
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService
  return new HealthController(env, catalog, prisma)
}

describe('HealthController', () => {
  it('answers ok with the version and the loaded catalog when the database replies', async () => {
    await expect(controller(() => Promise.resolve([{ '?column?': 1 }])).health()).resolves.toEqual({
      ok: true,
      version: '1.2.3',
      catalogCommit: 'abc',
      engineRev: 'def',
    })
  })

  it('answers 503 unavailable when the database query fails', async () => {
    const error = await controller(() => Promise.reject(new Error('connection refused')))
      .health()
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ServiceUnavailableException)
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      code: 'unavailable',
      message: 'La base de datos no responde.',
    })
  })

  it('answers 503 when the database does not reply within the ping timeout', async () => {
    vi.useFakeTimers()
    try {
      const pending = controller(() => new Promise(() => undefined)).health()
      const outcome = pending.catch((caught: unknown) => caught)
      await vi.advanceTimersByTimeAsync(3001)
      expect(await outcome).toBeInstanceOf(ServiceUnavailableException)
    } finally {
      vi.useRealTimers()
    }
  })
})
