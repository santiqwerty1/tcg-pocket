/**
 * La copia fuera de Supabase (Fase 39, P-007, P-010): the daily copy also goes to an S3-compatible bucket (Tigris on
 * Fly, created with `flyctl storage create`, which sets the AWS_* and BUCKET_NAME secrets). Copies of the last 30
 * days stay there (by the date in their name); the 14 in `backup_blobs` stay too. If Supabase is lost, the copies are
 * not lost with it. Off without the secrets.
 *
 * Virtual-hosted URLs (`https://<bucket>.<endpoint host>/<key>`): Tigris buckets created since 19/2/2025 only take
 * those, so bucket names cannot have dots (the TLS wildcard covers one label).
 */
import { createHash } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { AwsClient } from 'aws4fetch'
import { PinoLogger } from 'nestjs-pino'
import { ENV, type Env } from '../config/env.js'
import { PrismaService } from '../prisma/prisma.service.js'

/** Days of copies kept in the bucket. */
export const OFFSITE_KEEP_DAYS = 30
export const OFFSITE_PREFIX = 'backups/'
/** `app_settings` keys of the last upload and of the last check of the newest copy. */
export const OFFSITE_LAST_KEY = 'backupOffsite'
export const OFFSITE_CHECK_KEY = 'backupOffsiteCheck'
/** `backups/tcg-pocket-2026-10-09T07-00-00-000Z.json.gz`: the date of the copy is in the name. */
const COPY_KEY = /^backups\/tcg-pocket-(\d{4}-\d{2}-\d{2})T[0-9-]+Z\.json\.gz$/

export interface OffsiteResult {
  at: string
  /** The copy is in the bucket. */
  ok: boolean
  /** Object key of the copy uploaded (null when it did not go up). */
  key: string | null
  error: string | null
  /** Copies in the bucket after pruning (null when the list or the pruning failed). */
  kept: number | null
  /** The copy went up but removing the old ones failed (not an alert: next day it tries again). */
  pruneError?: string | null
}

/** The monthly check (with the restore drill): the newest copy of the bucket comes back and reads as a backup. */
export interface OffsiteCheck {
  at: string
  ok: boolean
  key: string | null
  bytes: number | null
  sha256: string | null
  error: string | null
}

export interface OffsiteObject {
  key: string
  size: number
  lastModified: string
}

/** `tcg-pocket-2026-10-09T07-00-00-000Z.json.gz` under the prefix: sortable by name. */
export function offsiteKey(createdAt: Date): string {
  return `${OFFSITE_PREFIX}tcg-pocket-${createdAt.toISOString().replace(/[:.]/g, '-')}.json.gz`
}

/** The day of a copy from its key; null for anything that is not a copy of ours (never pruned). */
export function offsiteKeyDay(key: string): string | null {
  return COPY_KEY.exec(key)?.[1] ?? null
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** The `<Contents>` of a ListObjectsV2 answer, and the token of the next page. */
export function parseListObjects(xml: string): { objects: OffsiteObject[]; next: string | null } {
  const objects: OffsiteObject[] = []
  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const body = match[1] ?? ''
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(body)?.[1]
    if (!key) continue
    objects.push({
      key: decodeXml(key),
      size: Number(/<Size>(\d+)<\/Size>/.exec(body)?.[1] ?? 0),
      lastModified: /<LastModified>([^<]+)<\/LastModified>/.exec(body)?.[1] ?? '',
    })
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml)
  const next = truncated ? (/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null) : null
  return { objects, next: next ? decodeXml(next) : null }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500)

