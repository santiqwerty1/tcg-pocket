/**
 * Sobres de promoción (30/10/2026): which event battle to win. Each volume's battle can be won again and again and
 * every win gives one card of that volume; the page says, per volume, what the collection lacks, the chance that a
 * win brings something new and the wins to finish it, and where the event's coupons save the most wins.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { z } from 'zod'
import { request } from '@/api/client'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { Fold, Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { formatDateTime, missing, plural } from '@/lib/format'
import { formatChance, formatExpectedPacks } from '@/lib/packs'
import { cn } from '@/lib/utils'

const cardSchema = z.object({
  cardId: z.string(),
  groupId: z.string(),
  nameEs: z.string(),
  owned: z.number(),
  missing: z.boolean(),
  newCard: z.boolean(),
  decks: z.array(z.string()),
})
const volumeSchema = z.object({
  id: z.string(),
  series: z.string(),
  volume: z.number(),
  cards: z.array(cardSchema),
  missing: z.number(),
  chanceMissing: z.number(),
  chanceUseful: z.number(),
  newCards: z.number(),
  deckCards: z.number(),
  winsToComplete: z.number(),
  winsPerCoupon: z.number().nullable(),
  inEvent: z.boolean(),
})
const promoSchema = z.object({
  event: z
    .object({ id: z.string(), nameEs: z.string(), from: z.string(), until: z.string(), volumes: z.array(z.string()) })
    .nullable(),
  volumes: z.array(volumeSchema),
  best: z.array(z.string()),
  totals: z.object({ volumes: z.number(), cards: z.number(), missing: z.number(), winsToComplete: z.number() }),
  lastImportAt: z.string().nullable(),
})

type PromoVolume = z.infer<typeof volumeSchema>

const DAY_MS = 24 * 60 * 60 * 1000

function usePromoPacks() {
  return useQuery({
    queryKey: ['promo-packs'] as const,
    queryFn: ({ signal }) => request('/api/promo-packs', { schema: promoSchema, signal }),
    placeholderData: keepPreviousData,
  })
}

const label = (volume: { series: string; volume: number }) => `${volume.series} vol. ${volume.volume}`

/** «~11 victorias», «~5 victorias», «1 victoria». */
function wins(value: number): string {
  const shown = formatExpectedPacks(value)
  return value === 1 ? '1 victoria' : `~${shown} victorias`
}

/** «B vol. 1», «B vol. 1 y B vol. 3», «B vol. 1, 3, 4 u 11» (same series shortened). */
function joinVolumes(volumes: PromoVolume[]): string {
  const names = volumes.map((volume, i) =>
    i > 0 && volumes[i - 1]?.series === volume.series ? String(volume.volume) : label(volume),
  )
  if (names.length <= 1) return names.join('')
  const last = volumes[volumes.length - 1]?.volume
  // «o» becomes «u» before a word that starts with «o»: «ocho», «once».
  const or = last === 8 || last === 11 ? 'u' : 'o'
  return `${names.slice(0, -1).join(', ')} ${or} ${names[names.length - 1]}`
}

