import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useSetUiSettings, useUiSettings } from '@/api/settings'
import { Section } from '@/components/Section'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

export function AppSettingsPage() {
  const ui = useUiSettings()
  const setUi = useSetUiSettings()

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
        <p className="text-xs text-muted-foreground">
          El tema (claro u oscuro) sigue al sistema. Esta preferencia se guarda en el servidor (clave <code>ui</code>).
        </p>
      </Section>
    </div>
  )
}
