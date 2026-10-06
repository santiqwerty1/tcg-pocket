import { registerSW } from 'virtual:pwa-register'

/**
 * Registers the generated service worker (registerType 'autoUpdate': a new build replaces the old one and reloads).
 * Nothing under /api is ever cached, and src/api/session.ts unregisters it on 401 or logout.
 */
export function setupPwa(): void {
  if (!('serviceWorker' in navigator)) return
  registerSW({
    immediate: true,
    onRegisterError(error) {
      console.warn('No se pudo registrar el service worker', error)
    },
  })
}
