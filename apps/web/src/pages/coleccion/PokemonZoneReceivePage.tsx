/**
 * pokemon-zone (2/11/2026): where the bookmarklet lands. The data came in the fragment, which `stashIncoming` (main.tsx)
 * moved to sessionStorage before anything else ran; here it is decompressed, the API says what saving would change,
 * and «Guardar» saves it. Until then nothing is written, and the data stays in this tab (a login in between keeps it).
 */
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { type PokemonZonePreview, usePokemonZonePreview, useSavePokemonZone } from '@/api/pokemonZone'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatDateTime, formatNumber, plural } from '@/lib/format'
import {
  clearStash,
  couponLine,
  decodeIncoming,
  gameRateText,
  HOURGLASSES_PER_PACK,
  readStash,
  stashIncoming,
} from '@/lib/pokemonZone'

const BACK = '/coleccion/pokemon-zone'

type Incoming = { status: 'none' } | { status: 'error'; message: string } | { status: 'ready'; payload: unknown }

function PreviewView({ preview }: { preview: PokemonZonePreview }) {
  const { packPoints, hourglasses } = preview
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        Datos del juego del <span className="font-medium">{formatDateTime(preview.syncedAt)}</span> (cuando pokemon-zone
        lo leyó).
      </p>
      {preview.account === 'other' ? (
        <Alert>
          <AlertTitle>Es de otra cuenta del juego</AlertTitle>
          <AlertDescription>
            La importación anterior es de otra cuenta: si guardás, los puntos y relojes de Sobres pasan a ser los de
            esta, y no se compara con la anterior.
          </AlertDescription>
        </Alert>
      ) : null}
      {preview.older ? (
        <Alert>
          <AlertTitle>Es más vieja que la última importación</AlertTitle>
          <AlertDescription>Se guarda en el historial, pero no cambia los ajustes de Sobres.</AlertDescription>
        </Alert>
      ) : null}
      {preview.duplicate ? (
        <p className="text-sm text-muted-foreground">
          Ya la importaste: guardarla otra vez solo vuelve a poner sus puntos y relojes en Sobres.
        </p>
      ) : null}
      {preview.since ? (
        <p className="text-sm">
          Desde la importación del {formatDateTime(preview.since.from.syncedAt)} abriste{' '}
          <span className="font-medium">{plural(preview.since.packs, 'sobre', 'sobres')}</span> y obtuviste{' '}
          {plural(preview.since.cards, 'carta', 'cartas')}.
        </p>
      ) : null}

      <Section title="Sobres → Ajustes">
        {preview.older ? (
          <p className="text-sm text-muted-foreground">No cambia nada.</p>
        ) : (
          <>
            {packPoints.changes.length === 0 ? (
              <p className="text-sm">Los puntos de sobre ya son los del juego.</p>
            ) : (
              <div className="flex flex-col gap-1">
                <p className="text-sm">
                  Puntos de sobre: cambian {plural(packPoints.changes.length, 'expansión', 'expansiones')}
                  {packPoints.unchanged > 0 ? ` (${formatNumber(packPoints.unchanged)} quedan igual)` : ''}.
                </p>
                <ul className="divide-y rounded-lg border text-sm">
                  {packPoints.changes.map((change) => (
                    <li key={change.expansionId} className="flex flex-wrap justify-between gap-x-3 px-3 py-1.5">
                      <span className="min-w-0">
                        {change.nameEs ?? change.expansionId}{' '}
                        <span className="text-muted-foreground">· {change.expansionId}</span>
                      </span>
                      <span className="tabular">
                        {formatNumber(change.before)} → {formatNumber(change.after)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {hourglasses ? (
              <p className="text-sm">
                Relojes de arena de sobre: {formatNumber(hourglasses.before)} → {formatNumber(hourglasses.after)} (
                {plural(Math.floor(hourglasses.after / HOURGLASSES_PER_PACK), 'sobre', 'sobres')}).
              </p>
            ) : null}
          </>
        )}
      </Section>

      {preview.coupons.length > 0 ? (
        <Section title="Cupones de carta de promoción">
          <ul className="flex flex-col gap-0.5 text-sm">
            {preview.coupons.map((coupon) => (
              <li key={coupon.key}>{couponLine(coupon)}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Partidas según el juego">
        <ul className="flex flex-col gap-1 text-sm">
          <li>Competitivas: {gameRateText(preview.battles.ranked)}</li>
          <li>Versus (contra personas): {gameRateText(preview.battles.versus)}</li>
          <li>Solo (contra la CPU): {gameRateText(preview.battles.solo)}</li>
        </ul>
        <p className="text-xs text-muted-foreground">
          De por vida, como las cuenta el juego. Se muestran al lado de tus partidas registradas, nunca sumadas.
        </p>
      </Section>
    </div>
  )
}

export function PokemonZoneReceivePage() {
  const navigate = useNavigate()
  const preview = usePokemonZonePreview()
  const save = useSavePokemonZone()
  const [incoming, setIncoming] = useState<Incoming | null>(null)
  const started = useRef(false)
  const askPreview = preview.mutate

  useEffect(() => {
    if (started.current) return
    started.current = true
    // main.tsx already moved the fragment; this covers an in-app navigation that kept one.
    stashIncoming()
    const data = readStash()
    if (!data) {
      setIncoming({ status: 'none' })
      return
    }
    decodeIncoming(data)
      .then((payload) => {
        setIncoming({ status: 'ready', payload })
        askPreview(payload)
      })
      .catch((error: unknown) => setIncoming({ status: 'error', message: errorMessage(error) }))
  }, [askPreview])

  function discard() {
    clearStash()
    navigate(BACK, { replace: true })
  }

  async function store(payload: unknown) {
    try {
      const saved = await save.mutateAsync(payload)
      clearStash()
      toast.success(
        saved.duplicate
          ? 'Ya estaba importada: los ajustes de Sobres quedaron como en el juego.'
          : saved.applied
            ? 'Importado de pokemon-zone.'
            : 'Importado de pokemon-zone, sin cambiar los ajustes de Sobres.',
      )
      navigate(BACK, { replace: true })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  if (incoming === null) return <LoadingRows rows={4} />
  if (incoming.status === 'none') {
    return (
      <EmptyState
        title="No llegaron datos"
        description="Esta página recibe lo que manda el marcador desde pokemon-zone.com."
        action={
          <Button asChild variant="outline">
            <Link to={BACK}>Cómo usar el marcador</Link>
          </Button>
        }
      />
    )
  }
  if (incoming.status === 'error') {
    return (
      <div className="flex flex-col gap-3">
        <ErrorState error={new Error(incoming.message)} />
        <Button variant="outline" onClick={discard} className="self-start">
          Descartar
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {preview.isPending ? <LoadingRows rows={5} /> : null}
      {preview.isError ? <ErrorState error={preview.error} onRetry={() => preview.mutate(incoming.payload)} /> : null}
      {preview.data ? <PreviewView preview={preview.data} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void store(incoming.payload)} disabled={!preview.data || save.isPending}>
          {save.isPending ? 'Guardando…' : 'Guardar'}
        </Button>
        <Button variant="outline" onClick={discard} disabled={save.isPending}>
          Descartar
        </Button>
      </div>
    </div>
  )
}
