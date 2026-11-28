/**
 * The Menú, at the address «Más» had (`/mas`): the notices, the screens mock-up D does not place yet, the look of this
 * device and the settings and system pages. What «Más» also listed (Torneos, Eventos, Laboratorio, Simulación, Jugar)
 * is now a tab or a view of the frame (`app/frame.ts`).
 */
import {
  BookmarkIcon,
  ChevronRightIcon,
  CircleHelpIcon,
  DatabaseIcon,
  HandIcon,
  KeyRoundIcon,
  type LucideIcon,
  NotebookPenIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
  UserIcon,
} from 'lucide-react'
import { type ReactNode, useId } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { useAlerts } from '@/api/alerts'
import { errorMessage } from '@/api/client'
import { useSetUiSettings, useUiSettings } from '@/api/settings'
import { type SegmentedOption, SegmentedRadio } from '@/components/SegmentedRadio'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { type MotionLevel, type ThemeChoice, useLook, type ViewsPlace } from '@/lib/look'
import { cn } from '@/lib/utils'

interface Entry {
  to: string
  label: string
  hint: string
  icon: LucideIcon
}

/** What mock-up D has no place for yet. They go first, so they stay as near as they were under «Más». */
const OTHER_SCREENS: Entry[] = [
  { to: '/mas/notas', label: 'Notas por rival', hint: 'Cómo jugarle a cada arquetipo', icon: NotebookPenIcon },
  {
    to: '/mas/mano',
    label: 'Calculadora de mano',
    hint: 'La chance de tener una carta en la mano inicial y en cada turno',
    icon: HandIcon,
  },
  {
    to: '/coleccion/pokemon-zone',
    label: 'pokemon-zone',
    hint: 'Puntos de sobre, relojes, cupones y partidas del juego',
    icon: BookmarkIcon,
  },
]

const SETTINGS_AND_SYSTEM: Entry[] = [
  {
    to: '/mas/ajustes',
    label: 'Ajustes de la app',
    hint: 'Notificaciones, ptcgpocket.gg, tracker, imágenes en la mesa y quién empezó',
    icon: SlidersHorizontalIcon,
  },
  {
    to: '/mas/backup',
    label: 'Copia de seguridad',
    hint: 'Descargar, restaurar y la copia en la nube',
    icon: DatabaseIcon,
  },
  {
    to: '/mas/catalogo',
    label: 'Catálogo',
    hint: 'Cartas y expansiones cargadas, y su sincronización',
    icon: RefreshCwIcon,
  },
  { to: '/mas/tokens', label: 'Tokens de API', hint: 'Claude, workers y actividad', icon: KeyRoundIcon },
  { to: '/mas/sesion', label: 'Sesión', hint: 'Contraseña y cerrar sesión', icon: UserIcon },
  { to: '/mas/acerca', label: 'Acerca de', hint: 'Versión y licencias', icon: CircleHelpIcon },
]

const THEMES: SegmentedOption<ThemeChoice>[] = [
  { value: 'dark', label: 'Oscuro' },
  { value: 'light', label: 'Claro' },
  { value: 'system', label: 'Sistema' },
]

const MOTION_LEVELS: SegmentedOption<MotionLevel>[] = [
  { value: 'full', label: 'Expresivo' },
  { value: 'subtle', label: 'Sutil' },
  { value: 'none', label: 'Ninguno' },
]

// D's labels: since Simulación and Colección have views and an action, the views go «with the action» (71.46).
const VIEWS_PLACES: SegmentedOption<ViewsPlace>[] = [
  { value: 'bottom', label: 'Abajo, con la acción' },
  { value: 'top', label: 'Arriba, en pestañas' },
]

/** One toast for a refused level: the arrows move and choose, so a walk across the group refuses twice in a row. */
const MOTION_REFUSED = 'motion-refused'

const FINE = 'text-xs text-muted-foreground'
const SETTING_TITLE = 'text-[17px] leading-[1.1] font-bold'

