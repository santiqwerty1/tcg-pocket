/**
 * What Android's «Compartir» sent to the app (Fase 41): public/push-sw.js keeps it in the Cache Storage and opens the
 * import screen. It stays there until an import that used it succeeds — even across an expired session, whose reset
 * (src/api/session.ts) leaves this cache alone — so a share is never lost to a login.
 */
export const SHARE_CACHE = 'shared-files'
const FILE_KEY = '/compartido/archivo'
const TEXT_KEY = '/compartido/texto'

async function read(key: string): Promise<Response | null> {
  if (typeof caches === 'undefined') return null
  try {
    const cache = await caches.open(SHARE_CACHE)
    return (await cache.match(key)) ?? null
  } catch {
    return null
  }
}

async function forget(key: string): Promise<void> {
  if (typeof caches === 'undefined') return
  try {
    const cache = await caches.open(SHARE_CACHE)
    await cache.delete(key)
  } catch {
    // Cache Storage unavailable: nothing was kept.
  }
}

/** The shared CSV waiting to be imported, if any (it stays until `forgetSharedFile`). */
export async function sharedFile(): Promise<File | null> {
  const response = await read(FILE_KEY)
  if (!response) return null
  const name = decodeURIComponent(response.headers.get('x-file-name') ?? 'compartido.csv')
  const type = response.headers.get('content-type') || 'text/csv'
  return new File([await response.arrayBuffer()], name, { type })
}

export function forgetSharedFile(): Promise<void> {
  return forget(FILE_KEY)
}

/** The shared text (a deck list) waiting to be imported, if any (it stays until `forgetSharedText`). */
export async function sharedText(): Promise<string | null> {
  const response = await read(TEXT_KEY)
  return response ? response.text() : null
}

export function forgetSharedText(): Promise<void> {
  return forget(TEXT_KEY)
}
