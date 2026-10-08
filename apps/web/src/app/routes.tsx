import { Navigate, type RouteObject } from 'react-router'
import { CardPage } from '@/pages/cartas/CardPage'
import { GroupPage } from '@/pages/cartas/GroupPage'
import { AdjustmentsPage } from '@/pages/coleccion/AdjustmentsPage'
import { CollectionPage } from '@/pages/coleccion/CollectionPage'
import { ImportPage } from '@/pages/coleccion/ImportPage'
import { ImportPreviewPage } from '@/pages/coleccion/ImportPreviewPage'
import { AboutPage } from '@/pages/mas/AboutPage'
import { AppSettingsPage } from '@/pages/mas/AppSettingsPage'
import { BackupPage } from '@/pages/mas/BackupPage'
import { CatalogPage } from '@/pages/mas/CatalogPage'
import { MasPage } from '@/pages/mas/MasPage'
import { SessionPage } from '@/pages/mas/SessionPage'
import { TokensPage } from '@/pages/mas/TokensPage'
import { DeckDetailPage } from '@/pages/mazos/DeckDetailPage'
import { DeckEditorPage } from '@/pages/mazos/DeckEditorPage'
import { DeckImportPage } from '@/pages/mazos/DeckImportPage'
import { DecksPage } from '@/pages/mazos/DecksPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { MatchEditPage } from '@/pages/partidas/MatchEditPage'
import { MatchHistoryPage } from '@/pages/partidas/MatchHistoryPage'
import { MatchStatsPage } from '@/pages/partidas/MatchStatsPage'
import { PartidasPage } from '@/pages/partidas/PartidasPage'
import { NewSimulationPage } from '@/pages/simulacion/NewSimulationPage'
import { ReplayPage } from '@/pages/simulacion/ReplayPage'
import { SimulacionPage } from '@/pages/simulacion/SimulacionPage'
import { SimulationDetailPage } from '@/pages/simulacion/SimulationDetailPage'
import { SobresPage } from '@/pages/sobres/SobresPage'
import { ArchetypePage } from '@/pages/torneos/ArchetypePage'
import { ListPage } from '@/pages/torneos/ListPage'
import { TorneosAjustesPage } from '@/pages/torneos/TorneosAjustesPage'
import { TorneosPage } from '@/pages/torneos/TorneosPage'
import { AppShell, type RouteHandle } from './AppShell'

function handle(title: string, back?: string): RouteHandle {
  return back === undefined ? { title } : { title, back }
}

/** Route table shared by the browser router and the tests (memory router). */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      // Home: logging a match is the most frequent action (PLAN §7 Fase 2: ≤ 4 taps from the home screen).
      { index: true, element: <Navigate to="/partidas" replace /> },
      { path: 'partidas', element: <PartidasPage />, handle: handle('Partidas') },
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
      { path: 'partidas/:matchId', element: <MatchEditPage />, handle: handle('Editar partida', '/partidas') },
      { path: 'sobres', element: <SobresPage />, handle: handle('Sobres') },
      { path: 'torneos', element: <TorneosPage />, handle: handle('Torneos', '/mas') },
      { path: 'torneos/ajustes', element: <TorneosAjustesPage />, handle: handle('Ajustes de torneos', '/torneos') },
      { path: 'torneos/arquetipos/:id', element: <ArchetypePage />, handle: handle('Arquetipo', '/torneos') },
      { path: 'torneos/listas/:key', element: <ListPage />, handle: handle('Lista de torneo', '/torneos') },
      { path: 'simulacion', element: <SimulacionPage />, handle: handle('Simulación', '/mas') },
      { path: 'simulacion/nueva', element: <NewSimulationPage />, handle: handle('Nueva simulación', '/simulacion') },
      {
        path: 'simulacion/repeticiones/:id',
        element: <ReplayPage />,
        handle: handle('Repetición', '/simulacion'),
      },
      { path: 'simulacion/:id', element: <SimulationDetailPage />, handle: handle('Simulación', '/simulacion') },

      { path: 'coleccion', element: <CollectionPage />, handle: handle('Colección') },
      { path: 'coleccion/importar', element: <ImportPage />, handle: handle('Importar colección', '/coleccion') },
      {
        path: 'coleccion/importar/:importId',
        element: <ImportPreviewPage />,
        handle: handle('Vista previa del import', '/coleccion/importar'),
      },
      { path: 'coleccion/ajustes', element: <AdjustmentsPage />, handle: handle('Ajustes manuales', '/coleccion') },
      { path: 'cartas/:cardId', element: <CardPage />, handle: handle('Carta', '/coleccion') },
      { path: 'grupos/:groupId', element: <GroupPage />, handle: handle('Carta funcional', '/coleccion') },

      { path: 'mazos', element: <DecksPage />, handle: handle('Mazos') },
      { path: 'mazos/nuevo', element: <DeckEditorPage />, handle: handle('Nuevo mazo', '/mazos') },
      { path: 'mazos/importar', element: <DeckImportPage />, handle: handle('Importar mazos', '/mazos') },
      { path: 'mazos/:deckId', element: <DeckDetailPage />, handle: handle('Mazo', '/mazos') },
      { path: 'mazos/:deckId/editar', element: <DeckEditorPage />, handle: handle('Editar mazo', '/mazos') },

      { path: 'mas', element: <MasPage />, handle: handle('Más') },
      { path: 'mas/catalogo', element: <CatalogPage />, handle: handle('Catálogo', '/mas') },
      { path: 'mas/backup', element: <BackupPage />, handle: handle('Copia de seguridad', '/mas') },
      { path: 'mas/tokens', element: <TokensPage />, handle: handle('Tokens de API', '/mas') },
      { path: 'mas/sesion', element: <SessionPage />, handle: handle('Sesión', '/mas') },
      { path: 'mas/ajustes', element: <AppSettingsPage />, handle: handle('Ajustes de la app', '/mas') },
      { path: 'mas/acerca', element: <AboutPage />, handle: handle('Acerca de', '/mas') },

      { path: '*', element: <NotFoundPage />, handle: handle('No encontrado', '/') },
    ],
  },
]
