/**
 * Notificaciones (Fase 18): turn Web Push on for this device, choose what to receive, send a test. «Te toca» goes out
 * only when the game is not open; simulations and searches when they end; app alerts once each.
 */
import { BellIcon, BellOffIcon, SendIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import {
  currentSubscription,
  pushSupported,
  subscribeThisDevice,
  unsubscribeThisDevice,
  useNotificationPreferences,
  useNotifications,
  useTestNotification,
} from '@/api/notifications'
import type { NotificationKind } from '@/api/schemas'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

const KINDS: { kind: NotificationKind; label: string; hint: string }[] = [
  { kind: 'liveGame', label: 'Te toca', hint: 'En una partida contra el bot, si no la tenés abierta' },
  { kind: 'simulations', label: 'Simulaciones', hint: 'Cuando termina una simulación' },
  { kind: 'lab', label: 'Laboratorio', hint: 'Cuando termina una búsqueda (y si encontró algo mejor)' },
  { kind: 'alerts', label: 'Avisos', hint: 'Set nuevo, era nueva, motor nuevo, último día de un sobre' },
  { kind: 'weekly', label: 'Resumen semanal', hint: 'Los lunes a las 10, cómo te fue la semana anterior' },
]

export function NotificationsSection() {
  const status = useNotifications()
  const preferences = useNotificationPreferences()
  const testPush = useTestNotification()
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void currentSubscription().then((subscription) => setSubscribed(subscription !== null))
  }, [])

  async function toggleDevice() {
    setBusy(true)
    try {
      if (subscribed) {
        await unsubscribeThisDevice()
        setSubscribed(false)
        toast.success('Este dispositivo ya no recibe notificaciones')
      } else if (status.data?.publicKey) {
        await subscribeThisDevice(status.data.publicKey)
        setSubscribed(true)
        toast.success('Notificaciones activadas en este dispositivo')
      }
      await status.refetch()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Notificaciones">
      {status.isPending ? <LoadingRows rows={2} /> : null}
      {status.isError ? <ErrorState error={status.error} onRetry={() => status.refetch()} /> : null}
      {status.data && !status.data.enabled ? (
        <p className="text-sm text-muted-foreground">
          Las notificaciones están apagadas en el servidor (faltan las claves VAPID).
        </p>
      ) : null}
      {status.data?.enabled ? (
        <>
          {!pushSupported() ? (
            <p className="text-sm text-warning">
              Este navegador no admite notificaciones. En Android, instalá la app desde Chrome (menú ⋮ → Instalar app).
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={subscribed ? 'outline' : 'default'}
                disabled={busy || subscribed === null}
                onClick={() => void toggleDevice()}
              >
                {subscribed ? <BellOffIcon data-icon="inline-start" /> : <BellIcon data-icon="inline-start" />}
                {subscribed ? 'Desactivar en este dispositivo' : 'Activar en este dispositivo'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={testPush.isPending || status.data.devices.length === 0}
                onClick={() =>
                  testPush.mutate(undefined, {
                    onSuccess: ({ sent }) =>
                      sent > 0
                        ? toast.success('Enviada: tendría que llegar en unos segundos')
                        : toast.error('No llegó a ningún dispositivo'),
                    onError: (error) => toast.error(errorMessage(error)),
                  })
                }
              >
                <SendIcon data-icon="inline-start" />
                Probar
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {status.data.devices.length === 0
              ? 'Ningún dispositivo suscripto.'
              : `${status.data.devices.length} ${status.data.devices.length === 1 ? 'dispositivo suscripto' : 'dispositivos suscriptos'}.`}
          </p>
          <div className="flex flex-col gap-2">
            {KINDS.map(({ kind, label, hint }) => (
              <Label key={kind} className="flex min-h-14 items-center justify-between gap-3 rounded-lg border px-3">
                <span>
                  <span className="block font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
                <Switch
                  checked={status.data.preferences[kind]}
                  disabled={preferences.isPending}
                  onCheckedChange={(checked) =>
                    preferences.mutate({ [kind]: checked }, { onError: (error) => toast.error(errorMessage(error)) })
                  }
                />
              </Label>
            ))}
          </div>
        </>
      ) : null}
    </Section>
  )
}
