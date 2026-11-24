/**
 * The look of the app on this device: the theme, how much it moves and where the views of a screen go. The choice
 * lives in `localStorage['tcg.look']` as `{ "theme": "dark" | "light" | "system", "motion": "full" | "subtle" | "none",
 * "views": "bottom" | "top" }` (dark, full and bottom when nothing valid is stored). The theme and the motion reach
 * the page as attributes of <html>, always resolved: `data-theme="dark" | "light"` (plus the `theme-color` meta) and
 * `data-motion="full" | "subtle" | "none"`, which is «none» whenever the system asks to reduce motion. The place of
 * the views is read by the shell from `useLook()`.
 *
 * `public/look.js` applies the same rules before the first paint (the CSP forbids an inline script); the two are
 * tested against the same cases in `look.test.ts`. It is not personal data: logging out keeps it.
 */
import { useSyncExternalStore } from 'react'

export type ThemeChoice = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'
export type MotionLevel = 'full' | 'subtle' | 'none'
export type ViewsPlace = 'bottom' | 'top'

export interface Look {
  theme: ThemeChoice
  motion: MotionLevel
  views: ViewsPlace
}

export const LOOK_KEY = 'tcg.look'
/** The page background of each theme (`--background`), for the browser's own bars. */
export const THEME_COLOR: Record<ResolvedTheme, string> = { dark: '#0a0e14', light: '#f1eee8' }

const LIGHT_QUERY = '(prefers-color-scheme: light)'
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const DEFAULT_LOOK: Look = { theme: 'dark', motion: 'full', views: 'bottom' }

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
const isMotionLevel = (value: unknown): value is MotionLevel =>
  value === 'full' || value === 'subtle' || value === 'none'
const isViewsPlace = (value: unknown): value is ViewsPlace => value === 'bottom' || value === 'top'

export function readLook(): Look {
  const { theme, motion, views } = readStored()
  return {
    theme: isThemeChoice(theme) ? theme : DEFAULT_LOOK.theme,
    motion: isMotionLevel(motion) ? motion : DEFAULT_LOOK.motion,
    views: isViewsPlace(views) ? views : DEFAULT_LOOK.views,
  }
}

function systemAsks(query: string): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null
}

/** «system» is light only when the system asks for light; anything else is dark. */
export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice !== 'system') return choice
  return systemAsks(LIGHT_QUERY)?.matches ? 'light' : 'dark'
}

/** True while the system asks to reduce motion: the level is then «none», whatever was chosen. */
export function reducedBySystem(): boolean {
  return systemAsks(REDUCED_MOTION_QUERY)?.matches === true
}

export function resolveMotion(choice: MotionLevel): MotionLevel {
  return reducedBySystem() ? 'none' : choice
}

/**
 * How a scroll asked by code moves: at once with «none», smooth otherwise. Asked per call, because a
 * `scroll-behavior: smooth` on the page would also animate the router's resets on every navigation.
 */
export function scrollBehavior(): ScrollBehavior {
  return resolveMotion(readLook().motion) === 'none' ? 'auto' : 'smooth'
}

/** Puts the look on the page: the attributes the tokens hang from and the colour of the browser's bars. */
export function applyLook(look: Look = readLook()): ResolvedTheme {
  const resolved = resolveTheme(look.theme)
  if (typeof document === 'undefined') return resolved
  document.documentElement.setAttribute('data-theme', resolved)
  document.documentElement.setAttribute('data-motion', resolveMotion(look.motion))
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

/** What the system says once it is being watched; kept here so the listeners live as long as the page. */
let watched: (MediaQueryList | null)[] | undefined

/**
 * Applies the stored look and keeps following what can change it from outside while the app is open: the system's
 * colour scheme (it only matters with «system»), the system's reduced-motion setting and another tab. Once is enough;
 * later calls do nothing.
 */
export function watchLook(): void {
  if (watched !== undefined || typeof window === 'undefined') return
  watched = [systemAsks(LIGHT_QUERY), systemAsks(REDUCED_MOTION_QUERY)]
  applyLook()
  for (const query of watched) query?.addEventListener?.('change', refresh)
  window.addEventListener('storage', onStorage)
}

function subscribe(listener: () => void): () => void {
  watchLook()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** A primitive, so React can compare it: the choices and what they resolve to now. */
function snapshot(): string {
  const { theme, motion, views } = readLook()
  const reduced = reducedBySystem() ? 'reduced' : ''
  return [theme, resolveTheme(theme), motion, resolveMotion(motion), reduced, views].join('|')
}

function setTheme(theme: ThemeChoice): void {
  writeLook({ theme })
}

function setMotion(motion: MotionLevel): void {
  writeLook({ motion })
}

function setViews(views: ViewsPlace): void {
  writeLook({ views })
}

export interface LookState {
  theme: ThemeChoice
  /** The theme on the page now («system» resolved). */
  resolved: ResolvedTheme
  setTheme: (theme: ThemeChoice) => void
  motion: MotionLevel
  /** The level on the page now: «none» while the system asks to reduce motion. */
  resolvedMotion: MotionLevel
  reducedBySystem: boolean
  setMotion: (motion: MotionLevel) => void
  views: ViewsPlace
  setViews: (views: ViewsPlace) => void
}

/** The stored choices, what they resolve to now, and the setters. */
export function useLook(): LookState {
  const [theme, resolved, motion, resolvedMotion, reduced, views] = useSyncExternalStore(
    subscribe,
    snapshot,
    snapshot,
  ).split('|') as [ThemeChoice, ResolvedTheme, MotionLevel, MotionLevel, string, ViewsPlace]
  return {
    theme,
    resolved,
    setTheme,
    motion,
    resolvedMotion,
    reducedBySystem: reduced !== '',
    setMotion,
    views,
    setViews,
  }
}
