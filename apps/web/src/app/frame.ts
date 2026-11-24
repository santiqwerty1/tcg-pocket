/**
 * The frame of the app, one description per pathname: which tab is lit, which views the screen has, the action of its
 * fixed row and whether the tab remembers the place. Pure data and pure functions; the shell (`AppShell`, `TabBar`,
 * `FixedRow`) draws from it.
 *
 * The views of Cartas, Meta and Pruebas are today's screens under the tabs of mock-up D: a bridge until those tabs
 * are drawn as D has them.
 */
import {
  FlaskConicalIcon,
  GalleryHorizontalEndIcon,
  LayersIcon,
  type LucideIcon,
  PlusIcon,
  SunIcon,
  TrophyIcon,
} from 'lucide-react'

export type TabKey = 'hoy' | 'mazos' | 'cartas' | 'meta' | 'pruebas'

export interface FrameView {
  label: string
  path: string
}

export interface FrameAction {
  label: string
  icon: LucideIcon
  to: string
}

export interface FrameTab {
  key: TabKey
  label: string
  icon: LucideIcon
  /** Where the tab starts, and where a second tap returns. */
  root: string
  /** The tab is lit on each of these paths and on everything under them. */
  prefixes: readonly string[]
  /** The screens that share the tab as views; they show only on exactly these paths. */
  views: readonly FrameView[] | null
  viewsLabel: string | null
}

export const TABS: readonly FrameTab[] = [
  {
    key: 'hoy',
    label: 'Hoy',
    icon: SunIcon,
    root: '/partidas',
    prefixes: ['/partidas'],
    views: null,
    viewsLabel: null,
  },
  {
    key: 'mazos',
    label: 'Mazos',
    icon: LayersIcon,
    root: '/mazos',
    prefixes: ['/mazos'],
    views: null,
    viewsLabel: null,
  },
  {
    key: 'cartas',
    label: 'Cartas',
    icon: GalleryHorizontalEndIcon,
    root: '/sobres',
    prefixes: ['/sobres', '/coleccion', '/cartas', '/grupos'],
    views: [
      { label: 'Sobres', path: '/sobres' },
      { label: 'Colección', path: '/coleccion' },
    ],
    viewsLabel: 'Vistas de Cartas',
  },
  {
    key: 'meta',
    label: 'Meta',
    icon: TrophyIcon,
    root: '/torneos',
    prefixes: ['/torneos', '/eventos'],
    views: [
      { label: 'Torneos', path: '/torneos' },
      { label: 'Eventos', path: '/eventos' },
    ],
    viewsLabel: 'Vistas de Meta',
  },
  {
    key: 'pruebas',
    label: 'Pruebas',
    icon: FlaskConicalIcon,
    root: '/laboratorio',
    prefixes: ['/laboratorio', '/simulacion', '/jugar'],
    views: [
      { label: 'Laboratorio', path: '/laboratorio' },
      { label: 'Simulación', path: '/simulacion' },
      { label: 'Practicar', path: '/jugar' },
    ],
    viewsLabel: 'Vistas de Pruebas',
  },
]

/** The action of the fixed row, by exact path. */
const ROW_ACTIONS: Readonly<Record<string, FrameAction>> = {
  '/mazos': { label: 'Nuevo mazo', icon: PlusIcon, to: '/mazos/nuevo' },
}

/**
 * Paths that light their tab without becoming «where the tab was»: in D a card is a sheet, never a place, so a card
 * opened from a deck must not be what Cartas returns to.
 */
const NOT_REMEMBERED: readonly string[] = ['/cartas', '/grupos']

/** The Menú (`/mas` and its pages) belongs to no tab. */
const MENU_PATH = '/mas'

/**
 * Query keys the memory of a tab drops: they are orders, not places. `compartido` makes `ImportPage.tsx` (and the
 * deck import) take the shared file again on every return; `mazo` on `/partidas` makes `PartidasPage.tsx` choose that
 * deck again. `path: null` means on any path.
 */
export const FORGOTTEN_QUERY: readonly { key: string; path: string | null }[] = [
  { key: 'compartido', path: null },
  { key: 'mazo', path: '/partidas' },
]

/**
 * A click the router turns into a navigation in this window. With a modifier, or another button, it is the browser's
 * («open in a new tab»): the frame must neither prevent it nor act on it here.
 */
export function isPlainClick(event: {
  button: number
  metaKey: boolean
  altKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
}): boolean {
  return event.button === 0 && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey
}

/** The pathname as the frame compares it: alone (no query, no fragment), lower-cased, without trailing slashes. */
export function normalizePath(pathname: string): string {
  const path = (pathname.split(/[?#]/)[0] ?? '').toLowerCase().replace(/\/+$/, '')
  return path === '' ? '/' : path
}

/** A prefix matches the path itself or the path followed by `/`. */
function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

export function isMenuPath(pathname: string): boolean {
  return under(normalizePath(pathname), MENU_PATH)
}

export interface Frame {
  /** The lit tab; null on the Menú and on a path nobody knows. */
  tab: FrameTab | null
  /** The views of this screen, only when the path is exactly one of them. */
  views: readonly FrameView[] | null
  viewsLabel: string | null
  /** The action of the fixed row. */
  action: FrameAction | null
  /** Whether the tab remembers this place. */
  remember: boolean
}

export function frameFor(pathname: string): Frame {
  const path = normalizePath(pathname)
  const tab = TABS.find((candidate) => candidate.prefixes.some((prefix) => under(path, prefix))) ?? null
  const isView = tab?.views?.some((view) => view.path === path) === true
  return {
    tab,
    views: isView ? (tab?.views ?? null) : null,
    viewsLabel: isView ? (tab?.viewsLabel ?? null) : null,
    action: ROW_ACTIONS[path] ?? null,
    remember: tab !== null && !NOT_REMEMBERED.some((prefix) => under(path, prefix)),
  }
}

/** The query string a tab remembers for a place: the one given, without the keys that are orders. */
export function rememberedSearch(pathname: string, search: string): string {
  const path = normalizePath(pathname)
  const params = new URLSearchParams(search)
  let dropped = false
  for (const { key, path: only } of FORGOTTEN_QUERY) {
    if ((only === null || only === path) && params.has(key)) {
      params.delete(key)
      dropped = true
    }
  }
  // Untouched when nothing is dropped, so the address a tab returns to is the one that was open, character by character.
  if (!dropped) return search
  const rest = params.toString()
  return rest === '' ? '' : `?${rest}`
}