@Injectable()
export class OffsiteBackupService {
  /** Tests swap it. */
  fetchImpl: (request: Request) => Promise<Response> = (request) => fetch(request)

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OffsiteBackupService.name)
  }

  enabled(): boolean {
    return this.env.offsite !== null
  }

  async last(): Promise<OffsiteResult | null> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: OFFSITE_LAST_KEY } })
    return (row?.value as OffsiteResult | undefined) ?? null
  }

  async lastCheck(): Promise<OffsiteCheck | null> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: OFFSITE_CHECK_KEY } })
    return (row?.value as OffsiteCheck | undefined) ?? null
  }

  private config() {
    const config = this.env.offsite
    if (!config) throw new Error('La copia en la nube no está configurada (faltan las claves del bucket).')
    return config
  }

  /** `https://<bucket>.<host>/<key>`: the bucket in the host (virtual-hosted style). */
  url(key?: string, query?: URLSearchParams): string {
    const { endpoint, bucket } = this.config()
    const base = new URL(endpoint)
    const path = key ? `/${key.split('/').map(encodeURIComponent).join('/')}` : '/'
    return `${base.protocol}//${bucket}.${base.host}${path}${query ? `?${query.toString()}` : ''}`
  }

  private async send(method: 'PUT' | 'GET' | 'DELETE', url: string, body?: Uint8Array): Promise<Response> {
    const { accessKeyId, secretAccessKey, region } = this.config()
    const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region })
    const headers: Record<string, string> = {}
    if (body) {
      headers['Content-Type'] = 'application/gzip'
      // The bucket checks the bytes it got against this (a copy cut on the way is refused, not stored).
      headers['Content-MD5'] = createHash('md5').update(body).digest('base64')
    }
    const request = await client.sign(url, { method, ...(body ? { body } : {}), headers })
    const response = await this.fetchImpl(request)
    if (!response.ok) {
      const text = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)
      throw new Error(`${method} del bucket: ${response.status}${text ? ` ${text}` : ''}`)
    }
    return response
  }

  /** Every object under the prefix, oldest first. */
  async list(): Promise<OffsiteObject[]> {
    const out: OffsiteObject[] = []
    let token: string | null = null
    do {
      const query = new URLSearchParams({ 'list-type': '2', prefix: OFFSITE_PREFIX })
      if (token) query.set('continuation-token', token)
      const page = parseListObjects(await (await this.send('GET', this.url(undefined, query))).text())
      out.push(...page.objects)
      token = page.next
    } while (token)
    return out.sort((a, b) => a.key.localeCompare(b.key))
  }

  private async save(key: string, value: unknown): Promise<void> {
    const json = JSON.parse(JSON.stringify(value))
    await this.prisma.appSetting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } })
  }

  /** A failure before the upload (reading the copy, for example): recorded like a failed upload. */
  async recordFailure(error: unknown, now = new Date()): Promise<OffsiteResult> {
    const result: OffsiteResult = { at: now.toISOString(), ok: false, key: null, error: message(error), kept: null }
    await this.save(OFFSITE_LAST_KEY, result)
    return result
  }

  /**
   * Uploads a copy (the bytes of a `backup_blobs` row), then removes our copies older than 30 days (by the date in
   * their name; manual uploads the same day never push older days out). Never throws: it records.
   */
  async upload(dataGz: Uint8Array, createdAt: Date, now = new Date()): Promise<OffsiteResult> {
    const key = offsiteKey(createdAt)
    try {
      await this.send('PUT', this.url(key), dataGz)
    } catch (error) {
      this.logger.error({ err: error }, 'offsite backup failed')
      return this.recordFailure(error, now)
    }
    let kept: number | null = null
    let pruneError: string | null = null
    try {
      const cutoff = new Date(now.getTime() - OFFSITE_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10)
      const copies = (await this.list()).filter((object) => offsiteKeyDay(object.key) !== null)
      const stale = copies.filter((object) => (offsiteKeyDay(object.key) ?? '') < cutoff && object.key !== key)
      for (const object of stale) await this.send('DELETE', this.url(object.key))
      kept = copies.length - stale.length
    } catch (error) {
      pruneError = message(error)
      this.logger.warn({ err: error }, 'offsite backup pruning failed')
    }
    const result: OffsiteResult = { at: now.toISOString(), ok: true, key, error: null, kept, pruneError }
    await this.save(OFFSITE_LAST_KEY, result)
    this.logger.info({ key, bytes: dataGz.length, kept }, 'offsite backup uploaded')
    return result
  }

  /** The newest copy of the bucket, downloaded and read with `parse` (the backup's own reader). Never throws. */
  async verifyLatest(parse: (bytes: Buffer) => unknown, now = new Date()): Promise<OffsiteCheck> {
    let check: OffsiteCheck
    try {
      const copies = (await this.list()).filter((object) => offsiteKeyDay(object.key) !== null)
      const newest = copies.at(-1)
      if (!newest) throw new Error('El bucket no tiene ninguna copia.')
      const bytes = Buffer.from(await (await this.send('GET', this.url(newest.key))).arrayBuffer())
      parse(bytes)
      check = {
        at: now.toISOString(),
        ok: true,
        key: newest.key,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        error: null,
      }
    } catch (error) {
      check = { at: now.toISOString(), ok: false, key: null, bytes: null, sha256: null, error: message(error) }
      this.logger.error({ err: error }, 'offsite backup check failed')
    }
    await this.save(OFFSITE_CHECK_KEY, check)
    return check
  }
}
