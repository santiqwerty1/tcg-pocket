/**
 * What the shell remembers while the app is open (a reload forgets it): where each tab was, the last query string of
 * each path, which history entries were opened by a tab's memory or by a «Volver» that went up, and how far each
 * place was scrolled. One instance per shell, never a module-level variable, so tests do not leak into each other.
 */
import { type FrameTab, frameFor, normalizePath, rememberedSearch, type TabKey } from './frame'

/** The part of a router location the memory reads. */
export interface Place {
  pathname: string
  search: string
  state: unknown
  key: string
}

interface Remembered {
  pathname: string
  search: string
  /** The `location.state` the place was opened with, without the mark. */
  state: unknown
}

export interface TabTarget {
  to: string
  state: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** True for the state of an entry opened by a tab's memory or by «Volver» going up. */
function carriesMark(state: unknown): boolean {
  return isRecord(state) && state.tabReturn === true
}

function withoutMark(state: unknown): unknown {
  if (!isRecord(state) || !('tabReturn' in state)) return state
  const rest = { ...state }
  delete rest.tabReturn
  return Object.keys(rest).length > 0 ? rest : null
}

function withMark(state: unknown): Record<string, unknown> {
  return { ...(isRecord(state) ? state : {}), tabReturn: true }
}

/** The key the scroll is remembered under: the place, whatever history entry shows it. */
const scrollKey = (place: { pathname: string; search: string }) => place.pathname + place.search

export class FrameMemory {
  private readonly tabs = new Map<TabKey, Remembered>()
  private readonly queries = new Map<string, string>()
  private readonly marked = new Set<string>()
  private readonly scroll = new Map<string, number>()
  private lastKey: string | null = null
  private screen: string | null = null
  private pending: { key: string; y: number } | null = null
  /** True while a remembered scroll is being put back: the scroll events of those frames are not the user's. */
  restoring = false

  /**
   * A location is on screen. `replaced` says the navigation replaced its history entry; `known` is false for an
   * address no route declares. Returns the scroll to put back, when this is the place a tab or «Volver» asked for.
   */
  arrive(place: Place, options: { replaced: boolean; known: boolean; scrollY: number }): number | null {
    // The mark belongs to the history entry: a page that replaces its own entry (the deck pager, a filter written in
    // the query string, a save) keeps its place in the history, so it keeps the mark.
    const inherits = options.replaced && this.lastKey !== null && this.marked.has(this.lastKey)
    if (carriesMark(place.state) || inherits) this.marked.add(place.key)
    this.lastKey = place.key

    const search = rememberedSearch(place.pathname, place.search)
    this.queries.set(normalizePath(place.pathname), search)
    const frame = frameFor(place.pathname)
    if (frame.tab && frame.remember && options.known) {
      this.tabs.set(frame.tab.key, { pathname: place.pathname, search, state: withoutMark(place.state) })
    }

    // What the router has just applied: 0 on a new entry, the entry's own place on «atrás». Without this a screen
    // opened at the top from a page already at the top (no scroll event) would keep the Y of an older visit.
    this.screen = scrollKey(place)
    this.scroll.set(this.screen, options.scrollY)
    const planned = this.pending
    this.pending = null
    return planned !== null && planned.key === this.screen && planned.y > 0 ? planned.y : null
  }

  /** The page was scrolled by the user. */
  scrolled(y: number): void {
    if (this.screen !== null && !this.restoring) this.scroll.set(this.screen, y)
  }

  /** Called when a tab that is not lit is tapped, or «Volver» goes up: the next arrival at `to` puts its scroll back. */
  planRestore(to: string): void {
    this.pending = { key: to, y: this.scroll.get(to) ?? 0 }
  }

  isMarked(key: string): boolean {
    return this.marked.has(key)
  }

  /** The last query string seen at a path («?a=1» or «»), for a «Volver» that goes up to it. */
  queryFor(pathname: string): string {
    return this.queries.get(normalizePath(pathname)) ?? ''
  }

  /** Where a tab that is not lit leads: where it was (marked, unless that is its own start), or its start. */
  targetFor(tab: FrameTab): TabTarget {
    const remembered = this.tabs.get(tab.key)
    if (!remembered) return { to: tab.root, state: null }
    const atRoot = normalizePath(remembered.pathname) === tab.root
    return {
      to: remembered.pathname + remembered.search,
      state: atRoot ? remembered.state : withMark(remembered.state),
    }
  }
}

const RESTORE_WINDOW_MS = 600
const USER_TAKES_OVER = ['touchstart', 'wheel', 'keydown', 'pointerdown'] as const

/**
 * Scrolls to `y` as soon as the page is tall enough: at once, or once per frame for a short while (a list whose data
 * is on its way). It gives up when the user touches the page. Returns how to stop it; `done` runs once, however it
 * ends. Where there is no layout (jsdom) the page is never tall enough and it only waits.
 */
export function scrollWhenTallEnough(y: number, done: () => void): () => void {
  let frame: number | null = null
  let finished = false
  const started = Date.now()
  const stop = () => {
    if (finished) return
    finished = true
    if (frame !== null) cancelAnimationFrame(frame)
    for (const type of USER_TAKES_OVER) window.removeEventListener(type, stop, true)
    done()
  }
  const attempt = () => {
    frame = null
    if (document.documentElement.scrollHeight - window.innerHeight >= y) {
      window.scrollTo(0, y)
      stop()
    } else if (Date.now() - started < RESTORE_WINDOW_MS && typeof requestAnimationFrame === 'function') {
      frame = requestAnimationFrame(attempt)
    } else {
      stop()
    }
  }
  for (const type of USER_TAKES_OVER) window.addEventListener(type, stop, { capture: true, passive: true })
  attempt()
  return stop
}
