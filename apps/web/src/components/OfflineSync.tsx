/**
 * Partidas sin señal (Fase 28), mounted once in the shell: a thin notice while the phone has no signal, and the
 * sender of the matches saved meanwhile — when the app opens, when the signal comes back, when it returns to the
 * screen and every minute while something waits.
 */
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { CloudOffIcon } from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { matchKeys, sendMatch } from '@/api/matches'
import { flushPending, useOnline, usePendingMatches } from '@/lib/offlineMatches'

/** Sends what waits and tells how many went through. */
export async function sendPending(queryClient: QueryClient): Promise<number> {
  const sent = await flushPending(sendMatch)
  if (sent > 0) {
    // Review of #130: a match sent with its rank changes the season too (Temporada and Hoy).
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: matchKeys.all }),
      queryClient.invalidateQueries({ queryKey: ['ranked'] }),
    ])
    toast.success(
      sent === 1 ? 'Se envió la partida guardada sin señal' : `Se enviaron ${sent} partidas guardadas sin señal`,
    )
  }
  return sent
}

export function OfflineSync() {
  const queryClient = useQueryClient()
  const online = useOnline()
  const waiting = usePendingMatches().filter((item) => !item.error).length

  useEffect(() => {
    if (!online || waiting === 0) return
    const run = () => void sendPending(queryClient)
    run()
    const timer = window.setInterval(run, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') run()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [online, waiting, queryClient])

  if (online) return null
  return (
    <p
      role="status"
      className="flex items-center justify-center gap-1.5 bg-muted px-3 py-1 text-xs text-muted-foreground"
    >
      <CloudOffIcon className="size-3.5" aria-hidden="true" />
      Sin señal: las partidas que guardes quedan en el celu y se envían solas.
    </p>
  )
}
