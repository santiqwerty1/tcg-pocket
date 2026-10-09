import type { PinoLogger } from 'nestjs-pino'
import { describe, expect, it } from 'vitest'
import type { Env } from '../config/env.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import { OFFSITE_KEPT, OffsiteBackupService, offsiteKey, parseListObjects } from './offsite.service.js'

const LIST_PAGE = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>tcg</Name><Prefix>backups/</Prefix><KeyCount>2</KeyCount><IsTruncated>true</IsTruncated>
  <NextContinuationToken>abc&amp;1</NextContinuationToken>
  <Contents><Key>backups/tcg-pocket-2026-10-08T07-00-00-000Z.json.gz</Key><LastModified>2026-10-08T07:00:01.000Z</LastModified><Size>105170</Size></Contents>
  <Contents><Key>backups/a&amp;b.json.gz</Key><LastModified>2026-10-09T07:00:01.000Z</LastModified><Size>7</Size></Contents>
</ListBucketResult>`

/** An S3 bucket in memory: PUT, ListObjectsV2 (one page) and DELETE, checking that every request is signed. */
function fakeBucket(initial: string[], options: { failPut?: boolean } = {}) {
  const objects = new Map(initial.map((key) => [key, new Uint8Array([1])]))
  const seen: string[] = []
  const fetchImpl = async (request: Request) => {
    const url = new URL(request.url)
    const auth = request.headers.get('authorization') ?? ''
    expect(auth.startsWith('AWS4-HMAC-SHA256 Credential=AKIATEST/')).toBe(true)
    seen.push(`${request.method} ${url.pathname}${url.search ? '?list' : ''}`)
    const key = decodeURIComponent(url.pathname.replace(/^\/tcg\/?/, ''))
    if (request.method === 'PUT') {
      if (options.failPut) return new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 })
      objects.set(key, new Uint8Array(await request.arrayBuffer()))
      return new Response('', { status: 200 })
    }
    if (request.method === 'DELETE') {
      objects.delete(key)
      return new Response(null, { status: 204 })
    }
    const contents = [...objects.keys()]
      .filter((name) => name.startsWith(url.searchParams.get('prefix') ?? ''))
      .map((name) => `<Contents><Key>${name}</Key><LastModified>x</LastModified><Size>1</Size></Contents>`)
      .join('')
    return new Response(`<ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`)
  }
  return { objects, seen, fetchImpl }
}

function service(fetchImpl: (request: Request) => Promise<Response>) {
  const saved: unknown[] = []
  const env = {
    offsite: {
      accessKeyId: 'AKIATEST',
      secretAccessKey: 'secret-test',
      endpoint: 'https://bucket.test',
      region: 'auto',
      bucket: 'tcg',
    },
  } as Env
  const prisma = {
    appSetting: {
      upsert: async (args: { create: { value: unknown } }) => {
        saved.push(args.create.value)
        return args.create
      },
      findUnique: async () => null,
    },
  } as unknown as PrismaService
  const logger = { setContext: () => undefined, info: () => undefined, error: () => undefined } as unknown as PinoLogger
  const offsite = new OffsiteBackupService(env, prisma, logger)
  offsite.fetchImpl = fetchImpl
  return { offsite, saved }
}

describe('the copy outside Supabase (Fase 39)', () => {
  it('names copies so they sort by date and reads a ListObjectsV2 page', () => {
    expect(offsiteKey(new Date('2026-10-09T07:00:00.123Z'))).toBe('backups/tcg-pocket-2026-10-09T07-00-00-123Z.json.gz')
    const page = parseListObjects(LIST_PAGE)
    expect(page.objects).toEqual([
      {
        key: 'backups/tcg-pocket-2026-10-08T07-00-00-000Z.json.gz',
        size: 105170,
        lastModified: '2026-10-08T07:00:01.000Z',
      },
      { key: 'backups/a&b.json.gz', size: 7, lastModified: '2026-10-09T07:00:01.000Z' },
    ])
    expect(page.next).toBe('abc&1')
    expect(parseListObjects('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>')).toEqual({
      objects: [],
      next: null,
    })
  })

  it('uploads the copy signed and keeps the newest 30', async () => {
    const old = Array.from({ length: OFFSITE_KEPT }, (_, day) => offsiteKey(new Date(Date.UTC(2026, 8, day + 1, 7))))
    const bucket = fakeBucket([...old, 'otra-cosa/no-se-toca.txt'])
    const { offsite, saved } = service(bucket.fetchImpl)
    const createdAt = new Date('2026-10-09T07:00:00Z')
    const result = await offsite.upload(new Uint8Array([31, 139, 8]), createdAt, new Date('2026-10-09T07:00:05Z'))
    expect(result).toEqual({
      at: '2026-10-09T07:00:05.000Z',
      ok: true,
      key: offsiteKey(createdAt),
      error: null,
      kept: OFFSITE_KEPT,
    })
    expect(bucket.objects.get(offsiteKey(createdAt))).toEqual(new Uint8Array([31, 139, 8]))
    // The oldest copy went; what is not a copy stays.
    expect(bucket.objects.has(old[0] as string)).toBe(false)
    expect(bucket.objects.has('otra-cosa/no-se-toca.txt')).toBe(true)
    expect(bucket.seen[0]).toBe(`PUT /tcg/${offsiteKey(createdAt)}`)
    expect(saved).toEqual([result])
  })

  it('a failure is recorded, not thrown', async () => {
    const { offsite, saved } = service(fakeBucket([], { failPut: true }).fetchImpl)
    const result = await offsite.upload(new Uint8Array([1]), new Date('2026-10-09T07:00:00Z'))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/^PUT del bucket: 403 /)
    expect(saved).toEqual([result])
  })
})
