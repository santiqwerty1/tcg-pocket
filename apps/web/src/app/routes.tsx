import type { ComponentType } from 'react'
import { Navigate, type RouteObject } from 'react-router'
import { CardPage } from '@/pages/cartas/CardPage'
import { GroupPage } from '@/pages/cartas/GroupPage'
import { AdjustmentsPage } from '@/pages/coleccion/AdjustmentsPage'
import { CollectionPage } from '@/pages/coleccion/CollectionPage'
import { ImportPage } from '@/pages/coleccion/ImportPage'
import { ImportPreviewPage } from '@/pages/coleccion/ImportPreviewPage'
import { MissionsPage } from '@/pages/coleccion/MissionsPage'
import { TradesPage } from '@/pages/coleccion/TradesPage'
import { MasPage } from '@/pages/mas/MasPage'
import { DeckDetailPage } from '@/pages/mazos/DeckDetailPage'
import { DeckEditorPage } from '@/pages/mazos/DeckEditorPage'
import { DeckImportPage } from '@/pages/mazos/DeckImportPage'
import { DecksPage } from '@/pages/mazos/DecksPage'
import { PickTodayPage } from '@/pages/mazos/PickTodayPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { MatchEditPage } from '@/pages/partidas/MatchEditPage'
import { MatchHistoryPage } from '@/pages/partidas/MatchHistoryPage'
import { MatchStatsPage } from '@/pages/partidas/MatchStatsPage'
import { PartidasPage } from '@/pages/partidas/PartidasPage'
import { WeekPage } from '@/pages/partidas/WeekPage'
import { SobresPage } from '@/pages/sobres/SobresPage'
import { AppShell, type RouteHandle } from './AppShell'
import { RouteError, ShellFallback } from './RouteError'

function handle(title: string, back?: string): RouteHandle {
  return back === undefined ? { title } : { title, back }
}

/**
 * A screen loaded when it is first opened (Fase 41): the big ones that are not used every day (torneos, simulación,
 * laboratorio, jugar, eventos and the settings under Más) leave the main bundle. The service worker precaches every
 * chunk, so they still open without signal; a chunk that vanished with a deploy is handled by `RouteError`.
 */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K): RouteObject['lazy'] {
  return async () => ({ Component: (await load())[name] })
}

