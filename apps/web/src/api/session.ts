/**
 * What happens when the API says there is no session (401) or the user logs out:
 * the local caches and the service worker go away (PLAN §3.9: nothing is served without the cookie) and the
 * browser navigates to /login, a page served by the API outside the SPA.
 */
let resetting = false

export async function clearClientCaches(): Promise<void> {
  if (typeof caches !== 'undefined') {
    try {
      const keys = await caches.keys()
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

export async function resetClientAndLogin(): Promise<void> {
  if (resetting) return
  resetting = true
  try {
    await clearClientCaches()
  } finally {
    window.location.assign('/login')
  }
}

/** Test hook: lets the client test observe the reset without touching `window.location`. */
export function _resetForTests(): void {
  resetting = false
}
