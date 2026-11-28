import {
  FlaskConicalIcon,
  GalleryHorizontalEndIcon,
  LayersIcon,
  PlusIcon,
  RefreshCwIcon,
  SunIcon,
  TrophyIcon,
} from 'lucide-react'
import type { RouteObject } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { RouteHandle } from './AppShell'
import {
  FORGOTTEN_QUERY,
  frameFor,
  isMenuPath,
  matchPattern,
  normalizePath,
  ROW_ACTIONS,
  rememberedSearch,
  TABS,
} from './frame'
import { routes } from './routes'

/** Every route of the table that has a path, with its handle and its pattern; `:params` filled with a sample. */
function declared(list: RouteObject[] = routes): { path: string; pattern: string; handle: RouteHandle | undefined }[] {
  return list.flatMap((route) => [
    ...(route.path !== undefined && route.path !== '/'
      ? [
          {
            path: route.path === '*' ? '*' : `/${route.path.replace(/:\w+/g, '1')}`,
            pattern: route.path === '*' ? '*' : `/${route.path}`,
            handle: route.handle as RouteHandle | undefined,
          },
        ]
      : []),
    ...declared(route.children ?? []),
  ])
}

/** The table of the row's actions as data: a link with where it goes from a sample of its parameters. */
const actionTable = () =>
  ROW_ACTIONS.map(({ pattern, where, spec }) => {
    if (spec.kind === 'button') return { pattern, where, ...spec }
    const { to, ...rest } = spec
    return { pattern, where, ...rest, to: to({ deckId: '12' }) }
  })

