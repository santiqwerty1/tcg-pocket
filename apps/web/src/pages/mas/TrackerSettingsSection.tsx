import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useSetSetting } from '@/api/settings'
import { useTrackerStatus } from '@/api/trackerSync'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { formatDateTime } from '@/lib/format'

const RESULT = { preview: 'Vista previa lista', applied: 'Aplicada', review: 'Requiere revisión', error: 'Error' }
export function TrackerSettingsSection() {
  const status = useTrackerStatus()
  const save = useSetSetting()
  const [draft, setDraft] = useState<string | null>(null)
  async function update(key: string, value: unknown) {
    try {
      await save.mutateAsync({ key, value })
      await status.refetch()
      setDraft(null)
      toast.success('Ajuste guardado')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  return (
    <Section title="Colección del tracker">
      {status.isPending ? (
        <LoadingRows />
      ) : status.isError ? (
        <ErrorState error={status.error} onRetry={() => status.refetch()} />
      ) : (
        <>
          <Label htmlFor="tracker-friend-id">friend_id público (16 dígitos)</Label>
          <Input
            id="tracker-friend-id"
            inputMode="numeric"
            maxLength={16}
            value={draft ?? status.data.friendId}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button
            disabled={save.isPending || (draft !== '' && !/^\d{16}$/.test(draft ?? status.data.friendId))}
            onClick={() => update('trackerFriendId', draft ?? status.data.friendId)}
          >
            Guardar friend_id
          </Button>
          <Label className="flex min-h-14 items-center justify-between gap-3">
            <span>Sincronizar automáticamente cada 6 horas</span>
            <Switch
              checked={status.data.enabled}
              disabled={save.isPending || !status.data.friendId}
              onCheckedChange={(value) => update('trackerAutoSync', value)}
            />
          </Label>
          <p className="text-sm text-muted-foreground">
            Si bajan más del 10 % de las copias, deja un aviso para que revises los cambios.
          </p>
          <p className="text-sm">Última sincronización aplicada: {formatDateTime(status.data.lastAppliedAt)}</p>
          <p className="text-sm">
            Última consulta: {formatDateTime(status.data.lastAttemptAt)} ·{' '}
            {status.data.result ? RESULT[status.data.result] : 'Sin consultas'}
          </p>
          {status.data.error ? (
            <p role="alert" className="text-sm text-destructive">
              {status.data.error}
            </p>
          ) : null}
          {status.data.previewId ? (
            <Link to={`/coleccion/importar/${status.data.previewId}`} className="text-sm underline">
              Ver última vista previa
            </Link>
          ) : null}
        </>
      )}
    </Section>
  )
}