function VolumeRow({ volume, best }: { volume: PromoVolume; best: boolean }) {
  const size = volume.cards.length
  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{label(volume)}</span>
        {best ? <Badge>Conviene</Badge> : null}
        <span className="text-sm text-muted-foreground">
          {volume.missing === 0 ? 'completo' : `${missing(volume.missing)} de ${size}`}
        </span>
        <span className="tabular ml-auto text-sm font-semibold">{formatChance(volume.chanceUseful * 100)}</span>
      </div>
      {volume.missing > 0 ? (
        <p className="text-xs text-muted-foreground">
          {wins(volume.winsToComplete)} para completarlo
          {volume.winsPerCoupon !== null ? ` · cada cupón ahorra ${wins(volume.winsPerCoupon)}` : ''}
        </p>
      ) : null}
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
        {volume.cards.map((card) => (
          <li key={card.cardId} className={cn(!card.missing && card.decks.length === 0 && 'text-muted-foreground')}>
            <Link to={`/cartas/${encodeURIComponent(card.cardId)}`} className="hover:underline">
              {card.missing ? <span className="font-medium">{card.nameEs}</span> : `✓ ${card.nameEs}`}
            </Link>
            {card.newCard ? <span className="text-xs text-success"> nueva</span> : null}
            {card.decks.length > 0 ? (
              <span className="text-xs text-warning"> · falta en {card.decks.join(', ')}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </li>
  )
}

function VolumeList({ volumes, best }: { volumes: PromoVolume[]; best: ReadonlySet<string> }) {
  return (
    <ul className="divide-y rounded-lg border">
      {volumes.map((volume) => (
        <VolumeRow key={volume.id} volume={volume} best={best.has(volume.id)} />
      ))}
    </ul>
  )
}

export function PromoPage() {
  const promo = usePromoPacks()
  if (promo.isPending) return <LoadingRows rows={6} />
  if (promo.isError) return <ErrorState error={promo.error} onRetry={() => promo.refetch()} />
  const data = promo.data
  const best = new Set(data.best)
  const bestVolumes = data.volumes.filter((volume) => best.has(volume.id))
  const top = bestVolumes[0]
  const inEvent = data.event ? data.volumes.filter((volume) => volume.inEvent) : data.volumes
  const outside = data.event ? data.volumes.filter((volume) => !volume.inEvent) : []
  const couponVolumes = inEvent
    .filter((volume) => volume.winsPerCoupon !== null)
    .sort((a, b) => (b.winsPerCoupon ?? 0) - (a.winsPerCoupon ?? 0))
  const onlyCoupon = outside.filter((volume) => volume.missing > 0)
  const onlyCouponCards = onlyCoupon.reduce((sum, volume) => sum + volume.missing, 0)
  const daysLeft = data.event ? Math.ceil((Date.parse(data.event.until) - Date.now()) / DAY_MS) : null

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Cada victoria en la batalla de un volumen da un sobre de promoción con 1 de sus cartas. La batalla se puede
        ganar todas las veces que quieras.
      </p>

      {data.event ? (
        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{data.event.nameEs}</span>
          <span className="block text-muted-foreground">
            Hasta el {formatDateTime(data.event.until)}
            {daysLeft !== null && daysLeft > 0
              ? ` · ${daysLeft === 1 ? 'queda 1 día' : `quedan ${daysLeft} días`}`
              : ''}
          </span>
        </div>
      ) : (
        <p className="text-sm">
          No hay un evento de sobres de promoción en curso. Abajo, dónde rendiría más una victoria cuando vuelva.
        </p>
      )}

      <Section title="Qué batalla ganar">
        {top ? (
          <div className="flex flex-col gap-1 text-sm">
            <p>
              Conviene ganar <span className="font-semibold">{joinVolumes(bestVolumes)}</span>:{' '}
              {top.chanceUseful === 1
                ? 'cada victoria te da seguro una carta que no tenés'
                : `${formatChance(top.chanceUseful * 100)} de que una victoria te dé algo que no tenés`}
              {top.deckCards > 0
                ? `; ${top.deckCards === 1 ? '1 carta le falta' : `${top.deckCards} cartas les faltan`} a tus mazos`
                : ''}
              {top.newCards > 0
                ? `; ${top.newCards === 1 ? '1 carta no la tenés' : `${top.newCards} cartas no las tenés`} en ninguna versión`
                : ''}
              .
            </p>
            <p className="text-muted-foreground">
              {data.event ? 'En el evento te ' : 'En los sobres de promoción te '}
              {missing(data.totals.missing, ['carta', 'cartas'])} de {data.totals.cards}:{' '}
              {wins(data.totals.winsToComplete)} para tenerlas todas sin cupones. Después de cada victoria volvé a
              mirar: el orden cambia.
            </p>
          </div>
        ) : (
          <EmptyState
            title={data.event ? 'Ya tenés todo lo del evento' : 'Ya tenés todas las promos de los sobres'}
            description="Ninguna victoria te daría una carta nueva."
          />
        )}
        <p className="text-xs text-muted-foreground">
          {/* «p. m.» already ends with a period: the date goes before a colon. */}
          {data.lastImportAt ? `Colección del ${formatDateTime(data.lastImportAt)}: si` : 'Si'} abriste sobres de
          promoción después,{' '}
          <Link to="/coleccion" className="underline">
            actualizala
          </Link>
          .
        </p>
      </Section>

      <Section title={data.event ? 'Volúmenes del evento' : 'Volúmenes'}>
        <p className="text-xs text-muted-foreground">
          El porcentaje es la chance de que una victoria te dé algo que no tenés. «Nueva»: no la tenés en ninguna
          versión.
        </p>
        <VolumeList volumes={inEvent} best={best} />
      </Section>

      {couponVolumes.length > 0 || onlyCoupon.length > 0 ? (
        <Fold title="Cupones" hint="dónde rinden más" remember="promo-coupons">
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              Las misiones del evento dan cupones que se canjean en la tienda por una carta de promoción. Rinden más
              donde te faltan pocas cartas: cada cupón ahorra las victorias que llevaría sacarla.
            </p>
            {couponVolumes.length > 0 ? (
              <ol className="divide-y rounded-lg border">
                {couponVolumes.map((volume) => (
                  <li key={volume.id} className="px-3 py-2">
                    <span className="font-medium">{label(volume)}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      · cada cupón ahorra {wins(volume.winsPerCoupon ?? 0)}:{' '}
                    </span>
                    {volume.cards
                      .filter((card) => card.missing)
                      .map((card) => card.nameEs)
                      .join(', ')}
                  </li>
                ))}
              </ol>
            ) : null}
            {onlyCoupon.length > 0 ? (
              <div className="flex flex-col gap-1">
                <p className="text-muted-foreground">
                  Sin batalla en este evento ({plural(onlyCouponCards, 'carta', 'cartas')}): solo con cupón, si la
                  tienda la tiene.
                </p>
                <ul className="text-xs">
                  {onlyCoupon.map((volume) => (
                    <li key={volume.id}>
                      <span className="font-medium">{label(volume)}</span>
                      <span className="text-muted-foreground"> · </span>
                      {volume.cards
                        .filter((card) => card.missing)
                        .map((card) => card.nameEs)
                        .join(', ')}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Fold>
      ) : null}

      {outside.length > 0 ? (
        <Fold title="Otros volúmenes" hint="sin batalla ahora" remember="promo-outside">
          <VolumeList volumes={outside} best={best} />
        </Fold>
      ) : null}

      <section className="flex flex-col gap-1 text-xs text-muted-foreground">
        <h2 className="text-sm font-medium text-foreground">Supuestos</h2>
        <ul className="list-disc pl-5">
          <li>Un sobre de promoción trae 1 carta de su volumen. El juego no publica las tasas: se toman iguales.</li>
          <li>Victorias para completar: con m de n cartas faltantes, n · (1 + 1/2 + … + 1/m) en promedio.</li>
          <li>Cuenta cada edición: una promo que tenés en otra versión igual falta para la colección.</li>
        </ul>
      </section>
    </div>
  )
}
