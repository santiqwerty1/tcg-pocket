import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useSetUiSettings, useUiSettings } from '@/api/settings'
import { Section } from '@/components/Section'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { DotggSettingsSection } from './DotggSettingsSection'
import { NotificationsSection } from './NotificationsSection'
import { TrackerSettingsSection } from './TrackerSettingsSection'

export function AppSettingsPage() {
  const ui = useUiSettings()
  const setUi = useSetUiSettings()

  async function toggleBoardImages(checked: boolean) {
    try {
      await setUi.update({ boardImages: checked })
      toast.success(checked ? 'Mesa con imágenes' : 'Mesa solo con texto')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function toggleAskWentFirst(checked: boolean) {
    try {
      await setUi.update({ askWentFirst: checked })
      toast.success(checked ? 'Se va a pedir quién empezó' : 'Quién empezó vuelve a ser opcional')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function toggleThumbnails(checked: boolean) {
    try {
      await setUi.update({ thumbnails: checked })
      toast.success(checked ? 'Miniaturas activadas' : 'Miniaturas desactivadas')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <NotificationsSection />
      <DotggSettingsSection />
      <TrackerSettingsSection />
      <Section title="Interfaz">
        <Label className="flex min-h-14 items-center justify-between gap-3 rounded-lg border px-3">
          <span>
            <span className="block font-medium">Miniaturas de cartas</span>
            <span className="block text-xs text-muted-foreground">
              Imágenes chicas del tracker en las listas. Se cargan después del texto y nunca lo frenan.
            </span>
          </span>
          <Switch checked={ui.thumbnails} onCheckedChange={toggleThumbnails} disabled={setUi.isPending} />
        </Label>
        <Label className="flex min-h-14 items-center justify-between gap-3 rounded-lg border px-3">
          <span>
            <span className="block font-medium">Imágenes en la mesa</span>
            <span className="block text-xs text-muted-foreground">
              Las cartas de las partidas contra el bot y de las repeticiones, con su imagen (en español cuando el
              tracker la tiene). Las que ya viste quedan guardadas en el celu.
            </span>
          </span>
          <Switch checked={ui.boardImages} onCheckedChange={toggleBoardImages} disabled={setUi.isPending} />
        </Label>
        <Label className="flex min-h-14 items-center justify-between gap-3 rounded-lg border px-3">
          <span>
            <span className="block font-medium">Pedir siempre quién empezó</span>
            <span className="block text-xs text-muted-foreground">
              La carga rápida no guarda hasta que digas si empezaste vos: así las estadísticas por orden de turno se
              llenan.
            </span>
          </span>
          <Switch checked={ui.askWentFirst} onCheckedChange={toggleAskWentFirst} disabled={setUi.isPending} />
        </Label>
        <p className="text-xs text-muted-foreground">
          El tema (claro u oscuro) sigue al sistema. Esta preferencia se guarda en el servidor (clave <code>ui</code>).
        </p>
      </Section>
    </div>
  )
}
