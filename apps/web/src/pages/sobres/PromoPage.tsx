/**
 * Sobres de promoción (30/10/2026): which event battle to win. Each volume's battle can be won again and again and
 * every win gives one card of that volume; the page says, per volume, what the collection lacks, the chance that a
 * win brings something it lacks and the wins to finish it, and how to spend the event's coupons. Volumes with the
 * same chance tie: the API picks one at random on every call, so the page asks again each time it opens.
 */
import { useQuery } from '@tanstack/react-query'
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
  couponSavesNow: z.number().nullable(),
  inEvent: z.boolean(),
})
const promoSchema = z.object({
  event: z
    .object({ id: z.string(), nameEs: z.string(), from: z.string(), until: z.string(), volumes: z.array(z.string()) })
    .nullable(),
  volumes: z.array(volumeSchema),
  best: z.array(z.string()),
  pick: z.string().nullable(),
  totals: z.object({ volumes: z.number(), cards: z.number(), missing: z.number(), winsToComplete: z.number() }),
  lastImportAt: z.string().nullable(),
})

type PromoVolume = z.infer<typeof volumeSchema>

const DAY_MS = 24 * 60 * 60 * 1000

function usePromoPacks() {
  return useQuery({
    queryKey: ['promo-packs'] as const,
    queryFn: ({ signal }) => request('/api/promo-packs', { schema: promoSchema, signal }),
    // A new draw among the tied volumes every time the page opens.
    staleTime: 0,
    refetchOnMount: 'always',
  })
}

const label = (volume: { series: string; volume: number }) => `${volume.series} vol. ${volume.volume}`

/** «~11 victorias», «~5 victorias», «1 victoria». */
function wins(value: number): string {
  const shown = formatExpectedPacks(value)
  return value === 1 ? '1 victoria' : `~${shown} victorias`
}

/** «B vol. 1», «B vol. 1 y B vol. 3», «B vol. 1, 3, 4 y 11», «A vol. 7 y B vol. 1» (same series shortened). */
function joinVolumes(volumes: PromoVolume[]): string {
  const names = volumes.map((volume, i) =>
    i > 0 && volumes[i - 1]?.series === volume.series ? String(volume.volume) : label(volume),
  )
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}

/** «falta 1 de 5», «completo»; complete prints but a deck still lacks copies: «faltan copias para tus mazos». */
function volumeState(volume: PromoVolume): string {
  if (volume.missing > 0) return `${missing(volume.missing)} de ${volume.cards.length}`
  return volume.deckCards > 0 ? 'faltan copias para tus mazos' : 'completo'
}

/** Why the picked volume: what a win brings and what is in it for the decks and the collection. */
function pickReason(volume: PromoVolume): string {
  const chance =
    volume.chanceUseful === 1
      ? 'cada victoria te da seguro una carta que te falta'
      : `${formatChance(volume.chanceUseful * 100)} de que una victoria te dé una carta que te falta`
  const decks =
    volume.deckCards === 0
      ? ''
      : `; a tus mazos ${volume.deckCards === 1 ? 'les falta 1 carta' : `les faltan ${volume.deckCards} cartas`} de este volumen`
  const fresh =
    volume.newCards === 0
      ? ''
      : `; ${volume.newCards === 1 ? '1 carta no la tenés' : `${volume.newCards} cartas no las tenés`} en ninguna versión`
  return `${chance}${decks}${fresh}.`
}