function Alerts() {
  const alerts = useAlerts()
  if (!alerts.data || alerts.data.length === 0) return null
  return (
    <section aria-label="Avisos" className="flex flex-col gap-2">
      {alerts.data.map((alert) => {
        const body = (
          <>
            <span className="font-medium">{alert.title}</span>
            <span className="text-xs text-muted-foreground">{alert.detail}</span>
          </>
        )
        const className = cn(
          'flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-sm',
          alert.level === 'warning' ? 'border-warning/60' : 'border-border',
        )
        return alert.link ? (
          <Link key={alert.code + alert.title} to={alert.link} className={cn(className, 'hover:bg-muted')}>
            {body}
          </Link>
        ) : (
          <div key={alert.code + alert.title} className={className}>
            {body}
          </div>
        )
      })}
    </section>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h2 className="px-1 text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

function LinkList({ title, entries }: { title: string; entries: Entry[] }) {
  return (
    <Block title={title}>
      <ul className="divide-y rounded-lg border">
        {entries.map((entry) => {
          const Icon = entry.icon
          return (
            <li key={entry.to}>
              <Link to={entry.to} className="flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-muted">
                <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{entry.label}</span>
                  <span className="block text-xs text-muted-foreground">{entry.hint}</span>
                </span>
                <ChevronRightIcon className="size-5 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          )
        })}
      </ul>
    </Block>
  )
}

/** One setting of «Aspecto»: its name, a fine line that says where it stands, and its control. */
function Setting({
  title,
  fine,
  children,
}: {
  title: string
  fine?: string
  /** The control, given the id of the fine line so a screen reader reads it with the group. */
  children: (fineId: string | undefined) => ReactNode
}) {
  const id = useId()
  return (
    <div className="grid gap-2 px-3.5 pt-3 pb-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2.5 gap-y-0.5">
        <h3 className={SETTING_TITLE}>{title}</h3>
        {fine ? (
          <span id={id} className={FINE}>
            {fine}
          </span>
        ) : null}
      </div>
      {children(fine ? id : undefined)}
    </div>
  )
}

/** The look of this device (`lib/look.ts`) and, next to it, the one preference of the kind the server keeps. */
function Look() {
  const look = useLook()
  const ui = useUiSettings()
  const setUi = useSetUiSettings()
  const viewsId = useId()

  async function toggleThumbnails(checked: boolean) {
    try {
      await setUi.update({ thumbnails: checked })
      toast.success(checked ? 'Miniaturas activadas' : 'Miniaturas desactivadas')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <Block title="Aspecto">
      <div className="divide-y rounded-lg border">
        <Setting
          title="Tema"
          fine={
            look.theme === 'system'
              ? `sigue al sistema: ahora ${look.resolved === 'light' ? 'claro' : 'oscuro'}`
              : 'oscuro por defecto'
          }
        >
          {(fineId) => (
            <SegmentedRadio
              label="Tema"
              describedBy={fineId}
              value={look.theme}
              options={THEMES}
              onChange={look.setTheme}
            />
          )}
        </Setting>
        <Setting
          title="Movimiento"
          fine={look.reducedBySystem ? 'tu sistema pide reducirlo: queda en Ninguno' : 'tres niveles'}
        >
          {(fineId) => (
            <SegmentedRadio
              label="Movimiento"
              describedBy={fineId}
              // What the page does now: «Ninguno» while the system asks to reduce motion, whatever is stored.
              value={look.resolvedMotion}
              options={MOTION_LEVELS.map((option) => ({
                ...option,
                unavailable: look.reducedBySystem && option.value !== 'none',
              }))}
              onChange={look.setMotion}
              // The stored choice is left alone: it comes back when the system stops asking.
              onRefused={() =>
                toast.info('Tu sistema pide reducir el movimiento: queda en «Ninguno».', { id: MOTION_REFUSED })
              }
            />
          )}
        </Setting>
        <Setting title="Dónde van las vistas">
          {() => (
            <>
              <SegmentedRadio
                label="Dónde van las vistas"
                describedBy={viewsId}
                value={look.views}
                options={VIEWS_PLACES}
                onChange={look.setViews}
              />
              <p id={viewsId} className={FINE}>
                Las de Cartas, Meta y Pruebas.{' '}
                {look.views === 'bottom'
                  ? 'Abajo: en la fila fija, arriba de la barra, junto a la acción cuando la pantalla tiene una.'
                  : 'Arriba: pestañas pegadas bajo el encabezado; la fila fija queda para la acción, con su texto.'}
              </p>
            </>
          )}
        </Setting>
        <Label className="flex min-h-14 items-center justify-between gap-3 px-3.5 py-3">
          <span>
            <span className={cn('block', SETTING_TITLE)}>Miniaturas de cartas</span>
            <span className="mt-1 block font-sans text-xs text-muted-foreground">
              Imágenes chicas del tracker en las listas. Se cargan después del texto y nunca lo frenan.
            </span>
          </span>
          <Switch checked={ui.thumbnails} onCheckedChange={toggleThumbnails} disabled={setUi.isPending} />
        </Label>
      </div>
      <p className={cn('px-1', FINE)}>
        El tema, el movimiento y las vistas se guardan en este dispositivo; las miniaturas, en el servidor.
      </p>
    </Block>
  )
}

export function MenuPage() {
  return (
    <div className="flex flex-col gap-4">
      <Alerts />
      <LinkList title="Otras pantallas" entries={OTHER_SCREENS} />
      <Look />
      <LinkList title="Ajustes y sistema" entries={SETTINGS_AND_SYSTEM} />
    </div>
  )
}
