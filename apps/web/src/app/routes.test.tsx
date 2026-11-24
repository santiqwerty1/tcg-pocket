// The frame changes around the screens; their addresses do not. This freezes every URL the app answers today, and
// checks that the links others send (the manifest, the service worker, the server) still open a screen.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, matchRoutes, type RouteObject, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeApi } from '@/test/fakeApi'
import { Providers } from './Providers'
import { routes } from './routes'

// The tests run from apps/web (jsdom's import.meta.url is not a file URL).
const ROOT = process.cwd()
const text = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

/** The 60 named patterns of today, each with an address that must open it. */
const ROUTES: [pattern: string, sample: string][] = [
  ['/partidas', '/partidas'],
  ['/partidas/estadisticas', '/partidas/estadisticas'],
  ['/partidas/historial', '/partidas/historial'],
  ['/partidas/semana', '/partidas/semana'],
  ['/partidas/temporada', '/partidas/temporada'],
  ['/partidas/clasificar', '/partidas/clasificar'],
  ['/partidas/importar', '/partidas/importar'],
  ['/partidas/:matchId', '/partidas/12'],
  ['/sobres', '/sobres'],
  ['/sobres/promo', '/sobres/promo'],
  ['/torneos', '/torneos'],
  ['/torneos/ajustes', '/torneos/ajustes'],
  ['/torneos/arquetipos/:id', '/torneos/arquetipos/gyarados-ex'],
  ['/torneos/listas/:key', '/torneos/listas/abc123'],
  ['/torneos/matchups', '/torneos/matchups'],
  ['/torneos/semana', '/torneos/semana'],
  ['/simulacion', '/simulacion'],
  ['/simulacion/nueva', '/simulacion/nueva'],
  ['/simulacion/analisis', '/simulacion/analisis'],
  ['/simulacion/calibracion', '/simulacion/calibracion'],
  ['/simulacion/calibracion/:id', '/simulacion/calibracion/86'],
  ['/simulacion/repeticiones/:id', '/simulacion/repeticiones/4'],
  ['/simulacion/:id', '/simulacion/3'],
  ['/laboratorio', '/laboratorio'],
  ['/jugar', '/jugar'],
  ['/jugar/situaciones', '/jugar/situaciones'],
  ['/jugar/ejercicios', '/jugar/ejercicios'],
  ['/jugar/situaciones/:id', '/jugar/situaciones/3-83'],
  ['/jugar/:id', '/jugar/12'],
  ['/jugar/:id/repeticion', '/jugar/12/repeticion'],
  ['/laboratorio/:id', '/laboratorio/7'],
  ['/coleccion', '/coleccion'],
  ['/coleccion/importar', '/coleccion/importar'],
  ['/coleccion/importar/:importId', '/coleccion/importar/9'],
  ['/coleccion/ajustes', '/coleccion/ajustes'],
  ['/coleccion/misiones', '/coleccion/misiones'],
  ['/coleccion/intercambio', '/coleccion/intercambio'],
  ['/coleccion/tracker', '/coleccion/tracker'],
  ['/coleccion/pokemon-zone', '/coleccion/pokemon-zone'],
  ['/coleccion/pokemon-zone/recibir', '/coleccion/pokemon-zone/recibir'],
  ['/cartas/:cardId', '/cartas/B2-113'],
  ['/grupos/:groupId', '/grupos/B3b-64'],
  ['/mazos', '/mazos'],
  ['/mazos/nuevo', '/mazos/nuevo'],
  ['/mazos/importar', '/mazos/importar'],
  ['/mazos/hoy', '/mazos/hoy'],
  ['/mazos/despues', '/mazos/despues'],
  ['/mazos/:deckId', '/mazos/1'],
  ['/mazos/:deckId/editar', '/mazos/1/editar'],
  ['/mas', '/mas'],
  ['/mas/catalogo', '/mas/catalogo'],
  ['/mas/backup', '/mas/backup'],
  ['/mas/tokens', '/mas/tokens'],
  ['/mas/sesion', '/mas/sesion'],
  ['/mas/ajustes', '/mas/ajustes'],
  ['/mas/acerca', '/mas/acerca'],
  ['/mas/mano', '/mas/mano'],
  ['/mas/notas', '/mas/notas'],
  ['/eventos', '/eventos'],
  ['/eventos/:id', '/eventos/2'],
]

/** Addresses with a query string that are part of the contract (a share, a push, the deck pager). */
const WITH_QUERY: [pattern: string, address: string][] = [
  ['/mazos/importar', '/mazos/importar?compartido=1'],
  ['/coleccion/importar', '/coleccion/importar?compartido=1'],
  ['/partidas/semana', '/partidas/semana?semana=2026-11-16'],
  ['/mazos/:deckId', '/mazos/1?armados=1'],
]

