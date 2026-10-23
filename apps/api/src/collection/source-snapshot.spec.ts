import { describe, expect, it } from 'vitest'
import type { CatalogService } from '../catalog/catalog.service.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import type { DotggLinkStore } from './dotgg-link.store.js'
import { type SourceSnapshot, SourceSnapshots } from './source-snapshot.js'

const snapshots = new SourceSnapshots(
  {} as unknown as PrismaService,
  {} as unknown as DotggLinkStore,
  {} as unknown as CatalogService,
)
const base: SourceSnapshot = { link: 'L', linkId: 'a', unreadable: false, friendId: '1', catalogSyncId: 7 }

describe('SourceSnapshots.changes', () => {
  it('names each part that changed, and only among the parts asked for', () => {
    const all = ['link', 'friend', 'catalog'] as const
    expect(snapshots.changes(base, { ...base }, all)).toEqual([])
    expect(snapshots.changes(base, { ...base, linkId: 'b' }, all)).toEqual(['link'])
    expect(snapshots.changes(base, { ...base, linkId: null, unreadable: true }, all)).toEqual(['link'])
    expect(snapshots.changes(base, { ...base, friendId: '2' }, all)).toEqual(['friend'])
    expect(snapshots.changes(base, { ...base, catalogSyncId: 8 }, all)).toEqual(['catalog'])
    expect(snapshots.changes(base, { ...base, catalogSyncId: 8, friendId: '2' }, ['link'])).toEqual([])
  })

  it('says what changed in Spanish', () => {
    expect(snapshots.describe(['catalog'])).toBe('el catálogo')
    expect(snapshots.describe(['link', 'friend', 'catalog'])).toBe(
      'el link de ptcgpocket.gg, el friend_id del tracker y el catálogo',
    )
  })
})
