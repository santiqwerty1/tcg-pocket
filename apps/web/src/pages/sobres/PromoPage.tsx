/**
 * Sobres de promoción (30/10/2026): which event battle to win. Each volume's battle can be won again and again and
 * every win gives one card of that volume; the page says, per volume, what the collection lacks, the chances that a
 * win brings it and the wins to finish it, and how to spend the event's coupons. Santi's order: a card a deck lacks,
 * then a card not owned in any print, then any missing print; the API picks one of the volumes still tied at random
 * on every call, so the page asks again each time it opens. Without an event there is no battle: only what is missing.
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
  inCatalog: z.boolean(),
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
  chanceNew: z.number(),
  chanceDecks: z.number(),
  chanceUseful: z.number(),
  newCards: z.number(),
  deckCards: z.number(),
  reason: z.enum(['decks', 'new', 'missing']).nullable(),
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
type PromoCard = z.infer<typeof cardSchema>

const DAY_MS = 24 * 60 * 60 * 1000

function usePromoPacks() {
  return useQuery({
    queryKey: ['promo-packs'] as const,
    queryFn: ({ signal }) => request('/api/promo-packs', { schema: promoSchema, signal }),
    // A new draw among the tied volumes every time the page opens, but not on coming back from the game: the
    // suggestion would change while the collection is the same.
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  })
}

const label = (volume: { series: string; volume: number }) => `${volume.series} vol. ${volume.volume}`

/** «~11 victorias», «~5 victorias», «1 victoria». */
function wins(value: number): string {
  const shown = formatExpectedPacks(value)
  return value === 1 ? '1 victoria' : `~${shown} victorias`
}

const percent = (chance: number) => formatChance(chance * 100)

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

/** Why the picked volume wins, by the first of Santi's tiers where it has something. */
function pickReason(volume: PromoVolume): string {
  if (volume.reason === 'decks') {
    const cards = volume.cards.filter((card) => card.decks.length > 0).map((card) => card.nameEs)
    return `es la que más chance tiene de darte una carta que le falta a tus mazos (${percent(volume.chanceDecks)}: ${cards.join(', ')}).`
  }
  if (volume.reason === 'new') {
    return `es la que más chance tiene de darte una carta que no tenés en ninguna versión (${percent(volume.chanceNew)}).`
  }
  return `es la que más chance tiene de darte una edición que te falta (${percent(volume.chanceMissing)}).`
}

function CardName({ card }: { card: PromoCard }) {
  const name = card.missing ? <span className="font-medium">{card.nameEs}</span> : `✓ ${card.nameEs}`
  if (!card.inCatalog) return <span>{card.cardId} (todavía no está en el catálogo)</span>
  return (
    <Link to={`/cartas/${encodeURIComponent(card.cardId)}`} className="hover:underline">
      {name}
    </Link>
  )
}

/**
 * The chance of each tier, labelled; the one that decides the order (`reason`) is the row's headline, so a volume
 * that ranks first on a deck's card (20 %) does not look below one with 100 % of missing prints.
 */
const TIERS = [
  { reason: 'decks', short: 'para mazos', long: 'para tus mazos', chance: (v: PromoVolume) => v.chanceDecks },
  { reason: 'new', short: 'nueva', long: 'nueva en ninguna versión', chance: (v: PromoVolume) => v.chanceNew },
  { reason: 'missing', short: 'edición', long: 'edición que falta', chance: (v: PromoVolume) => v.chanceMissing },
] as const