/** Route table shared by the browser router and the tests (memory router). */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    // Shown while the first screen's chunk loads, and if the shell itself fails.
    HydrateFallback: ShellFallback,
    errorElement: <RouteError />,
    children: [
      {
        // Errors of a screen render inside the shell, so the header and the bottom bar stay.
        errorElement: <RouteError />,
        children: [
          // Home: logging a match is the most frequent action (PLAN §7 Fase 2: ≤ 4 taps from the home screen).
          { index: true, element: <Navigate to="/partidas" replace /> },
          { path: 'partidas', element: <PartidasPage />, handle: handle('Hoy') },
          {
            path: 'partidas/estadisticas',
            element: <MatchStatsPage />,
            handle: handle('Estadísticas de partidas', '/partidas'),
          },
          {
            path: 'partidas/historial',
            element: <MatchHistoryPage />,
            handle: handle('Historial de partidas', '/partidas'),
          },
          { path: 'partidas/semana', element: <WeekPage />, handle: handle('Tu semana', '/partidas') },
          { path: 'partidas/:matchId', element: <MatchEditPage />, handle: handle('Editar partida', '/partidas') },
          { path: 'sobres', element: <SobresPage />, handle: handle('Sobres') },
          {
            path: 'torneos',
            lazy: page(() => import('@/pages/torneos/TorneosPage'), 'TorneosPage'),
            handle: handle('Torneos', '/mas'),
          },
          {
            path: 'torneos/ajustes',
            lazy: page(() => import('@/pages/torneos/TorneosAjustesPage'), 'TorneosAjustesPage'),
            handle: handle('Ajustes de torneos', '/torneos'),
          },
          {
            path: 'torneos/arquetipos/:id',
            lazy: page(() => import('@/pages/torneos/ArchetypePage'), 'ArchetypePage'),
            handle: handle('Arquetipo', '/torneos'),
          },
          {
            path: 'torneos/listas/:key',
            lazy: page(() => import('@/pages/torneos/ListPage'), 'ListPage'),
            handle: handle('Lista de torneo', '/torneos'),
          },
          {
            path: 'torneos/matchups',
            lazy: page(() => import('@/pages/torneos/MatchupsPage'), 'MatchupsPage'),
            handle: handle('Matchups', '/torneos'),
          },
          {
            path: 'torneos/semana',
            lazy: page(() => import('@/pages/torneos/TrendsPage'), 'TrendsPage'),
            handle: handle('Meta semanal', '/torneos'),
          },
          {
            path: 'simulacion',
            lazy: page(() => import('@/pages/simulacion/SimulacionPage'), 'SimulacionPage'),
            handle: handle('Simulación', '/mas'),
          },
          {
            path: 'simulacion/nueva',
            lazy: page(() => import('@/pages/simulacion/NewSimulationPage'), 'NewSimulationPage'),
            handle: handle('Nueva simulación', '/simulacion'),
          },
          {
            path: 'simulacion/repeticiones/:id',
            lazy: page(() => import('@/pages/simulacion/ReplayPage'), 'ReplayPage'),
            handle: handle('Repetición', '/simulacion'),
          },
          {
            path: 'simulacion/:id',
            lazy: page(() => import('@/pages/simulacion/SimulationDetailPage'), 'SimulationDetailPage'),
            handle: handle('Simulación', '/simulacion'),
          },
          {
            path: 'laboratorio',
            lazy: page(() => import('@/pages/laboratorio/LaboratorioPage'), 'LaboratorioPage'),
            handle: handle('Laboratorio de mazos', '/mas'),
          },
          {
            path: 'jugar',
            lazy: page(() => import('@/pages/jugar/JugarPage'), 'JugarPage'),
            handle: handle('Jugar contra un bot', '/mas'),
          },
          {
            path: 'jugar/situaciones',
            lazy: page(() => import('@/pages/jugar/PuzzlesPage'), 'PuzzlesPage'),
            handle: handle('Situaciones para resolver', '/jugar'),
          },
          {
            path: 'jugar/ejercicios',
            lazy: page(() => import('@/pages/jugar/DrillsPage'), 'DrillsPage'),
            handle: handle('Ejercicios de cálculo', '/jugar'),
          },
          {
            path: 'jugar/situaciones/:id',
            lazy: page(() => import('@/pages/jugar/PuzzlePage'), 'PuzzlePage'),
            handle: handle('Situación', '/jugar/situaciones'),
          },
          {
            path: 'jugar/:id',
            lazy: page(() => import('@/pages/jugar/GamePage'), 'GamePage'),
            handle: handle('Partida', '/jugar'),
          },
          {
            path: 'jugar/:id/repeticion',
            lazy: page(() => import('@/pages/jugar/GameReplayPage'), 'GameReplayPage'),
            handle: handle('Repetición', '/jugar'),
          },
          {
            path: 'laboratorio/:id',
            lazy: page(() => import('@/pages/laboratorio/LabJobPage'), 'LabJobPage'),
            handle: handle('Laboratorio', '/laboratorio'),
          },

          { path: 'coleccion', element: <CollectionPage />, handle: handle('Colección') },
          { path: 'coleccion/importar', element: <ImportPage />, handle: handle('Importar colección', '/coleccion') },
          {
            path: 'coleccion/importar/:importId',
            element: <ImportPreviewPage />,
            handle: handle('Vista previa del import', '/coleccion/importar'),
          },
          { path: 'coleccion/ajustes', element: <AdjustmentsPage />, handle: handle('Ajustes manuales', '/coleccion') },
          {
            path: 'coleccion/misiones',
            element: <MissionsPage />,
            handle: handle('Misiones de colección', '/coleccion'),
          },
          {
            path: 'coleccion/intercambio',
            element: <TradesPage />,
            handle: handle('Lista de intercambio', '/coleccion'),
          },
          { path: 'cartas/:cardId', element: <CardPage />, handle: handle('Carta', '/coleccion') },
          { path: 'grupos/:groupId', element: <GroupPage />, handle: handle('Carta funcional', '/coleccion') },

          { path: 'mazos', element: <DecksPage />, handle: handle('Mazos') },
          { path: 'mazos/nuevo', element: <DeckEditorPage />, handle: handle('Nuevo mazo', '/mazos') },
          { path: 'mazos/importar', element: <DeckImportPage />, handle: handle('Importar mazos', '/mazos') },
          { path: 'mazos/hoy', element: <PickTodayPage />, handle: handle('¿Qué mazo llevo hoy?', '/mazos') },
          { path: 'mazos/:deckId', element: <DeckDetailPage />, handle: handle('Mazo', '/mazos') },
          { path: 'mazos/:deckId/editar', element: <DeckEditorPage />, handle: handle('Editar mazo', '/mazos') },

          { path: 'mas', element: <MasPage />, handle: handle('Más') },
          {
            path: 'mas/catalogo',
            lazy: page(() => import('@/pages/mas/CatalogPage'), 'CatalogPage'),
            handle: handle('Catálogo', '/mas'),
          },
          {
            path: 'mas/backup',
            lazy: page(() => import('@/pages/mas/BackupPage'), 'BackupPage'),
            handle: handle('Copia de seguridad', '/mas'),
          },
          {
            path: 'mas/tokens',
            lazy: page(() => import('@/pages/mas/TokensPage'), 'TokensPage'),
            handle: handle('Tokens de API', '/mas'),
          },
          {
            path: 'mas/sesion',
            lazy: page(() => import('@/pages/mas/SessionPage'), 'SessionPage'),
            handle: handle('Sesión', '/mas'),
          },
          {
            path: 'mas/ajustes',
            lazy: page(() => import('@/pages/mas/AppSettingsPage'), 'AppSettingsPage'),
            handle: handle('Ajustes de la app', '/mas'),
          },
          {
            path: 'mas/acerca',
            lazy: page(() => import('@/pages/mas/AboutPage'), 'AboutPage'),
            handle: handle('Acerca de', '/mas'),
          },
          {
            path: 'mas/mano',
            lazy: page(() => import('@/pages/mas/HandCalculatorPage'), 'HandCalculatorPage'),
            handle: handle('Calculadora de mano', '/mas'),
          },
          {
            path: 'mas/notas',
            lazy: page(() => import('@/pages/mas/RivalNotesPage'), 'RivalNotesPage'),
            handle: handle('Notas por rival', '/mas'),
          },
          {
            path: 'eventos',
            lazy: page(() => import('@/pages/eventos/EventsPage'), 'EventsPage'),
            handle: handle('Eventos', '/mas'),
          },
          {
            path: 'eventos/:id',
            lazy: page(() => import('@/pages/eventos/EventPage'), 'EventPage'),
            handle: handle('Evento', '/eventos'),
          },

          { path: '*', element: <NotFoundPage />, handle: handle('No encontrado', '/') },
        ],
      },
    ],
  },
]
