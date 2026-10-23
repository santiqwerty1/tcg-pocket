/**
 * Reads ptcgpocket.gg's «Permanent export link» (T-020): one GET that answers the collection as CSV. Bounded: 15 s per
 * attempt and 60 s in all, three attempts for 429/5xx and network errors, at most 2 MB (a full collection is ~120 KB)
 * and redirects only within dotgg.gg. The link is a secret: no message here quotes it or the response.
 */
import { setTimeout as delay } from 'node:timers/promises'
import { Injectable } from '@nestjs/common'
import { parseDotggExportLink } from '@tcg/domain'

export const DOTGG_MAX_BYTES = 2 * 1024 * 1024
const MAX_ATTEMPTS = 3
const MAX_REDIRECTS = 2
const NEW_LINK =
  'creá uno nuevo en ptcgpocket.gg (Settings → Display & collection → Permanent export link) y pegalo en Ajustes'

export class DotggError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'DotggError'
  }
}

/** A failure worth another attempt: 429, 5xx, a timeout or the network. */
class RetryableError extends Error {}

/** Only https on dotgg.gg or its subdomains; anything else is refused. */
function sameSite(location: string, from: string): string | null {
  try {
    const next = new URL(location, from)
    const host = next.hostname
    if (next.protocol !== 'https:' || next.username || next.password) return null
    return host === 'dotgg.gg' || host.endsWith('.dotgg.gg') ? next.toString() : null
  } catch {
    return null
  }
}

@Injectable()
export class DotggClient {
  /** Tests replace the transport with a local DotGG. */
  fetchImpl: typeof fetch = fetch
  timeoutMs = 15_000
  totalTimeoutMs = 60_000
  maxBytes = DOTGG_MAX_BYTES
  retryDelayMs = 500

  /** The export's bytes. Throws `DotggError` with a Spanish message that can be shown and stored. */
  async exportCsv(link: string): Promise<Buffer> {
    const check = parseDotggExportLink(link)
    if (!check.ok) throw new DotggError('dotgg_config', check.message)
    const deadline = AbortSignal.timeout(this.totalTimeoutMs)
    let problem = 'sin respuesta'
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        return await this.once(check.url, deadline)
      } catch (error) {
        if (error instanceof DotggError) throw error
        if (error instanceof RetryableError) problem = error.message
        else if (deadline.aborted) problem = `sin terminar en ${Math.round(this.totalTimeoutMs / 1000)} s`
        else if (error instanceof Error && error.name === 'TimeoutError')
          problem = `sin respuesta en ${Math.round(this.timeoutMs / 1000)} s`
        else problem = 'error de red'
      }
      if (deadline.aborted || attempt + 1 >= MAX_ATTEMPTS) break
      try {
        await delay(this.retryDelayMs * (attempt + 1), undefined, { signal: deadline })
      } catch {
        break
      }
    }
    throw new DotggError(
      'dotgg_network',
      `No se pudo leer ptcgpocket.gg después de ${MAX_ATTEMPTS} intentos (${problem}). No se aplicó nada.`,
    )
  }

  private async once(url: string, deadline: AbortSignal): Promise<Buffer> {
    let current = url
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await this.fetchImpl(current, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.any([deadline, AbortSignal.timeout(this.timeoutMs)]),
        headers: {
          Accept: 'text/csv, text/plain;q=0.9, */*;q=0.1',
          'User-Agent': 'tcg-pocket/collection-sync (personal collection)',
        },
      })
      const { status } = response
      if (status >= 300 && status < 400) {
        await response.body?.cancel().catch(() => undefined)
        const next = sameSite(response.headers.get('location') ?? '', current)
        if (!next) {
          throw new DotggError('dotgg_redirect', 'ptcgpocket.gg mandó el link a otro sitio. No se aplicó nada.')
        }
        current = next
        continue
      }
      if (response.ok) return await this.body(response)
      await response.body?.cancel().catch(() => undefined)
      if (status === 401 || status === 403 || status === 404 || status === 410) {
        throw new DotggError(
          'dotgg_auth',
          `ptcgpocket.gg no reconoce el link (HTTP ${status}): si lo regeneraste o lo borraste, ${NEW_LINK}.`,
        )
      }
      if (status === 429 || status >= 500) throw new RetryableError(`HTTP ${status}`)
      throw new DotggError('dotgg_http', `ptcgpocket.gg respondió HTTP ${status}. No se aplicó nada.`)
    }
    throw new DotggError('dotgg_redirect', 'ptcgpocket.gg redirigió el link demasiadas veces. No se aplicó nada.')
  }

  /** The body, refused past `maxBytes` (announced or counted) without reading the rest. */
  private async body(response: Response): Promise<Buffer> {
    const tooLarge = () =>
      new DotggError(
        'dotgg_too_large',
        `La respuesta de ptcgpocket.gg pesa más de ${Math.round(this.maxBytes / 1024 / 1024)} MB: no parece la exportación de la colección. No se aplicó nada.`,
      )
    const announced = Number(response.headers.get('content-length'))
    if (Number.isFinite(announced) && announced > this.maxBytes) {
      await response.body?.cancel().catch(() => undefined)
      throw tooLarge()
    }
    if (!response.body) return Buffer.alloc(0)
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > this.maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw tooLarge()
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks)
  }
}
