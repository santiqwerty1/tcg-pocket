import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import type { PinoLogger } from 'nestjs-pino'
import { describe, expect, it } from 'vitest'
import type { Env } from '../config/env.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import { OffsiteBackupService, offsiteKey, offsiteKeyDay, parseListObjects } from './offsite.service.js'

const LIST_PAGE = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>tcg</Name><Prefix>backups/</Prefix><KeyCount>2</KeyCount><IsTruncated>true</IsTruncated>
  <NextContinuationToken>abc&amp;1</NextContinuationToken>
  <Contents><Key>backups/tcg-pocket-2026-10-08T07-00-00-000Z.json.gz</Key><LastModified>2026-10-08T07:00:01.000Z</LastModified><Size>105170</Size></Contents>
  <Contents><Key>backups/a&amp;b.json.gz</Key><LastModified>2026-10-09T07:00:01.000Z</LastModified><Size>7</Size></Contents>
</ListBucketResult>`

/**
 * An S3 bucket in memory, virtual-hosted (`tcg.bucket.test`): PUT (checking Content-MD5), GET of an object,
 * ListObjectsV2 (one page) and DELETE, checking that every request is signed.
 */
function fakeBucket(initial: string[], options: { failPut?: boolean; failList?: boolean } = {}) {
  const objects = new Map(initial.map((key) => [key, new Uint8Array([1])]))
  const seen: string[] = []
  const fetchImpl = async (request: Request) => {
    const url = new URL(request.url)
    expect(url.host).toBe('tcg.bucket.test')
    const auth = request.headers.get('authorization') ?? ''
    expect(auth.startsWith('AWS4-HMAC-SHA256 Credential=AKIATEST/')).toBe(true)
    seen.push(`${request.method} ${url.pathname}${url.search ? '?list' : ''}`)
    const key = decodeURIComponent(url.pathname.replace(/^\//, ''))
    if (request.method === 'PUT') {
      if (options.failPut) return new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 })
      const body = new Uint8Array(await request.arrayBuffer())
      expect(request.headers.get('content-md5')).toBe(createHash('md5').update(body).digest('base64'))
      objects.set(key, body)
      return new Response('', { status: 200 })
    }
    if (request.method === 'DELETE') {
      objects.delete(key)
      return new Response(null, { status: 204 })
    }
    if (key) {
      const object = objects.get(key)
      return object ? new Response(object) : new Response('NoSuchKey', { status: 404 })
    }
    if (options.failList) return new Response('SlowDown', { status: 503 })
    const contents = [...objects.keys()]
      .filter((name) => name.startsWith(url.searchParams.get('prefix') ?? ''))
      .map((name) => `<Contents><Key>${name}</Key><LastModified>x</LastModified><Size>1</Size></Contents>`)
      .join('')
    return new Response(`<ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`)
  }
  return { objects, seen, fetchImpl }
}

function service(fetchImpl: (request: Request) => Promise<Response>) {
  const saved: { key: string; value: unknown }[] = []
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
      upsert: async (args: { where: { key: string }; create: { value: unknown } }) => {
        saved.push({ key: args.where.key, value: args.create.value })
        return args.create
      },
      findUnique: async () => null,
    },
  } as unknown as PrismaService
  const logger = {
    setContext: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  } as unknown as PinoLogger
  const offsite = new OffsiteBackupService(env, prisma, logger)
  offsite.fetchImpl = fetchImpl
  return { offsite, saved }
}

const day = (date: string) => offsiteKey(new Date(`${date}T07:00:00Z`))

describe('the copy outside Supabase (Fase 39)', () => {
  it('names copies so they sort by date, reads their day back and reads a ListObjectsV2 page', () => {
    expect(offsiteKey(new Date('2026-10-09T07:00:00.123Z'))).toBe('backups/tcg-pocket-2026-10-09T07-00-00-123Z.json.gz')
    expect(offsiteKeyDay(day('2026-10-09'))).toBe('2026-10-09')
    expect(offsiteKeyDay('backups/otra-cosa.json.gz')).toBeNull()
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

  it('virtual-hosted URLs: the bucket goes in the host', () => {
    const { offsite } = service(async () => new Response(''))
    expect(offsite.url(day('2026-10-09'))).toBe(`https://tcg.bucket.test/${day('2026-10-09')}`)
    expect(offsite.url(undefined, new URLSearchParams({ 'list-type': '2' }))).toBe(
      'https://tcg.bucket.test/?list-type=2',
    )
  })

  it('uploads the copy signed (with Content-MD5) and removes the copies older than 30 days, by their date', async () => {
    const old = ['2026-09-01', '2026-09-08', '2026-09-09', '2026-10-08'].map(day)
    const bucket = fakeBucket([...old, day('2026-10-09'), 'backups/otra-cosa.json.gz'])
    const { offsite, saved } = service(bucket.fetchImpl)
    const createdAt = new Date('2026-10-09T18:00:00Z')
    const result = await offsite.upload(new Uint8Array([31, 139, 8]), createdAt, new Date('2026-10-09T18:00:05Z'))
    expect(result).toEqual({
      at: '2026-10-09T18:00:05.000Z',
      ok: true,
      key: offsiteKey(createdAt),
      error: null,
      kept: 4,
      pruneError: null,
    })
    // 1/9 and 8/9 are more than 30 days old; 9/9 is the cutoff day and stays. Two copies the same day both stay.
    expect([...bucket.objects.keys()].sort()).toEqual(
      [
        day('2026-09-09'),
        day('2026-10-08'),
        day('2026-10-09'),
        offsiteKey(createdAt),
        'backups/otra-cosa.json.gz',
      ].sort(),
    )
    expect(bucket.seen[0]).toBe(`PUT /${offsiteKey(createdAt)}`)
    expect(saved).toEqual([{ key: 'backupOffsite', value: result }])
  })

  it('a failed upload is recorded, not thrown; a failed pruning keeps the upload good', async () => {
    const failing = service(fakeBucket([], { failPut: true }).fetchImpl)
    const failed = await failing.offsite.upload(new Uint8Array([1]), new Date('2026-10-09T07:00:00Z'))
    expect(failed).toMatchObject({ ok: false, key: null, kept: null })
    expect(failed.error).toMatch(/^PUT del bucket: 403 /)
    expect(failing.saved).toEqual([{ key: 'backupOffsite', value: failed }])

    const pruning = service(fakeBucket([], { failList: true }).fetchImpl)
    const uploaded = await pruning.offsite.upload(new Uint8Array([1]), new Date('2026-10-09T07:00:00Z'))
    expect(uploaded).toMatchObject({ ok: true, error: null, kept: null })
    expect(uploaded.pruneError).toMatch(/^GET del bucket: 503/)
  })

  it('the monthly check: the newest copy comes back and reads as a backup', async () => {
    const good = gzipSync(Buffer.from('{"schemaVersion":7}'))
    const bucket = fakeBucket([day('2026-10-08')])
    const { offsite, saved } = service(bucket.fetchImpl)
    await offsite.upload(new Uint8Array(good), new Date('2026-10-09T07:00:00Z'), new Date('2026-10-09T07:00:05Z'))
    const parsed: Buffer[] = []
    const check = await offsite.verifyLatest((bytes) => parsed.push(bytes), new Date('2026-10-09T08:00:00Z'))
    expect(check).toEqual({
      at: '2026-10-09T08:00:00.000Z',
      ok: true,
      key: day('2026-10-09'),
      bytes: good.length,
      sha256: createHash('sha256').update(good).digest('hex'),
      error: null,
    })
    expect(parsed[0]?.equals(good)).toBe(true)
    const broken = await offsite.verifyLatest(() => {
      throw new Error('no es un backup')
    })
    expect(broken).toMatchObject({ ok: false, error: 'no es un backup' })
    expect(saved.at(-1)).toEqual({ key: 'backupOffsiteCheck', value: broken })
  })
})