/** The path of every route the table declares (the root `/` aside). */
function declared(list: RouteObject[] = routes): string[] {
  return list.flatMap((route) => [
    ...(route.path !== undefined && route.path !== '/' ? [route.path] : []),
    ...declared(route.children ?? []),
  ])
}

/** The pattern of the route an address opens («*» when nobody declares it). */
function patternFor(address: string): string | undefined {
  const path = matchRoutes(routes, address)?.at(-1)?.route.path
  return path === undefined || path === '*' ? path : `/${path}`
}

afterEach(() => vi.unstubAllGlobals())

describe('every URL of today still opens its screen', () => {
  it('the table declares the 60 named patterns, and «*» for the rest', () => {
    expect(ROUTES).toHaveLength(60)
    expect(new Set(ROUTES.map(([pattern]) => pattern)).size).toBe(60)
    expect(
      declared()
        .map((path) => (path === '*' ? path : `/${path}`))
        .sort(),
    ).toEqual([...ROUTES.map(([pattern]) => pattern), '*'].sort())
  })

  it.each([...ROUTES, ...WITH_QUERY])('%s ← %s', (pattern, address) => {
    expect(patternFor(address)).toBe(pattern)
  })

  it('an address nobody declares still falls on «*»', () => {
    for (const address of ['/nada', '/mazos/1/x/y', '/mas/xyz', '/cartas', '/partidas/1/2', '/menu']) {
      expect(patternFor(address), address).toBe('*')
    }
  })

  it('the index keeps redirecting to Hoy', async () => {
    fakeApi({})
    const router = createMemoryRouter(routes, { initialEntries: ['/'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'Hoy' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/partidas')
    expect(router.state.historyAction).toBe('REPLACE')
  })
})

describe('the links others send', () => {
  const opens = (address: string) => {
    const pattern = patternFor(address)
    return pattern !== undefined && pattern !== '*'
  }

  it('the manifest: where the installed app starts and its four shortcuts', () => {
    const config = text('vite.config.ts')
    expect(config).toMatch(/start_url: '\/'/)
    const shortcuts = /shortcuts: \[([\s\S]*?)\n {12}\]/.exec(config)?.[1] ?? ''
    const urls = [...shortcuts.matchAll(/url: '([^']+)'/g)].map((match) => match[1] ?? '')
    expect(urls).toEqual(['/partidas', '/mazos', '/sobres', '/coleccion/importar'])
    for (const url of urls) expect(opens(url), url).toBe(true)
  })

  it('the service worker: where a share lands and the default of a notification', () => {
    const worker = text('public/push-sw.js')
    const redirects = [...worker.matchAll(/Response\.redirect\(here\('([^']+)'\)/g)].map((match) => match[1] ?? '')
    expect(redirects).toEqual(['/coleccion/importar?compartido=1', '/mazos/importar?compartido=1', '/partidas'])
    for (const url of redirects) expect(opens(url), url).toBe(true)
    // A notification without a link opens the index, which leads to Hoy.
    expect(worker).toMatch(/data\.url \|\| '\/'/)
  })

  it('the server: every link of an alert and of a notification', () => {
    const files = [
      '../api/src/alerts/alerts.service.ts',
      '../api/src/notifications/notifications.watcher.ts',
      '../api/src/notifications/notifications.controller.ts',
      '../api/src/weekly/weekly.controller.ts',
    ]
    const links = files.flatMap((file) =>
      text(file)
        .split('\n')
        // What follows `link:` or `url:` on its line: one literal, or the two sides of a choice.
        .flatMap((line) => {
          const value = /\b(?:link|url):(.*)$/.exec(line)?.[1] ?? ''
          return [...value.matchAll(/'(\/[^']*)'|`(\/[^`]*)`/g)].map((match) =>
            (match[1] ?? match[2] ?? '').replace(/\$\{[^}]*\}/g, '1'),
          )
        }),
    )
    // Fewer than this means the extraction broke (the files moved, or write their links another way).
    expect(links.length).toBeGreaterThanOrEqual(10)
    const distinct = [...new Set(links)].sort()
    expect(distinct).toEqual(
      expect.arrayContaining([
        '/mas',
        '/mas/ajustes',
        '/mas/backup',
        '/mas/catalogo',
        '/mas/tokens',
        '/torneos/ajustes',
        '/simulacion',
        '/sobres',
        '/coleccion/importar/1',
        '/jugar/1',
        '/laboratorio/1',
        '/simulacion/1',
        '/partidas/semana?semana=1',
      ]),
    )
    expect(distinct.filter((link) => !opens(link))).toEqual([])
  })
})