describe('the frame table', () => {
  it('has the five tabs of mock-up D, in order, each with its start, what lights it and its views', () => {
    expect(TABS).toEqual([
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
    ])
  })

  it('a tab starts on its first view, and every view is one of the paths that light it', () => {
    for (const tab of TABS) {
      expect(tab.prefixes, tab.key).toContain(tab.root)
      if (!tab.views) continue
      expect(tab.views[0]?.path, tab.key).toBe(tab.root)
      for (const view of tab.views) expect(tab.prefixes, view.path).toContain(view.path)
    }
    // No path lights two tabs.
    const prefixes = TABS.flatMap((tab) => tab.prefixes)
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })

  it('lights a tab on its prefixes and on what hangs from them, and none on the Menú or an unknown path', () => {
    const tabOf = (path: string) => frameFor(path).tab?.key ?? null
    expect(tabOf('/partidas')).toBe('hoy')
    expect(tabOf('/partidas/historial')).toBe('hoy')
    expect(tabOf('/mazos/abc/editar')).toBe('mazos')
    for (const path of ['/sobres/promo', '/coleccion/tracker', '/cartas/B2-113', '/grupos/B3b-64']) {
      expect(tabOf(path), path).toBe('cartas')
    }
    for (const path of ['/torneos/semana', '/eventos/1']) expect(tabOf(path), path).toBe('meta')
    for (const path of ['/laboratorio', '/laboratorio/7', '/simulacion/3', '/jugar/12']) {
      expect(tabOf(path), path).toBe('pruebas')
    }
    for (const path of ['/mas', '/mas/tokens', '/nada', '/', '/mazosx', '/partidasviejas/1']) {
      expect(tabOf(path), path).toBeNull()
    }
    expect(isMenuPath('/mas')).toBe(true)
    expect(isMenuPath('/mas/backup')).toBe(true)
    expect(isMenuPath('/MAS/')).toBe(true)
    expect(isMenuPath('/masa')).toBe(false)
    expect(isMenuPath('/mazos')).toBe(false)
  })

  it('shows the views only on exactly one of their paths', () => {
    expect(frameFor('/sobres')).toMatchObject({ views: TABS[2]?.views, viewsLabel: 'Vistas de Cartas' })
    expect(frameFor('/coleccion')).toMatchObject({ views: TABS[2]?.views, viewsLabel: 'Vistas de Cartas' })
    expect(frameFor('/torneos').viewsLabel).toBe('Vistas de Meta')
    expect(frameFor('/eventos').viewsLabel).toBe('Vistas de Meta')
    for (const path of ['/laboratorio', '/simulacion', '/jugar']) {
      expect(frameFor(path).viewsLabel, path).toBe('Vistas de Pruebas')
      expect(frameFor(path).views, path).toHaveLength(3)
    }
    for (const path of [
      '/sobres/promo',
      '/coleccion/importar',
      '/cartas/A1-1',
      '/torneos/semana',
      '/eventos/1',
      '/laboratorio/1',
      '/simulacion/nueva',
      '/jugar/situaciones',
      '/partidas',
      '/mazos',
      '/mas',
    ]) {
      expect(frameFor(path), path).toMatchObject({ views: null, viewsLabel: null })
    }
  })

  it('the actions of the fixed row, route by route: exactly these', () => {
    expect(actionTable()).toEqual([
      { pattern: '/mazos', label: 'Nuevo mazo', icon: PlusIcon, kind: 'link', to: '/mazos/nuevo' },
      // A link with its text (the deck has no views until phase 3), to Hoy with the deck chosen.
      {
        pattern: '/mazos/:deckId',
        where: { deckId: /^\d+$/ },
        label: 'Registrar partida',
        ariaLabel: 'Registrar partida con este mazo',
        icon: PlusIcon,
        kind: 'link',
        to: '/partidas?mazo=12',
      },
      // A button that keeps its text beside the two views of Cartas; the page gives it today's sync.
      {
        pattern: '/coleccion',
        label: 'Sincronizar',
        ariaLabel: 'Sincronizar la colección',
        icon: RefreshCwIcon,
        display: 'text',
        kind: 'button',
        pendingLabel: 'Sincronizando…',
      },
      // The first «+» of the app: its icon alone, beside the three views of Pruebas.
      { pattern: '/simulacion', label: 'Nueva simulación', icon: PlusIcon, kind: 'link', to: '/simulacion/nueva' },
    ])
    // A deck's number is written in the address as it is given.
    const deck = ROW_ACTIONS.find(({ pattern }) => pattern === '/mazos/:deckId')?.spec
    expect(deck?.kind === 'link' && deck.to({ deckId: '7 b' })).toBe('/partidas?mazo=7%20b')
  })

  it('each route of the table has the action of its own pattern, and these are all the screens with one', () => {
    const withAction = Object.fromEntries(
      declared()
        .filter(({ path }) => path !== '*' && frameFor(path).action !== null)
        .map(({ path }) => [path, frameFor(path).action?.spec.label]),
    )
    expect(withAction).toEqual({
      '/mazos': 'Nuevo mazo',
      '/mazos/1': 'Registrar partida',
      '/coleccion': 'Sincronizar',
      '/simulacion': 'Nueva simulación',
    })
    // The pattern of the action that a route's sample path finds is that route's own: `/mazos/:deckId` does not take
    // the screens beside it (`/mazos/nuevo`, `/mazos/importar`, `/mazos/hoy`, `/mazos/despues`) for a deck.
    for (const { path, pattern } of declared()) {
      if (path === '*') continue
      const found = frameFor(path).action
      if (!found) continue
      expect(ROW_ACTIONS.find((row) => row.spec === found.spec)?.pattern, path).toBe(pattern)
    }
    for (const path of ['/mazos/nuevo', '/mazos/importar', '/mazos/hoy', '/mazos/despues', '/mazos/abc']) {
      expect(frameFor(path).action, path).toBeNull()
    }
    // And every pattern of the table is a route that exists.
    const patterns = declared().map(({ pattern }) => pattern)
    for (const { pattern } of ROW_ACTIONS) expect(patterns, pattern).toContain(pattern)
    // The parameters come from the path.
    expect(frameFor('/mazos/40').action?.params).toEqual({ deckId: '40' })
    expect(frameFor('/mazos').action?.params).toEqual({})
  })

  it('beside views an action is an icon (or keeps its text, with its icon): these two screens have both', () => {
    const both = declared()
      .filter(({ path }) => path !== '*' && frameFor(path).views !== null && frameFor(path).action !== null)
      .map(({ path }) => path)
    expect(both).toEqual(['/simulacion', '/coleccion'])
    for (const { pattern, spec } of ROW_ACTIONS) {
      const sample = pattern.replace(/:\w+/g, '1')
      if (frameFor(sample).views === null) continue
      // With display 'auto' the icon is all there is; with 'text' it goes before the text, as in D.
      expect(spec.icon, pattern).toBeDefined()
      expect(['auto', 'text'], pattern).toContain(spec.display ?? 'auto')
    }
    // A link knows where it goes and a button does not; only a button may open a dialog.
    for (const { pattern, spec } of ROW_ACTIONS) {
      if (spec.kind === 'link') expect(typeof spec.to, pattern).toBe('function')
      else expect('to' in spec, pattern).toBe(false)
    }
    // An accessible name that says more starts with what is seen.
    for (const { pattern, spec } of ROW_ACTIONS) {
      if (spec.ariaLabel) expect(spec.ariaLabel.startsWith(spec.label), pattern).toBe(true)
    }
  })

  it('a screen that keeps its own buttons in reach (`StickyActions`) has no fixed row', () => {
    for (const path of ['/partidas', '/mazos/nuevo', '/mazos/1/editar', '/mazos/importar', '/coleccion/importar/9']) {
      expect(frameFor(path), path).toMatchObject({ views: null, action: null })
    }
  })

  it('a card lights Cartas without becoming where Cartas was', () => {
    expect(frameFor('/cartas/B2-113')).toMatchObject({ remember: false })
    expect(frameFor('/grupos/B3b-64')).toMatchObject({ remember: false })
    for (const path of ['/sobres', '/sobres/promo', '/coleccion', '/coleccion/tracker', '/mazos/1', '/partidas']) {
      expect(frameFor(path).remember, path).toBe(true)
    }
    // Nothing to remember where no tab is lit.
    expect(frameFor('/mas').remember).toBe(false)
    expect(frameFor('/nada').remember).toBe(false)
  })

  it('compares the pathname alone: lower-cased, without trailing slashes, whatever the query string says', () => {
    expect(normalizePath('/mazos/')).toBe('/mazos')
    expect(normalizePath('/SOBRES')).toBe('/sobres')
    expect(normalizePath('/Coleccion//')).toBe('/coleccion')
    expect(normalizePath('/mazos?armados=1')).toBe('/mazos')
    expect(normalizePath('/mazos/#x')).toBe('/mazos')
    expect(normalizePath('/')).toBe('/')
    expect(normalizePath('')).toBe('/')

    expect(frameFor('/mazos/')).toEqual(frameFor('/mazos'))
    expect(frameFor('/MAZOS').action?.spec.label).toBe('Nuevo mazo')
    expect(frameFor('/Mazos/12/')).toEqual(frameFor('/mazos/12'))
    expect(frameFor('/coleccion?vista=edicion').action?.spec.label).toBe('Sincronizar')
    expect(frameFor('/SOBRES')).toEqual(frameFor('/sobres'))
    expect(frameFor('/SOBRES').viewsLabel).toBe('Vistas de Cartas')
    expect(frameFor('/coleccion?vista=edicion')).toEqual(frameFor('/coleccion'))
    expect(frameFor('/mazos?armados=1')).toEqual(frameFor('/mazos'))
    expect(frameFor('/Cartas/B2-113/')).toMatchObject({ remember: false })
    expect(frameFor('/cartas/B2-113').tab?.key).toBe('cartas')
  })

  it('forgets the query keys that are orders, not places', () => {
    expect(FORGOTTEN_QUERY).toEqual([
      { key: 'compartido', path: null },
      { key: 'mazo', path: '/partidas' },
    ])
    expect(rememberedSearch('/coleccion/importar', '?compartido=1')).toBe('')
    expect(rememberedSearch('/mazos/importar', '?compartido=1&x=2')).toBe('?x=2')
    expect(rememberedSearch('/partidas', '?mazo=3')).toBe('')
    expect(rememberedSearch('/PARTIDAS/', '?mazo=3')).toBe('')
    // `mazo` is an order only on Hoy: the history of matches filters by it.
    expect(rememberedSearch('/partidas/historial', '?mazo=3&rival=x')).toBe('?mazo=3&rival=x')
    // What has nothing to drop comes back as it was, character by character.
    expect(rememberedSearch('/mazos', '?etiqueta=a%20b&armados=1')).toBe('?etiqueta=a%20b&armados=1')
    expect(rememberedSearch('/mazos', '')).toBe('')
  })
})

