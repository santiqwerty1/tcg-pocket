/** Partidas sin señal (Fase 28): the matches saved on this phone that did not reach the server yet. */
import { useQueryClient } from '@tanstack/react-query'
import { CloudUploadIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Spinner } from '@/components/ListState'
import { sendPending } from '@/components/OfflineSync'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { discardPending, type PendingMatch, queueMatch, useOnline, usePendingMatches } from '@/lib/offlineMatches'
import { ago } from '@/lib/tournaments'

export function PendingMatches() {
  const items = usePendingMatches()
  const online = useOnline()
  const queryClient = useQueryClient()
  const [sending, setSending] = useState(false)
  if (items.length === 0) return null

  async function sendNow() {
    setSending(true)
    try {
      const sent = await sendPending(queryClient)
      if (sent === 0 && !navigator.onLine) toast.error('Sigue sin señal')
    } finally {
      setSending(false)
    }
  }

  function discard(item: PendingMatch) {
    discardPending(item.clientRef)
    toast(`Descartada: ${item.label}`, {
      duration: 10_000,
      action: { label: 'Deshacer', onClick: () => void queueMatch(item) },
    })
  }

  const waiting = items.some((item) => !item.error)
  return (
    <Section
      title={`Sin enviar (${items.length})`}
      action={
        waiting && online ? (
          <Button variant="outline" size="sm" onClick={sendNow} disabled={sending}>
            {sending ? <Spinner /> : <CloudUploadIcon data-icon="inline-start" />}
            Enviar ahora
          </Button>
        ) : null
      }
    >
      <p className="text-sm text-muted-foreground">
        {online
          ? 'Guardadas en este celu; se envían solas en un momento.'
          : 'Guardadas en este celu; se envían solas cuando vuelva la señal.'}
      </p>
      <ul className="divide-y rounded-lg border">
        {items.map((item) => (
          <li key={item.clientRef} className="flex items-center gap-2 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block text-sm">{item.label}</span>
              <span className={item.error ? 'block text-xs text-destructive' : 'block text-xs text-muted-foreground'}>
                {item.error
                  ? `El servidor no la aceptó: ${item.error}`
                  : `Jugada ${ago(new Date(item.savedAt).toISOString())}`}
              </span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => discard(item)}>
              Descartar
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  )
}