function VolumeRow({ volume, mark }: { volume: PromoVolume; mark: 'pick' | 'tie' | null }) {
  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{label(volume)}</span>
        {mark === 'pick' ? <Badge>Conviene</Badge> : null}
        {mark === 'tie' ? <Badge variant="outline">Empata</Badge> : null}
        <span className="text-sm text-muted-foreground">{volumeState(volume)}</span>
        <span className="tabular ml-auto text-sm font-semibold">{formatChance(volume.chanceUseful * 100)}</span>
      </div>
      {volume.missing > 0 ? (
        <p className="text-xs text-muted-foreground">{wins(volume.winsToComplete)} para completarlo</p>
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

function VolumeList({
  volumes,
  pick,
  best,
}: {
  volumes: PromoVolume[]
  pick: string | null
  best: ReadonlySet<string>
}) {
  return (
    <ul className="divide-y rounded-lg border">
      {volumes.map((volume) => (
        <VolumeRow
          key={volume.id}
          volume={volume}
          mark={volume.id === pick ? 'pick' : best.has(volume.id) ? 'tie' : null}
        />
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
  const picked = data.volumes.find((volume) => volume.id === data.pick)
  const ties = data.volumes.filter((volume) => best.has(volume.id) && volume.id !== data.pick)
  const inEvent = data.event ? data.volumes.filter((volume) => volume.inEvent) : data.volumes
  const outside = data.event ? data.volumes.filter((volume) => !volume.inEvent) : []
  // A coupon saves the most on the last card a volume lacks: these can take one now.
  const lastCard = inEvent.filter((volume) => volume.missing === 1)
  const onlyCoupon = outside.filter((volume) => volume.missing > 0)
  const onlyCouponCards = onlyCoupon.reduce((sum, volume) => sum + volume.missing, 0)
  const daysLeft = data.event ? Math.ceil((Date.parse(data.event.until) - Date.now()) / DAY_MS) : null
  // `until` is the first minute after the event: the game says «hasta las 02:59».
  const lastMinute = data.event ? new Date(Date.parse(data.event.until) - 60_000).toISOString() : null

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
            Hasta el {formatDateTime(lastMinute)}
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
        {picked ? (
          <div className="flex flex-col gap-1 text-sm">
            <p>
              Conviene ganar <span className="font-semibold">{label(picked)}</span>: {pickReason(picked)}
            </p>
            {ties.length > 0 ? (
              <p>
                {ties.length === 1 ? 'Empata' : 'Empatan'} con la misma chance: {joinVolumes(ties)}. Te sugiero uno al
                azar cada vez que entrás.
              </p>
            ) : null}
            {data.totals.missing > 0 ? (
              <p className="text-muted-foreground">
                {data.event ? 'En el evento te ' : 'En los sobres de promoción te '}
                {missing(data.totals.missing, ['carta', 'cartas'])} de {data.totals.cards}:{' '}
                {wins(data.totals.winsToComplete)} para tenerlas todas sin cupones. Después de cada victoria volvé a
                mirar: el orden cambia.
              </p>
            ) : null}
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
          El porcentaje es la chance de que una victoria te dé una carta que te falta. «Nueva»: no la tenés en ninguna
          versión.
        </p>
        <VolumeList volumes={inEvent} pick={data.pick} best={best} />
      </Section>

      {data.totals.missing > 0 || onlyCoupon.length > 0 ? (
        <Fold title="Cupones" hint="dónde rinden más" remember="promo-coupons">
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              Las misiones del evento dan cupones que se canjean en la tienda por una carta de promoción. Un cupón rinde
              más en la última carta que le falta a un volumen: ahorra todas las victorias que llevaría sacarla (~5; ~7
              en A vol. 9). Gastado antes ahorra menos: con 5 faltantes, ~1. Así que ganá hasta que te falte 1 y canjeá
              esa.
            </p>
            {lastCard.length > 0 ? (
              <div className="flex flex-col gap-1">
                <h3 className="text-xs font-semibold text-muted-foreground">Ya podés canjear</h3>
                <ul className="divide-y rounded-lg border">
                  {lastCard.map((volume) => (
                    <li key={volume.id} className="px-3 py-2">
                      <span className="font-medium">{label(volume)}</span>
                      <span className="text-muted-foreground"> · </span>
                      {volume.cards.find((card) => card.missing)?.nameEs}
                      <span className="text-muted-foreground">
                        {' '}
                        · ahorra {wins(volume.couponSavesNow ?? volume.cards.length)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : data.totals.missing > 0 ? (
              <p>Por ahora ningún volumen del evento tiene 1 sola carta faltante: guardá los cupones.</p>
            ) : null}
            {onlyCoupon.length > 0 ? (
              <div className="flex flex-col gap-1">
                <p className="text-muted-foreground">
                  Sin batalla en este evento ({plural(onlyCouponCards, 'carta', 'cartas')}): solo con cupón, si la
                  tienda {onlyCouponCards === 1 ? 'la tiene' : 'las tiene'}.
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
          <VolumeList volumes={outside} pick={null} best={new Set()} />
        </Fold>
      ) : null}

      <section className="flex flex-col gap-1 text-xs text-muted-foreground">
        <h2 className="text-sm font-medium text-foreground">Supuestos</h2>
        <ul className="list-disc pl-5">
          <li>Un sobre de promoción trae 1 carta de su volumen. El juego no publica las tasas: se toman iguales.</li>
          <li>Victorias para completar: con m de n cartas faltantes, n · (1 + 1/2 + … + 1/m) en promedio.</li>
          <li>Cuenta cada edición: una promo que tenés en otra versión igual falta para la colección.</li>
          <li>Los volúmenes con la misma chance empatan; la sugerencia sale al azar entre ellos.</li>
        </ul>
      </section>
    </div>
  )
}
