import { CopyIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'

export function androidInstallCommand(origin: string): string {
  const url = new URL(origin)
  if (url.protocol !== 'https:' || !/^[a-zA-Z0-9.:-]+$/.test(url.host)) return ''
  return `curl -fsS --proto '=https' '${url.origin}/api/worker/install/android.sh' -o "$TMPDIR/tcg-install.sh" && bash "$TMPDIR/tcg-install.sh" '${url.origin}'`
}

export function AndroidWorkerSection() {
  const command = androidInstallCommand(window.location.origin)
  return (
    <Section title="Worker en Android">
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>
          Instalá{' '}
          <a className="underline" href="https://f-droid.org/packages/com.termux/" target="_blank" rel="noreferrer">
            Termux desde F-Droid
          </a>{' '}
          o{' '}
          <a
            className="underline"
            href="https://github.com/termux/termux-app#installation"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          , y Termux:API del mismo origen. Usá esas versiones, fuera de Play Store.
        </li>
        <li>Creá arriba un token de tipo worker exclusivo para el celu.</li>
        <li>Copiá este comando y pegalo en Termux. El token se pide ahí, oculto; el comando no lo incluye.</li>
        <li>
          Elegí los núcleos (la mitad por defecto), si trabaja solo mientras carga, el arranque con Termux:Boot y los
          accesos para Termux:Widget.
        </li>
        <li>
          Arrancá con <code>tcg-worker</code>. <code>tcg-worker --check</code> comprueba el motor y la conexión; Ctrl+C
          o <code>tcg-worker --stop</code> lo detienen.
        </li>
        <li>
          Para un toque desde el inicio, instalá{' '}
          <a
            className="underline"
            href="https://f-droid.org/packages/com.termux.widget/"
            target="_blank"
            rel="noreferrer"
          >
            Termux:Widget
          </a>{' '}
          del mismo origen que Termux y elegí «s» para sus accesos. Mantené presionado un espacio vacío de la pantalla
          de inicio → Widgets → Termux:Widget, arrastralo y tocá refrescar. Vas a ver «Arrancar worker», «Detener
          worker» (sin ventana, con aviso si está Termux:API) y «Estado del worker» (Enter para cerrar). Al reinstalar
          se actualizan; con «n» se borran. Refrescá el widget después.
        </li>
      </ol>
      {command ? (
        <>
          <code className="block break-all rounded-lg bg-muted p-3 text-xs select-all">{command}</code>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(command)
                toast.success('Comando copiado')
              } catch {
                toast.error('No se pudo copiar; seleccionalo a mano.')
              }
            }}
          >
            <CopyIcon />
            Copiar comando para Termux
          </Button>
        </>
      ) : (
        <p className="text-sm">Abrí la app por HTTPS para copiar el comando de instalación.</p>
      )}
      <p className="text-sm text-muted-foreground">
        En Android 12+ (desde Android 10), si las sesiones no aparecen, permití «Mostrar sobre otras apps» en Ajustes →
        Apps → Termux → Acceso especial. Es un permiso de Termux para abrir la sesión; si no lo concedés, tocá su
        notificación. «Detener worker» funciona sin abrir una sesión. Termux:Widget no necesita permisos adicionales ni
        acceso al almacenamiento compartido para estos accesos.{' '}
        <a
          className="underline"
          href="https://github.com/termux/termux-widget#setup-instructions"
          target="_blank"
          rel="noreferrer"
        >
          Guía oficial de Termux:Widget
        </a>
      </p>
      <p className="text-sm text-muted-foreground">
        Repetí el comando para actualizar cuando cambie el motor. Excluí Termux de la optimización de batería. Simular
        calienta el celu y consume batería: empezá con pocos núcleos. Leé el LEEME del paquete para Android 12+ y sus
        restricciones de procesos.
      </p>
    </Section>
  )
}