describe('a route pattern against a path', () => {
  it('matches segment by segment, as the router: without case for the fixed ones, the parameters as written', () => {
    expect(matchPattern('/mazos', '/mazos')).toEqual({})
    expect(matchPattern('/mazos/:deckId', '/mazos/12')).toEqual({ deckId: '12' })
    expect(matchPattern('/mazos/:deckId', '/MAZOS/12')).toEqual({ deckId: '12' })
    expect(matchPattern('/torneos/arquetipos/:id', '/torneos/arquetipos/Gardevoir-ex')).toEqual({ id: 'Gardevoir-ex' })
    expect(matchPattern('/a/:x/b/:y', '/a/1/B/2')).toEqual({ x: '1', y: '2' })
    // Decoded, as `useParams` gives them.
    expect(matchPattern('/grupos/:groupId', '/grupos/B3b-64%20x')).toEqual({ groupId: 'B3b-64 x' })
  })

  it('the query, the fragment and trailing slashes do not count', () => {
    expect(matchPattern('/mazos/:deckId', '/mazos/12/')).toEqual({ deckId: '12' })
    expect(matchPattern('/mazos/:deckId', '/mazos/12?x=1#y')).toEqual({ deckId: '12' })
    expect(matchPattern('/coleccion', '/coleccion?vista=edicion')).toEqual({})
    expect(matchPattern('/coleccion', '/coleccion//')).toEqual({})
  })

  it('does not match another number of segments, another fixed segment, an empty parameter or a broken escape', () => {
    expect(matchPattern('/mazos/:deckId', '/mazos')).toBeNull()
    expect(matchPattern('/mazos/:deckId', '/mazos/12/editar')).toBeNull()
    expect(matchPattern('/mazos', '/mazosx')).toBeNull()
    expect(matchPattern('/mazos', '/')).toBeNull()
    // Another number of segments, before any parameter is looked at.
    expect(matchPattern('/mazos/:deckId', '/mazos//')).toBeNull()
    expect(matchPattern('/mazos/:deckId', '/mazos//12')).toBeNull()
    // The same number, with the parameter empty: a pattern with one in the middle (the deck's views of phase 3).
    expect(matchPattern('/a/:x/b', '/a//b')).toBeNull()
    expect(matchPattern('/mazos/:deckId/:view', '/mazos//partidas')).toBeNull()
    expect(matchPattern('/mazos/:deckId', '/cartas/12')).toBeNull()
    expect(matchPattern('/grupos/:groupId', '/grupos/%E0%A4%A')).toBeNull()
  })
})

