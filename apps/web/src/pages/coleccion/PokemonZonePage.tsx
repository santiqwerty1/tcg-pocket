/**
 * pokemon-zone (2/11/2026): how to bring the game's data from pokemon-zone.com with a bookmarklet, and the latest
 * import. React does not render `javascript:` links, so the page shows the code to copy and how to make the bookmark
 * on a PC and on Android (where a bookmarklet runs by typing its name in the address bar).
 */
import { CopyIcon, InboxIcon } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { type PokemonZoneSummary, usePokemonZone } from '@/api/pokemonZone'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { KeyValue, Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { formatDateTime, formatNumber, plural } from '@/lib/format'
import { bookmarkletCode, couponLine, HOURGLASSES_PER_PACK, RECEIVE_PATH, readStash } from '@/lib/pokemonZone'

const count = (value: number | null) => (value === null ? '—' : formatNumber(value))

function Latest({ data }: { data: PokemonZoneSummary }) {
  const latest = data.latest
  if (!latest) {
    return (
      <EmptyState title="Todavía no importaste nada" description="Con el marcador de arriba, desde pokemon-zone.com." />
    )
  }
  const pack = latest.hourglasses.pack
  return (
    <div className="flex flex-col gap-3">
      {/* «p. m.» already ends with a period: the dates go inside parentheses, never right before one. */}
      <p className="text-sm text-muted-foreground">
        Datos del juego del {formatDateTime(latest.syncedAt)} (cuando pokemon-zone lo leyó; importados el{' '}
        {formatDateTime(latest.importedAt)}). {plural(data.imports, 'importación guardada', 'importaciones guardadas')}.
      </p>
      <KeyValue
        items={[
          { label: 'Nivel', value: count(latest.level) },
          {
            label: 'Relojes de arena de sobre',
            value:
              pack === null
                ? '—'
                : `${formatNumber(pack)} (${plural(Math.floor(pack / HOURGLASSES_PER_PACK), 'sobre', 'sobres')})`,
          },
          { label: 'Relojes de arena maravilla', value: count(latest.hourglasses.wonder) },
          { label: 'Relojes de arena de intercambio', value: count(latest.hourglasses.trade) },
          { label: 'Tickets de tienda', value: count(latest.currencies.shopTickets) },
          { label: 'Polvo brillante', value: count(latest.currencies.shinedust) },
          { label: 'Tickets prémium', value: count(latest.currencies.premiumTickets) },
          { label: 'Sobres abiertos', value: count(latest.totals.packsOpened) },
          { label: 'Cartas obtenidas', value: count(latest.totals.cardsObtained) },
        ]}
      />
      {latest.coupons.length > 0 ? (
        <div className="flex flex-col gap-1 text-sm">
          <h3 className="text-xs font-semibold text-muted-foreground">Cupones de carta de promoción</h3>
          <ul className="flex flex-col gap-0.5">
            {latest.coupons.map((coupon) => (
              <li key={coupon.key}>{couponLine(coupon)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-sm">
        Se usan en{' '}
        <Link to="/sobres" className="underline">
          Sobres
        </Link>{' '}
        (puntos de sobre y relojes, en Ajustes), en{' '}
        <Link to="/sobres/promo" className="underline">
          Sobres de promoción
        </Link>{' '}
        (cupones), en{' '}
        <Link to="/partidas/estadisticas" className="underline">
          Estadísticas de partidas
        </Link>{' '}
        y en la suerte de los sobres de{' '}
        <Link to="/coleccion" className="underline">
          Colección
        </Link>
        .
      </p>
    </div>
  )
}

/** What Chrome strips from a pasted bookmark address (pz/luck): typed by hand. */
const PREFIX = 'javascript:'

export function PokemonZonePage() {
  const summary = usePokemonZone()
  const code = useMemo(() => bookmarkletCode(window.location.origin), [])
  const withoutPrefix = code.startsWith(PREFIX) ? code.slice(PREFIX.length) : code
  const pending = readStash() !== null

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(done)
    } catch {
      toast.error('No se pudo copiar; seleccionalo a mano.')
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        pokemon-zone.com lee tu cuenta del juego una vez por día. Con este marcador traés de ahí, desde tu navegador,
        los puntos de sobre, los relojes de arena, los cupones de promoción, tus partidas según el juego y los sobres
        que abriste. No trae tu colección ni tus mazos, y tu friend id no sale de pokemon-zone (solo una huella).
      </p>

      {pending ? (
        <Link
          to={RECEIVE_PATH}
          className="flex items-center gap-2 rounded-lg border border-warning/60 px-3 py-2 text-sm hover:bg-muted"
        >
          <InboxIcon className="size-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-medium">Tenés datos recibidos sin guardar.</span>{' '}
            <span className="text-muted-foreground">Revisalos y guardalos.</span>
          </span>
        </Link>
      ) : null}

      <Section title="El marcador">
        <code
          data-testid="bookmarklet"
          className="block max-h-32 overflow-y-auto rounded-lg bg-muted p-3 text-xs break-all select-all"
        >
          {code}
        </code>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => copy(withoutPrefix, 'Código copiado, sin «javascript:»')}
            data-testid="copy-without-prefix"
          >
            <CopyIcon />
            Copiar sin «javascript:»
          </Button>
          <Button variant="outline" onClick={() => copy(code, 'Código del marcador copiado')}>
            <CopyIcon />
            Copiar todo
          </Button>
        </div>
        {/* pz/luck: Chrome strips the leading «javascript:» of what is pasted in the URL field (Santi, 3/11). */}
        <p className="rounded-lg border border-warning/60 px-3 py-2 text-sm" data-testid="javascript-warning">
          Chrome borra el «javascript:» al pegar: escribilo a mano al principio del campo URL y pegá el resto con
          «Copiar sin "javascript:"». Si el campo empieza con «void(», falta: sin eso «Guardar» queda deshabilitado.
        </p>
        <div className="flex flex-col gap-1 text-sm">
          <h3 className="font-medium">En la PC</h3>
          <ol className="list-decimal pl-5">
            <li>Tocá «Copiar sin "javascript:"».</li>
            <li>
              Creá un marcador nuevo (en el administrador de marcadores, «Agregar página») y llamalo «TCG Pocket». En el
              campo URL escribí a mano <code className="rounded bg-muted px-1">{PREFIX}</code> y pegá el código justo
              después.
            </li>
            <li>Abrí pokemon-zone.com con tu sesión iniciada y tocá el marcador.</li>
          </ol>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <h3 className="font-medium">En el celu (Chrome para Android)</h3>
          <ol className="list-decimal pl-5">
            <li>Tocá «Copiar sin "javascript:"».</li>
            <li>
              Guardá esta página como favorito (⋮ → estrella) y editalo: nombre «TCG Pocket»; en la dirección, borrá la
              que tiene, escribí a mano <code className="rounded bg-muted px-1">{PREFIX}</code> y pegá el código justo
              después.
            </li>
            <li>
              En pokemon-zone.com, con tu sesión iniciada, escribí «TCG Pocket» en la barra de direcciones y tocá el
              favorito que aparece (el que empieza con «javascript:»).
            </li>
          </ol>
        </div>
        <p className="text-xs text-muted-foreground">
          Si ya tenías el marcador, reemplazalo por este: desde el 3/11 también trae los cupones de sobre con carta
          asegurada, para que la suerte no cuente esa carta.
        </p>
        <p className="text-xs text-muted-foreground">
          El marcador abre esta app con los datos y te muestra qué cambia antes de guardar. Tenés que tener la sesión de
          la app iniciada en ese navegador; si te pide iniciarla, iniciala y tocá el marcador otra vez.
        </p>
      </Section>

      <Section title="Última importación">
        {summary.isPending ? <LoadingRows rows={4} /> : null}
        {summary.isError ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : null}
        {summary.data ? <Latest data={summary.data} /> : null}
      </Section>
    </div>
  )
}
