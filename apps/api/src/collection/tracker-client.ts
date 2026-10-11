import { setTimeout as delay } from 'node:timers/promises'
import { Inject, Injectable } from '@nestjs/common'
import type { TrackerCollectionRow } from '@tcg/domain'
import { ENV, type Env } from '../config/env.js'

export const TRACKER_PAGE_SIZE = 500
const MAX_ROWS = 50_000
const MAX_PAGES = 100
const TIMEOUT_MS = 10_000
const MAX_ATTEMPTS = 3

export class TrackerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

@Injectable()
export class TrackerClient {
  /** Tests replace the transport with a local HTTP tracker. */
  fetchImpl: typeof fetch = fetch
  constructor(@Inject(ENV) private readonly env: Env) {}

  async collection(friendId: string): Promise<TrackerCollectionRow[]> {
    if (!this.env.trackerCollectionAnonKey)
      throw new TrackerError(
        'tracker_config',
        'Falta configurar TRACKER_COLLECTION_ANON_KEY en el servidor. Podés importar el CSV.',
      )
    const deadline = AbortSignal.timeout(120_000)
    const base = new URL(`${this.env.trackerCollectionUrl}/rest/v1/public_card_amounts_collection`)
    base.searchParams.set('friend_id', `eq.${friendId}`)
    base.searchParams.set('select', 'internal_id,amount_owned,collected')
    const count = await this.request(base, true, deadline)
    const rawCount = count.headers.get('content-range')?.split('/')[1]
    if (!rawCount || !/^\d+$/.test(rawCount) || Number(rawCount) > MAX_ROWS) {
      throw new TrackerError('tracker_count', 'El tracker no devolvió un conteo exacto válido. No se aplicó nada.')
    }
    const expected = Number(rawCount)
    if (expected === 0)
      throw new TrackerError(
        'tracker_empty',
        'El tracker no devolvió filas: revisá el friend_id y que la colección sea pública. No se aplicó nada.',
      )
    const all: TrackerCollectionRow[] = []
    let after = -1
    // A server can cap pages below 500 (206). Continue after the actual last internal id, until an empty page.
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(base)
      url.searchParams.set('order', 'internal_id.asc')
      url.searchParams.set('limit', String(TRACKER_PAGE_SIZE))
      if (after >= 0) url.searchParams.set('internal_id', `gt.${after}`)
      const response = await this.request(url, false, deadline)
      const rows = response.rows
      if (!Array.isArray(rows) || rows.length > TRACKER_PAGE_SIZE)
        throw new TrackerError('tracker_data', 'Página inválida del tracker.')
      if (rows.length === 0) {
        if (all.length !== expected)
          throw new TrackerError(
            'tracker_count',
            `Conteo incompleto: se esperaban ${expected} filas y llegaron ${all.length}. No se aplicó nada.`,
          )
        return all
      }
      for (const row of rows) {
        if (!row || !Number.isSafeInteger(row.internal_id) || row.internal_id <= after)
          throw new TrackerError('tracker_data', 'La paginación del tracker no avanzó por internal_id.')
        after = row.internal_id
        all.push(row as TrackerCollectionRow)
      }
      if (all.length > expected || all.length > MAX_ROWS)
        throw new TrackerError(
          'tracker_count',
          'El conteo del tracker cambió durante la lectura. Volvé a obtener una vista previa.',
        )
    }
    throw new TrackerError('tracker_count', 'La colección excede el límite de páginas.')
  }

  private async request(url: URL, head: boolean, deadline: AbortSignal): Promise<{ headers: Headers; rows: unknown }> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let retryMs = 250 * (attempt + 1)
      try {
        const response = await this.fetchImpl(url, {
          method: head ? 'HEAD' : 'GET',
          redirect: 'error',
          signal: AbortSignal.any([deadline, AbortSignal.timeout(TIMEOUT_MS)]),
          headers: {
            apikey: this.env.trackerCollectionAnonKey,
            Authorization: `Bearer ${this.env.trackerCollectionAnonKey}`,
            'User-Agent': 'tcg-pocket/collection-sync (personal collection)',
            ...(head ? { Prefer: 'count=exact' } : {}),
          },
        })
        if (response.ok) {
          // Read the body within the retry boundary: its stream can time out after headers arrived.
          const rows: unknown = head ? undefined : await response.json()
          return { headers: response.headers, rows }
        }
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after')
          if (retryAfter) {
            const seconds = Number(retryAfter)
            const at = Date.parse(retryAfter)
            const requested = Number.isFinite(seconds) ? seconds * 1000 : at - Date.now()
            if (Number.isFinite(requested)) retryMs = Math.max(retryMs, requested)
          }
        }
        await response.body?.cancel()
        if (response.status === 401 || response.status === 403)
          throw new TrackerError(
            'tracker_auth',
            'El tracker rechazó la clave anon configurada en el servidor. Podés importar el CSV.',
          )
        if (response.status !== 429 && response.status < 500)
          throw new TrackerError('tracker_http', `El tracker respondió HTTP ${response.status}. Podés importar el CSV.`)
      } catch (error) {
        if (error instanceof TrackerError) throw error
        if (error instanceof SyntaxError) throw new TrackerError('tracker_data', 'Respuesta inválida del tracker.')
        if (deadline.aborted)
          throw new TrackerError(
            'tracker_network',
            'La consulta completa del tracker excedió los 2 minutos. No se aplicó nada.',
          )
      }
      if (attempt + 1 < MAX_ATTEMPTS) {
        try {
          await delay(retryMs, undefined, { signal: deadline })
        } catch {
          throw new TrackerError(
            'tracker_network',
            'La consulta completa del tracker excedió los 2 minutos. No se aplicó nada.',
          )
        }
      }
    }
    throw new TrackerError(
      'tracker_network',
      'No se pudo leer el tracker después de 3 intentos (tiempo límite 10 s). Podés importar el CSV.',
    )
  }
}
