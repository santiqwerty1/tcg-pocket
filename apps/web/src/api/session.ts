/**
 * What happens when the API says there is no session (401) or the user logs out; then the browser navigates to
 * /login, a page served by the API outside the SPA.
 * - Logging out by hand clears everything: caches and the service worker (PLAN §3.9).
 * - An expired session (401) keeps the service worker and its caches ([P-012], Fase 41): they hold the app's shell
 *   and card images, no data of the owner (every API answer still needs the cookie), and unregistering it also
 *   dropped the push subscription without a word.
 */
import { SHARE_CACHE } from '@/lib/shared'

let resetting = false

export type ResetReason = 'expired' | 'logout'

export async function clearClientCaches(reason: ResetReason = 'logout'): Promise<void> {
  // Fase 28: the copy of the match suggestions goes too (the matches not sent yet stay: they are Santi's).
  try {
    localStorage.removeItem('tcg.match-suggestions')
  } catch {
    // Storage blocked: nothing stored.
  }
  if (reason === 'expired') return
  if (typeof caches !== 'undefined') {
    try {
      // Fase 41: what was shared to the app waits for the next login (like the matches not sent yet).
      const keys = (await caches.keys()).filter((key) => key !== SHARE_CACHE)
      await Promise.all(keys.map((key) => caches.delete(key)))
    } catch {
      // Cache API unavailable (private mode, insecure context): nothing to clear.
    }
  }
  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((registration) => registration.unregister()))
    } catch {
      // No service worker registered.
    }
  }
}

export async function resetClientAndLogin(reason: ResetReason = 'logout'): Promise<void> {
  if (resetting) return
  resetting = true
  try {
    await clearClientCaches(reason)
  } finally {
    window.location.assign('/login')
  }
}

/** Test hook: lets the client test observe the reset without touching `window.location`. */
export function _resetForTests(): void {
  resetting = false
}
