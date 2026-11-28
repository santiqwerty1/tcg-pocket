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
  RefreshCwIcon,
  SunIcon,
  TrophyIcon,
} from 'lucide-react'

export type TabKey = 'hoy' | 'mazos' | 'cartas' | 'meta' | 'pruebas'

export interface FrameView {
  label: string
  path: string
}

/** The parameters of a route pattern, by name («deckId» of `/mazos/:deckId`), decoded. */
export type RouteParams = Readonly<Record<string, string>>

interface RowActionBase {
  /** The visible text. Next to the views, with `display` 'auto', it is the name of the icon (unless `ariaLabel`). */
  label: string
  /** The accessible name, when it says more than the label: «Registrar partida con este mazo». It starts with it. */
  ariaLabel?: string
  /** Optional only on a route without views: next to them, with `display` 'auto', the icon is all there is. */
  icon?: LucideIcon
  /** Next to the views: 'auto' (the default), the icon alone, 48 × 48; 'text', its icon and its text. */
  display?: 'auto' | 'text'
  /** What a screen reader hears while it works («Sincronizando…»); the page can say it better. */
  pendingLabel?: string
}

/**
 * The action of the fixed row on a route, as the frame knows it from the path alone: what it says and where it goes.
 * What only the page knows (the handler of a button, a request on its way, a deck that is archived, a label from its
 * data) the page declares with `usePageAction` (`app/pageAction.tsx`).
 */
export type RowActionSpec = RowActionBase &
  (
    | { kind: 'link'; to: (params: RouteParams) => string }
    | {
        kind: 'button'
        /** It opens a dialog or a sheet: `aria-haspopup`. */
        opens?: 'dialog'
      }
  )

/** The action of the row on the path at hand: its spec and the parameters its pattern took from the path. */
export interface FrameAction {
  spec: RowActionSpec
  params: RouteParams
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

/**
 * The action of the fixed row, by route pattern (as `routes.tsx` writes them, with a leading «/»). `where` says what a
 * parameter has to look like: `/mazos/:deckId` is a deck only with digits, so the screens next to it (`/mazos/nuevo`,
 * `/mazos/importar`, `/mazos/hoy`, `/mazos/despues`) are not taken for one. The first pattern that matches wins.
 */
export const ROW_ACTIONS: readonly {
  pattern: string
  where?: Readonly<Record<string, RegExp>>
  spec: RowActionSpec
}[] = [
  { pattern: '/mazos', spec: { label: 'Nuevo mazo', icon: PlusIcon, kind: 'link', to: () => '/mazos/nuevo' } },
  {
    pattern: '/mazos/:deckId',
    where: { deckId: /^\d+$/ },
    // It opens Hoy with the deck chosen; an archived deck hides it (`DeckDetailPage`).
    spec: {
      label: 'Registrar partida',
      ariaLabel: 'Registrar partida con este mazo',
      icon: PlusIcon,
      kind: 'link',
      to: ({ deckId = '' }) => `/partidas?mazo=${encodeURIComponent(deckId)}`,
    },
  },
  {
    pattern: '/coleccion',
    // The page gives it its handler and says with what it syncs (`CollectionPage`).
    spec: {
      label: 'Sincronizar',
      ariaLabel: 'Sincronizar la colección',
      icon: RefreshCwIcon,
      display: 'text',
      kind: 'button',
      pendingLabel: 'Sincronizando…',
    },
  },
  {
    pattern: '/simulacion',
    spec: { label: 'Nueva simulación', icon: PlusIcon, kind: 'link', to: () => '/simulacion/nueva' },
  },
]

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

/**
 * The parameters a route pattern takes from a path, or null when it does not match. As the router: the segments of the
 * pattern are compared without case, the query and the fragment do not count, trailing slashes neither; a parameter
 * takes one whole segment, never an empty one, and comes decoded and in the case it was written.
 */
export function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const segments = (value: string) => (value.split(/[?#]/)[0] ?? '').replace(/\/+$/, '').split('/')
  const wanted = segments(pattern)
  const given = segments(path)
  if (wanted.length !== given.length) return null
  const params: Record<string, string> = {}
  for (const [at, part] of wanted.entries()) {
    const value = given[at] ?? ''
    if (part.startsWith(':')) {
      if (value === '') return null
      try {
        params[part.slice(1)] = decodeURIComponent(value)
      } catch {
        // A «%» that is not an escape: no screen has that address.
        return null
      }
    } else if (part.toLowerCase() !== value.toLowerCase()) {
      return null
    }
  }
  return params
}

/** The action of the fixed row on a path, with the parameters of its pattern; null where the route has none. */
function actionFor(pathname: string): FrameAction | null {
  for (const { pattern, where, spec } of ROW_ACTIONS) {
    const params = matchPattern(pattern, pathname)
    if (params && Object.entries(where ?? {}).every(([name, shape]) => shape.test(params[name] ?? ''))) {
      return { spec, params }
    }
  }
  return null
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
  /** The action of the fixed row, from the route alone: the page may still hide it (`usePageAction`). */
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
    action: actionFor(pathname),
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
