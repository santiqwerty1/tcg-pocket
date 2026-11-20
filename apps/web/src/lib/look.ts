/**
 * The look of the app on this device: for now, the theme. The choice lives in `localStorage['tcg.look']` as
 * `{ "theme": "dark" | "light" | "system" }` (dark when nothing valid is stored) and reaches the page as
 * `data-theme="dark" | "light"` on <html>, always resolved, plus the `color-scheme` and `theme-color` metas.
 *
 * `public/look.js` applies the same rules before the first paint (the CSP forbids an inline script); the two are
 * tested against the same cases in `look.test.ts`. It is not personal data: logging out keeps it.
 */
import { useSyncExternalStore } from 'react'

export type ThemeChoice = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

export interface Look {
  theme: ThemeChoice
}

export const LOOK_KEY = 'tcg.look'
/** The page background of each theme (`--background`), for the browser's own bars. */
export const THEME_COLOR: Record<ResolvedTheme, string> = { dark: '#0a0e14', light: '#f1eee8' }

const LIGHT_QUERY = '(prefers-color-scheme: light)'
const DEFAULT_THEME: ThemeChoice = 'dark'

/** What was chosen while the storage refused to keep it (blocked or full): it holds until the page is closed. */
let unsaved: Record<string, unknown> | null = null

/** The stored object as it is, with the keys this version does not know; `{}` when there is nothing usable. */
function readStored(): Record<string, unknown> {
  if (unsaved) return unsaved
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LOOK_KEY) ?? '{}')
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

const isThemeChoice = (value: unknown): value is ThemeChoice =>
  value === 'dark' || value === 'light' || value === 'system'

export function readLook(): Look {
  const { theme } = readStored()
  return { theme: isThemeChoice(theme) ? theme : DEFAULT_THEME }
}

function systemTheme(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(LIGHT_QUERY)
    : null
}

/** «system» is light only when the system asks for light; anything else is dark. */
export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice !== 'system') return choice
  return systemTheme()?.matches ? 'light' : 'dark'
}

/**
 * Puts the look on the page: the attribute the tokens hang from, the scheme the browser paints with before the
 * stylesheet is there (the `color-scheme` meta) and the colour of its bars.
 */
export function applyLook(look: Look = readLook()): ResolvedTheme {
  const resolved = resolveTheme(look.theme)
  if (typeof document === 'undefined') return resolved
  document.documentElement.setAttribute('data-theme', resolved)
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', resolved)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[resolved])
  return resolved
}

const listeners = new Set<() => void>()

function refresh(): void {
  applyLook()
  for (const listener of listeners) listener()
}

/** Saves the change (keeping the keys it does not touch) and applies it at once: the page never waits for a reload. */
export function writeLook(patch: Partial<Look>): void {
  const next = { ...readStored(), ...patch }
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(next))
    unsaved = null
  } catch {
    unsaved = next
  }
  refresh()
}

function onStorage(event: StorageEvent): void {
  // Another tab of the app changed the look (`key` is null when the whole storage was cleared).
  if (event.key === null || event.key === LOOK_KEY) refresh()
}

/** The system's colour scheme once it is being watched; kept here so its listener lives as long as the page. */
let watched: MediaQueryList | null | undefined

/**
 * Applies the stored look and keeps following what can change it from outside while the app is open: the system's
 * colour scheme (it only matters with «system») and another tab. Once is enough; later calls do nothing.
 */
export function watchLook(): void {
  if (watched !== undefined || typeof window === 'undefined') return
  watched = systemTheme()
  applyLook()
  watched?.addEventListener?.('change', refresh)
  window.addEventListener('storage', onStorage)
}

function subscribe(listener: () => void): () => void {
  watchLook()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** A primitive, so React can compare it: «choice|resolved». */
function snapshot(): string {
  const { theme } = readLook()
  return `${theme}|${resolveTheme(theme)}`
}

function setTheme(theme: ThemeChoice): void {
  writeLook({ theme })
}

/** The stored choice, the theme it resolves to now, and the setter. */
export function useLook(): { theme: ThemeChoice; resolved: ResolvedTheme; setTheme: (theme: ThemeChoice) => void } {
  const [theme, resolved] = useSyncExternalStore(subscribe, snapshot, snapshot).split('|') as [
    ThemeChoice,
    ResolvedTheme,
  ]
  return { theme, resolved, setTheme }
}
