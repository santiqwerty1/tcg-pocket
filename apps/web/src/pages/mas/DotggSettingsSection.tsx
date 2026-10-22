import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useClearDotggLink, useDotggStatus, useSetDotggLink } from '@/api/dotgg'
import { useSetSetting } from '@/api/settings'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { formatDateTime } from '@/lib/format'

const RESULT = {
  preview: 'Vista previa lista',
  applied: 'Aplicada',
  unchanged: 'Sin cambios',
  review: 'Requiere revisión',
  error: 'Error',
}

/**
 * T-020: the «Permanent export link» of ptcgpocket.gg. Pasted once; the app only shows its last four characters.
 * With it, the collection comes from the game and the tracker is only compared.
 */
export function DotggSettingsSection() {
  const status = useDotggStatus()
  const setLink = useSetDotggLink()
  const clearLink = useClearDotggLink()
  const save = useSetSetting()
  const [draft, setDraft] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

  async function saveLink() {
    try {
      await setLink.mutateAsync(draft)
      setDraft('')
      toast.success('Link guardado')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function removeLink() {
    try {
      await clearLink.mutateAsync()
      toast.success('Link quitado: la colección vuelve a venir del tracker')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setConfirmClear(false)
    }
  }

  async function toggleAuto(value: boolean) {
    try {
      await save.mutateAsync({ key: 'dotggAutoSync', value })
      await status.refetch()
      toast.success(value ? 'Sincronización diaria activada' : 'Sincronización diaria desactivada')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <Section title="Colección del juego (ptcgpocket.gg)">
      {status.isPending ? (
        <LoadingRows />
      ) : status.isError ? (
        <ErrorState error={status.error} onRetry={() => status.refetch()} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            ptcgpocket.gg lee tu colección del juego todos los días. Con su link de exportación, la app la trae de ahí y
            el tracker queda para comparar en Colección → Tracker al día.
          </p>
          {status.data.configured ? (
            <p className="text-sm">
              Link guardado: <span className="font-mono break-all">{status.data.link}</span>
            </p>
          ) : (
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground">
              <li>En ptcgpocket.gg, entrá a Settings → Display &amp; collection.</li>
              <li>En «Permanent export link», tocá «Create link» y copialo.</li>
              <li>Pegalo acá abajo. Es como una contraseña: no lo compartas.</li>
            </ol>
          )}
          {status.data.unreadable ? (
            <p role="alert" className="text-sm text-destructive">
              El link guardado no se puede leer (cambió la clave del servidor): pegalo de nuevo.
            </p>
          ) : null}
          <Label htmlFor="dotgg-link">{status.data.configured ? 'Cambiar el link' : 'Link de exportación'}</Label>
          <Input
            id="dotgg-link"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://api.dotgg.gg/cgfw/exportcollection?game=pokepocket&token=…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button disabled={setLink.isPending || draft.trim() === ''} onClick={saveLink}>
              Guardar link
            </Button>
            {status.data.configured ? (
              <Button variant="outline" disabled={clearLink.isPending} onClick={() => setConfirmClear(true)}>
                Quitar link
              </Button>
            ) : null}
          </div>
          <Label className="flex min-h-14 items-center justify-between gap-3">
            <span>Sincronizar automáticamente una vez por día</span>
            <Switch
              checked={status.data.enabled}
              disabled={save.isPending || !status.data.configured}
              onCheckedChange={toggleAuto}
            />
          </Label>
          <p className="text-sm text-muted-foreground">
            Aplica sola solo lo que no hace falta mirar: la primera vez, si bajan más del 10&nbsp;% de las copias, si
            hay cambios manuales recientes o cartas que el catálogo no tiene, deja una revisión pendiente y un aviso.
          </p>
          <p className="text-sm">
            Última sincronización: {formatDateTime(status.data.lastCheckedAt ?? status.data.lastAppliedAt)}
          </p>
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
          <ConfirmDialog
            open={confirmClear}
            onOpenChange={setConfirmClear}
            title="¿Quitar el link de ptcgpocket.gg?"
            description="La colección vuelve a venir del tracker (si lo tenés configurado) y se descarta la vista previa pendiente de ptcgpocket.gg. Para volver, pegá el link de nuevo."
            confirmLabel="Quitar link"
            destructive
            pending={clearLink.isPending}
            onConfirm={removeLink}
          />
        </>
      )}
    </Section>
  )
}
