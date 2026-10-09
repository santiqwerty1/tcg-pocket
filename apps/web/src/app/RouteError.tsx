import { CircleAlertIcon, RefreshCwIcon } from 'lucide-react'
import { useEffect } from 'react'
import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { errorMessage } from '@/api/client'
import { LoadingRows } from '@/components/ListState'
import { Button } from '@/components/ui/button'
import { NotFoundPage } from '@/pages/NotFoundPage'

const RELOAD_KEY = 'tcg.chunk-reload'
const RELOAD_WINDOW_MS = 60_000

/** True for the error of a screen whose chunk is gone (a deploy replaced the build) or did not arrive (no signal). */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '')
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk|Unable to preload CSS/i.test(
    message,
  )
}

/** Reloads the page once per minute at most: the new build brings the new chunks, and a loop is impossible. */
function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    if (Date.now() - last < RELOAD_WINDOW_MS) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

/** Error of a screen, in Spanish and inside the shell (Fase 41): what happened and a way out. */
export function RouteError() {
  const error = useRouteError()
  const chunk = isChunkLoadError(error)

  useEffect(() => {
    if (chunk && navigator.onLine) reloadOnce()
  }, [chunk])

  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />

  const title = chunk ? 'Esta pantalla no se pudo cargar' : 'Algo falló en esta pantalla'
  const detail = chunk
    ? navigator.onLine
      ? 'Puede ser que la app se haya actualizado. Recargá para traer la versión nueva.'
      : 'No hay señal y esta pantalla todavía no estaba guardada en el celu. Probá de nuevo cuando vuelva.'
    : errorMessage(error)

  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 p-4">
      <div className="flex items-start gap-2">
        <CircleAlertIcon className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{detail}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => window.location.reload()}>
          <RefreshCwIcon data-icon="inline-start" />
          Recargar
        </Button>
        <Button variant="outline" asChild>
          <Link to="/partidas">Ir a Hoy</Link>
        </Button>
      </div>
    </div>
  )
}

/** What shows while the first screen of a visit loads its chunk. */
export function ShellFallback() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-18">
      <LoadingRows rows={5} />
    </main>
  )
}