function VolumeRow({ volume, mark }: { volume: PromoVolume; mark: 'pick' | 'tie' | null }) {
  const headline = TIERS.find((tier) => tier.reason === volume.reason)
  const details = [
    ...TIERS.filter((tier) => tier !== headline && tier.chance(volume) > 0).map(
      (tier) => `${tier.long}: ${percent(tier.chance(volume))}`,
    ),
    // Wins only where there is a battle now.
    volume.missing > 0 && volume.inEvent ? `${wins(volume.winsToComplete)} para completarlo` : null,
  ].filter((item): item is string => item !== null)
  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{label(volume)}</span>
        {mark === 'pick' ? <Badge>Conviene</Badge> : null}
        {mark === 'tie' ? <Badge variant="outline">Empata</Badge> : null}
        <span className="text-sm text-muted-foreground">{volumeState(volume)}</span>
        <span className="ml-auto text-sm">
          <span className="tabular font-semibold">{headline ? percent(headline.chance(volume)) : percent(0)}</span>
          {headline ? <span className="text-xs text-muted-foreground"> {headline.short}</span> : null}
        </span>
      </div>
      {details.length > 0 ? <p className="text-xs text-muted-foreground">{details.join(' · ')}</p> : null}
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
        {volume.cards.map((card) => (
          <li key={card.cardId} className={cn(!card.missing && card.decks.length === 0 && 'text-muted-foreground')}>
            <CardName card={card} />
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

/** The event's coupons: for a card a deck lacks, for the last card of a volume, and the cards with no battle. */
function Coupons({ inEvent, outside }: { inEvent: PromoVolume[]; outside: PromoVolume[] }) {
  const forDecks = inEvent.flatMap((volume) =>
    volume.cards.filter((card) => card.decks.length > 0).map((card) => ({ volume, card })),
  )
  const lastCard = inEvent.filter((volume) => volume.missing === 1)
  const onlyCoupon = outside.filter((volume) => volume.missing > 0)
  const onlyCouponCards = onlyCoupon.reduce((sum, volume) => sum + volume.missing, 0)
  const anyMissing = inEvent.some((volume) => volume.missing > 0)
  if (!anyMissing && forDecks.length === 0 && onlyCoupon.length === 0) return null
  return (
    <Fold title="Cupones" hint="dónde rinden más" remember="promo-coupons">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          Las misiones del evento dan cupones que se canjean en la tienda por una carta de promoción, si la tienda la
          tiene. Para una carta puntual, como la de un mazo, un cupón ahorra todas las victorias que llevaría sacarla
          (~5; ~7 en A vol. 9). Si vas a completar un volumen, rinde más en su última carta; gastado antes ahorra menos
          (con 5 faltantes, ~1). Antes de que termine el evento, canjealos igual.
        </p>
        {forDecks.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold text-muted-foreground">Para tus mazos</h3>
            <ul className="divide-y rounded-lg border">
              {forDecks.map(({ volume, card }) => (
                <li key={card.cardId} className="px-3 py-2">
                  <span className="font-medium">{card.nameEs}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    · {label(volume)} · para {card.decks.join(', ')} · ahorra {wins(volume.cards.length)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {lastCard.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold text-muted-foreground">Última carta de un volumen</h3>
            <ul className="divide-y rounded-lg border">
              {lastCard.map((volume) => (
                <li key={volume.id} className="px-3 py-2">
                  <span className="font-medium">{label(volume)}</span>
                  <span className="text-muted-foreground"> · </span>
                  {volume.cards.find((card) => card.missing)?.nameEs}
                  <span className="text-muted-foreground"> · ahorra {wins(volume.cards.length)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : anyMissing ? (
          <p>A ningún volumen del evento le falta 1 sola carta todavía.</p>
        ) : null}
        {onlyCoupon.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground">
              Sin batalla en este evento ({plural(onlyCouponCards, 'carta', 'cartas')}): solo con cupón, si la tienda{' '}
              {onlyCouponCards === 1 ? 'la tiene' : 'las tiene'}.
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
  const daysLeft = data.event ? Math.ceil((Date.parse(data.event.until) - Date.now()) / DAY_MS) : null
  // `until` is the first minute after the event: the game says «hasta las 02:59».
  const lastMinute = data.event ? new Date(Date.parse(data.event.until) - 60_000).toISOString() : null
  const noCollection = data.lastImportAt === null

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
          No hay un evento de sobres de promoción en curso, así que no hay batallas para ganar. Abajo, qué te falta de
          cada volumen.
        </p>
      )}

      {noCollection ? (
        <EmptyState
          title="Todavía no hay una colección importada"
          description="Importala en Colección para ver qué cartas de promoción te faltan."
        />
      ) : data.event ? (
        <Section title="Qué batalla ganar">
          {picked ? (
            <div className="flex flex-col gap-1 text-sm">
              <p>
                Conviene ganar <span className="font-semibold">{label(picked)}</span>: {pickReason(picked)}
              </p>
              {ties.length > 0 ? (
                <p>
                  {ties.length === 1 ? 'Empata' : 'Empatan'} en todo: {joinVolumes(ties)}. Te sugiero uno al azar cada
                  vez que entrás.
                </p>
              ) : null}
              {data.totals.missing > 0 ? (
                <p className="text-muted-foreground">
                  En el evento te {missing(data.totals.missing, ['carta', 'cartas'])} de {data.totals.cards}:{' '}
                  {wins(data.totals.winsToComplete)} para tenerlas todas sin cupones. Después de cada victoria,
                  sincronizá la colección y volvé a mirar: el orden cambia.
                </p>
              ) : null}
            </div>
          ) : (
            <EmptyState title="Ya tenés todo lo del evento" description="Ninguna victoria te daría una carta nueva." />
          )}
        </Section>
      ) : data.totals.missing > 0 ? (
        <p className="text-sm text-muted-foreground">
          De los sobres de promoción te {missing(data.totals.missing, ['carta', 'cartas'])} de {data.totals.cards}.
        </p>
      ) : (
        <EmptyState title="Ya tenés todas las promos de los sobres" description="No te falta ninguna edición." />
      )}

      {data.lastImportAt ? (
        <p className="text-xs text-muted-foreground">
          {/* «p. m.» already ends with a period: the date goes before a colon. */}
          Colección del {formatDateTime(data.lastImportAt)}: si abriste sobres de promoción después,{' '}
          <Link to="/coleccion" className="underline">
            actualizala
          </Link>
          .
        </p>
      ) : (
        <Link to="/coleccion" className="text-sm underline">
          Ir a Colección
        </Link>
      )}

      <Section title={data.event ? 'Volúmenes del evento' : 'Volúmenes'}>
        <p className="text-xs text-muted-foreground">
          El porcentaje es la chance, por victoria, de lo que decide el orden: una carta para tus mazos («para mazos»)
          si el volumen tiene alguna; si no, una que no tenés en ninguna versión («nueva»); si no, una edición que te
          falta («edición»). Abajo de cada volumen, las otras chances.
        </p>
        <VolumeList volumes={inEvent} pick={data.pick} best={best} />
      </Section>

      {data.event && !noCollection ? <Coupons inEvent={inEvent} outside={outside} /> : null}

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
          <li>
            Orden (tuyo, del 30/10): cartas para tus mazos, después cartas que no tenés en ninguna versión, después
            cualquier edición; entre los que empatan en todo, la sugerencia sale al azar.
          </li>
        </ul>
      </section>
    </div>
  )
}
