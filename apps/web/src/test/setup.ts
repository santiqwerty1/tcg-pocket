/// <reference types="node" />
import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// Fase 41: screens opened through the router load their chunk first (lazy routes); on a busy machine that takes more
// than testing-library's default second, and a `findBy` would give up while the screen still says «Cargando».
// D-023: allow lazy routes to finish under the shared PC's CI load.
configure({ asyncUtilTimeout: process.env.CI ? 15_000 : 5_000 })

afterEach(() => {
  cleanup()
  // Fase 28 keeps the match suggestions and the matches not sent yet in localStorage: each test starts clean.
  if (typeof localStorage !== 'undefined') localStorage.clear()
})

// jsdom lacks matchMedia and ResizeObserver, which Radix and sonner read at render time.
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
  // jsdom prints «Not implemented» for scrollTo, which ScrollRestoration calls on every navigation.
  window.scrollTo = (() => {}) as typeof window.scrollTo
}
