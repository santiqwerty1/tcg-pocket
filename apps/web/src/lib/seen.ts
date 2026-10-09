/**
 * When a page was last visited on this device (Fase 26): «Para hoy» shows what finished after that, not what you
 * already saw. Browser storage only (a per-device convenience): unavailable storage just means «never seen».
 */
import { useEffect } from 'react'

const KEY = 'tcg.seen.'

export function lastSeen(page: string): number {
  try {
    const value = Number(localStorage.getItem(KEY + page))
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

/** Marks the page as seen now (on mount). */
export function useMarkSeen(page: string): void {
  useEffect(() => {
    try {
      localStorage.setItem(KEY + page, String(Date.now()))
    } catch {
      // Storage may be unavailable (private mode): nothing to remember.
    }
  }, [page])
}
