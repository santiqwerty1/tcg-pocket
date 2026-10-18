/**
 * Partidas sin señal (Fase 28): a match saved while the phone has no signal waits here (localStorage, this device
 * only) with its own id (`clientRef`) and the moment it was saved, and goes to the server when the signal is back.
 * The server stores each `clientRef` once, so a send that got through but whose answer was lost is not repeated.
 */
import { useSyncExternalStore } from 'react'
import { isApiError } from '@/api/client'
import type { MatchInput } from '@/api/schemas'

const KEY = 'tcg.pending-matches'
const CHANGED = 'tcg-pending-matches'
/** The server takes up to 30 days back. */
const MAX_AGO_MS = 30 * 24 * 60 * 60 * 1000
const EMPTY: PendingMatch[] = []

export interface PendingMatch {
  clientRef: string
  body: MatchInput
  /** What the list shows, e.g. «Victoria con Mega-Blaziken ex contra Pikachu ex». */
  label: string
  /** `Date.now()` on this phone when it was saved (only the time elapsed since then is sent). */
  savedAt: number
  /** Why the server refused it (a deck deleted meanwhile…): it stays until discarded. */
  error?: string
}

function isPending(value: unknown): value is PendingMatch {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<PendingMatch>
  return (
    typeof item.clientRef === 'string' &&
    typeof item.label === 'string' &&
    typeof item.savedAt === 'number' &&
    typeof item.body === 'object' &&
    item.body !== null
  )
}

let cache: { raw: string | null; items: PendingMatch[] } = { raw: null, items: EMPTY }

function read(): PendingMatch[] {
  let raw: string | null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    return EMPTY
  }
  if (raw === cache.raw) return cache.items
  let items = EMPTY
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : []
    items = Array.isArray(parsed) ? parsed.filter(isPending) : EMPTY
  } catch {
    items = EMPTY
  }
  cache = { raw, items }
  return items
}

function write(items: PendingMatch[]): boolean {
  let ok = true
  try {
    if (items.length === 0) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    ok = false
  }
  window.dispatchEvent(new Event(CHANGED))
  return ok
}

export function pendingMatches(): PendingMatch[] {
  return read()
}

/** False when the phone did not let us keep it (storage full or blocked). */
export function queueMatch(item: PendingMatch): boolean {
  return write([...read().filter((other) => other.clientRef !== item.clientRef), item])
}

/**
 * Deuda de #120: «¿Cambiaste de rango?» for a match still on the phone — the rank travels with it and is noted at its
 * instant when it gets to the server. False when it already went (or is not there).
 */
export function setPendingRank(clientRef: string, rank: string, points: number | null): boolean {
  const items = read()
  const item = items.find((other) => other.clientRef === clientRef && !other.error)
  if (!item) return false
  return write(
    items.map((other) =>
      other === item
        ? { ...other, body: { ...other.body, rank, ...(points !== null ? { rankPoints: points } : {}) } }
        : other,
    ),
  )
}

export function discardPending(clientRef: string): void {
  write(read().filter((item) => item.clientRef !== clientRef))
}

function markError(clientRef: string, error: string): void {
  write(read().map((item) => (item.clientRef === clientRef ? { ...item, error } : item)))
}

function subscribe(listener: () => void): () => void {
  window.addEventListener(CHANGED, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(CHANGED, listener)
    window.removeEventListener('storage', listener)
  }
}

export function usePendingMatches(): PendingMatch[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY)
}

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

/** What the phone says about its connection (`false` is reliable; `true` may still be a dead signal). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  )
}

/** No signal: the request never reached an answer (fetch failed or took too long). */
export function isOfflineError(error: unknown): boolean {
  if (isApiError(error)) return error.status === 0
  return error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')
}

/** A v4 UUID; `crypto.randomUUID` only exists in secure contexts, so there is a fallback. */
export function newClientRef(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export type SendMatch = (body: MatchInput) => Promise<unknown>

let flushing = false

/**
 * Sends what is waiting, oldest first, and stops at the first «no signal» (or a server error: it retries later). A
 * match the server refuses (4xx) is kept with the reason. Returns how many went through; 0 if a send is running.
 */
export async function flushPending(send: SendMatch): Promise<number> {
  if (flushing) return 0
  flushing = true
  const tried = new Set<string>()
  let sent = 0
  try {
    for (;;) {
      const next = read()
        .filter((item) => !item.error && !tried.has(item.clientRef))
        .sort((a, b) => a.savedAt - b.savedAt)[0]
      if (!next) break
      tried.add(next.clientRef)
      try {
        await send({
          ...next.body,
          clientRef: next.clientRef,
          playedAgoMs: Math.min(MAX_AGO_MS, Math.max(0, Date.now() - next.savedAt)),
        })
        discardPending(next.clientRef)
        sent += 1
      } catch (error) {
        if (!isApiError(error) || error.status === 0 || error.status === 401 || error.status === 429) break
        if (error.status >= 500) break
        markError(next.clientRef, error.message)
      }
    }
  } finally {
    flushing = false
  }
  return sent
}