describe('the frame and the route table', () => {
  const all = declared()

  it('every route has its tab or belongs to the Menú, so a new route cannot be left out', () => {
    expect(all.length).toBeGreaterThanOrEqual(62)
    const outside = all.filter(({ path }) => path !== '*' && frameFor(path).tab === null).map(({ path }) => path)
    expect(outside.every((path) => path === '/mas' || path.startsWith('/mas/'))).toBe(true)
    // The Menú, its eight pages and the gallery of the pieces, which «Acerca de» leads to.
    expect(outside).toHaveLength(10)
    expect(outside).toContain('/mas/piezas')
    // And the Menú's pages light no tab.
    for (const path of outside) expect(isMenuPath(path), path).toBe(true)
  })

  it('«Volver» going up stays in the tab: the parent of every screen is in the tab of the screen', () => {
    const withBack = all.filter(({ handle }) => handle?.back !== undefined)
    expect(withBack.length).toBeGreaterThanOrEqual(50)
    const elsewhere = withBack
      .filter(({ path, handle }) => path === '*' || frameFor(handle?.back ?? '').tab !== frameFor(path).tab)
      .map(({ path, handle }) => `${path} → ${handle?.back}`)
    // The Menú goes back to the app's start, and an address nobody declares to the index.
    expect(elsewhere).toEqual(['/mas → /partidas', '* → /'])
  })

  it('the starts of the tabs and their views are roots: no «Volver» in their header', () => {
    const roots = all.filter(({ handle }) => handle && handle.back === undefined).map(({ path }) => path)
    expect(roots.sort()).toEqual(
      [
        '/partidas',
        '/mazos',
        '/sobres',
        '/coleccion',
        '/torneos',
        '/eventos',
        '/laboratorio',
        '/simulacion',
        '/jugar',
      ].sort(),
    )
    expect(all.find(({ path }) => path === '/mas')?.handle).toEqual({ title: 'Menú', back: '/partidas' })
  })
})
