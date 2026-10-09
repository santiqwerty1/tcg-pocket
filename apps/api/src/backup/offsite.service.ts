/**
 * La copia fuera de Supabase (Fase 39, P-007, P-010): the daily copy also goes to an S3-compatible bucket (Tigris on
 * Fly, created with `flyctl storage create`, which sets the AWS_* and BUCKET_NAME secrets). The last 30 stay there;
 * the 14 in `backup_blobs` stay too. If Supabase is lost, the copies are not lost with it. Off without the secrets.
 */
import { Inject, Injectable } from '@nestjs/common'
import { AwsClient } from 'aws4fetch'
import { PinoLogger } from 'nestjs-pino'
import { ENV, type Env } from '../config/env.js'
import { PrismaService } from '../prisma/prisma.service.js'

/** Copies kept in the bucket. */
export const OFFSITE_KEPT = 30
export const OFFSITE_PREFIX = 'backups/'
/** `app_settings` key of the last upload. */
export const OFFSITE_LAST_KEY = 'backupOffsite'

export interface OffsiteResult {
  at: string
  ok: boolean
  /** Object key of the copy uploaded (null when it failed before). */
  key: string | null
  error: string | null
  /** Copies in the bucket after pruning. */
  kept: number | null
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

  private config() {
    const config = this.env.offsite
    if (!config) throw new Error('La copia en la nube no está configurada (faltan las claves del bucket).')
    return config
  }

  private url(key?: string, query?: URLSearchParams): string {
    const { endpoint, bucket } = this.config()
    const path = key ? `/${key.split('/').map(encodeURIComponent).join('/')}` : ''
    return `${endpoint}/${encodeURIComponent(bucket)}${path}${query ? `?${query.toString()}` : ''}`
  }

  private async send(method: 'PUT' | 'GET' | 'DELETE', url: string, body?: Uint8Array): Promise<Response> {
    const { accessKeyId, secretAccessKey, region } = this.config()
    const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region })
    const request = await client.sign(url, {
      method,
      ...(body ? { body, headers: { 'Content-Type': 'application/gzip' } } : {}),
    })
    const response = await this.fetchImpl(request)
    if (!response.ok) {
      const text = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)
      throw new Error(`${method} del bucket: ${response.status}${text ? ` ${text}` : ''}`)
    }
    return response
  }

  /** Every copy under the prefix, oldest first. */
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

  /** Uploads a copy (the bytes of a `backup_blobs` row) and keeps the newest 30. Never throws: it records. */
  async upload(dataGz: Uint8Array, createdAt: Date, now = new Date()): Promise<OffsiteResult> {
    let result: OffsiteResult
    const key = offsiteKey(createdAt)
    try {
      await this.send('PUT', this.url(key), dataGz)
      const objects = await this.list()
      const stale = objects.slice(0, Math.max(0, objects.length - OFFSITE_KEPT))
      for (const object of stale) await this.send('DELETE', this.url(object.key))
      result = { at: now.toISOString(), ok: true, key, error: null, kept: objects.length - stale.length }
      this.logger.info({ key, bytes: dataGz.length, deleted: stale.length }, 'offsite backup uploaded')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result = { at: now.toISOString(), ok: false, key: null, error: message.slice(0, 500), kept: null }
      this.logger.error({ err: error }, 'offsite backup failed')
    }
    const value = JSON.parse(JSON.stringify(result))
    await this.prisma.appSetting.upsert({
      where: { key: OFFSITE_LAST_KEY },
      create: { key: OFFSITE_LAST_KEY, value },
      update: { value },
    })
    return result
  }
}
