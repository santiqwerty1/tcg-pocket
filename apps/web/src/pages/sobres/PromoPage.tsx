/**
 * Sobres de promoción (30/10/2026): which event battle to win. Each volume's battle can be won again and again and
 * every win gives one card of that volume; the page says, per volume, what the collection lacks for the goal (2
 * copies of each print since 2/11), the chances that a win brings it and the wins to finish it, and how to spend the
 * event's coupons. Santi's order: a card a deck lacks, then a card not owned in any print, then a print below the
 * goal; the API picks one of the volumes still tied at random on every call, so the page asks again each time it
 * opens. Without an event there is no battle: only what is missing.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { z } from 'zod'
import { request } from '@/api/client'
import { promoCouponSchema } from '@/api/pokemonZone'
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
  needed: z.number(),
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
  copiesMissing: z.number(),
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
  goal: z.number(),
  event: z
    .object({ id: z.string(), nameEs: z.string(), from: z.string(), until: z.string(), volumes: z.array(z.string()) })
    .nullable(),
  volumes: z.array(volumeSchema),
  best: z.array(z.string()),
  pick: z.string().nullable(),
  totals: z.object({
    volumes: z.number(),
    cards: z.number(),
    missing: z.number(),
    copiesMissing: z.number(),
    winsToComplete: z.number(),
  }),
  lastImportAt: z.string().nullable(),
  /** 2/11: the coupons of the latest pokemon-zone import (absent from an API before it: none). */
  coupons: z
    .object({ importedAt: z.string(), syncedAt: z.string(), items: z.array(promoCouponSchema) })
    .nullable()
    .default(null),
})

type PromoVolume = z.infer<typeof volumeSchema>
type PromoCoupons = z.infer<typeof promoSchema>['coupons']
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

/** «faltan 3 copias de 10», «completo»; complete prints but a deck still lacks copies: «faltan copias para tus mazos». */
function volumeState(volume: PromoVolume, goal: number): string {
  if (volume.copiesMissing > 0) {
    return `${missing(volume.copiesMissing, ['copia', 'copias'])} de ${volume.cards.length * goal}`
  }
  return volume.deckCards > 0 ? 'faltan copias para tus mazos' : 'completo'
}

/** «falta 1 copia», «faltan 3 copias para tener 2 de cada una de sus 20 cartas». */
function copiesLine(copies: number, cards: number, goal: number): string {
  return `${missing(copies, ['copia', 'copias'])} para tener ${goal} de cada una de sus ${plural(cards, 'carta', 'cartas')}`
}

/** Why the picked volume wins, by the first of Santi's tiers where it has something. */
function pickReason(volume: PromoVolume, goal: number): string {
  if (volume.reason === 'decks') {
    const cards = volume.cards.filter((card) => card.decks.length > 0).map((card) => card.nameEs)
    return `es la que más chance tiene de darte una carta que le falta a tus mazos (${percent(volume.chanceDecks)}: ${cards.join(', ')}).`
  }
  if (volume.reason === 'new') {
    return `es la que más chance tiene de darte una carta que no tenés en ninguna versión (${percent(volume.chanceNew)}).`
  }
  return `es la que más chance tiene de darte una edición de la que tenés menos de ${goal} copias (${percent(volume.chanceMissing)}).`
}

/** A print with the goal's copies: «✓ name»; below it, the name in bold and, when there is one, «1/2». */
function CardName({ card, goal }: { card: PromoCard; goal: number }) {
  const name = card.missing ? (
    <span className="font-medium">
      {card.nameEs}
      {card.owned > 0 ? (
        <span className="tabular text-xs font-normal text-muted-foreground">
          {' '}
          {card.owned}/{goal}
        </span>
      ) : null}
    </span>
  ) : (
    `✓ ${card.nameEs}`
  )
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
  { reason: 'missing', short: 'edición', long: 'copia que te falta', chance: (v: PromoVolume) => v.chanceMissing },
] as const

function VolumeRow({ volume, goal, mark }: { volume: PromoVolume; goal: number; mark: 'pick' | 'tie' | null }) {
  const headline = TIERS.find((tier) => tier.reason === volume.reason)
  const details = [
    ...TIERS.filter((tier) => tier !== headline && tier.chance(volume) > 0).map(
      (tier) => `${tier.long}: ${percent(tier.chance(volume))}`,
    ),
    // Wins only where there is a battle now.
    volume.copiesMissing > 0 && volume.inEvent ? `${wins(volume.winsToComplete)} para completarlo` : null,
  ].filter((item): item is string => item !== null)
  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{label(volume)}</span>
        {mark === 'pick' ? <Badge>Conviene</Badge> : null}
        {mark === 'tie' ? <Badge variant="outline">Empata</Badge> : null}
        <span className="text-sm text-muted-foreground">{volumeState(volume, goal)}</span>
        <span className="ml-auto text-sm">
          <span className="tabular font-semibold">{headline ? percent(headline.chance(volume)) : percent(0)}</span>
          {headline ? <span className="text-xs text-muted-foreground"> {headline.short}</span> : null}
        </span>
      </div>
      {details.length > 0 ? <p className="text-xs text-muted-foreground">{details.join(' · ')}</p> : null}
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
        {volume.cards.map((card) => (
          <li key={card.cardId} className={cn(!card.missing && card.decks.length === 0 && 'text-muted-foreground')}>
            <CardName card={card} goal={goal} />
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
  goal,
  pick,
  best,
}: {
  volumes: PromoVolume[]
  goal: number
  pick: string | null
  best: ReadonlySet<string>
}) {
  return (
    <ul className="divide-y rounded-lg border">
      {volumes.map((volume) => (
        <VolumeRow
          key={volume.id}
          volume={volume}
          goal={goal}
          mark={volume.id === pick ? 'pick' : best.has(volume.id) ? 'tie' : null}
        />
      ))}
    </ul>
  )
}

/**
 * 2/11: the coupons Santi has, from the latest pokemon-zone import: the active event's (the ones its shop takes) and,
 * apart, other events'; with the date the game was read.
 */
function OwnCoupons({ coupons }: { coupons: PromoCoupons }) {
  if (!coupons) {
    return (
      <p className="text-muted-foreground">
        Para ver cuántos cupones tenés,{' '}
        <Link to="/coleccion/pokemon-zone" className="underline">
          traelos del juego con pokemon-zone
        </Link>
        .
      </p>
    )
  }
  const active = coupons.items.filter((coupon) => coupon.active)
  const others = coupons.items.filter((coupon) => !coupon.active)
  const total = active.reduce((sum, coupon) => sum + coupon.count, 0)
  return (
    <div className="flex flex-col gap-1" data-testid="own-coupons">
      <h3 className="text-xs font-semibold text-muted-foreground">Tus cupones</h3>
      <p>
        {total > 0 ? (
          <>
            De este evento tenés <span className="font-medium">{plural(total, 'cupón', 'cupones')}</span>.
          </>
        ) : (
          'De este evento no tenés cupones.'
        )}
      </p>
      {others.length > 0 ? (
        <ul className="text-xs text-muted-foreground">
          {others.map((coupon) => (
            <li key={coupon.key}>
              {plural(coupon.count, 'cupón', 'cupones')} de{' '}
              {coupon.nameEs ?? `«${coupon.event}» (nombre del juego en inglés)`}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Según pokemon-zone, datos del juego del {formatDateTime(coupons.syncedAt)}.
      </p>
    </div>
  )
}

/**
 * The event's coupons: for a card a deck lacks, for a volume with a single print below the goal (every coupon on it
 * saves n, also when it lacks both copies), and the cards with no battle.
 */
function Coupons({
  inEvent,
  outside,
  goal,
  coupons,
}: {
  inEvent: PromoVolume[]
  outside: PromoVolume[]
  goal: number
  coupons: PromoCoupons
}) {
  const forDecks = inEvent.flatMap((volume) =>
    volume.cards.filter((card) => card.decks.length > 0).map((card) => ({ volume, card })),
  )
  const lastCard = inEvent.filter((volume) => volume.missing === 1)
  const onlyCoupon = outside.filter((volume) => volume.copiesMissing > 0)
  const onlyCouponCopies = onlyCoupon.reduce((sum, volume) => sum + volume.copiesMissing, 0)
  const anyMissing = inEvent.some((volume) => volume.copiesMissing > 0)
  const held = (coupons?.items.length ?? 0) > 0
  if (!anyMissing && forDecks.length === 0 && onlyCoupon.length === 0 && !held) return null
  return (
    <Fold title="Cupones" hint="dónde rinden más" remember="promo-coupons">
      <div className="flex flex-col gap-3 text-sm">
        <OwnCoupons coupons={coupons} />
        <p className="text-muted-foreground">
          Las misiones del evento dan cupones que se canjean en la tienda por una carta de promoción, si la tienda la
          tiene. Para una carta puntual, como la de un mazo, un cupón ahorra todas las victorias que llevaría sacarla
          (~5; ~7 en A vol. 9). Si vas a completar un volumen ({goal} de cada carta), rinde más cuando le queda una sola
          carta por sacar: ahí cada cupón ahorra lo mismo, también para su segunda copia. Gastado antes ahorra menos
          (con todo por sacar, 1). Antes de que termine el evento, canjealos igual.
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
              {lastCard.map((volume) => {
                const card = volume.cards.find((item) => item.missing)
                const copies = card?.needed ?? 1
                return (
                  <li key={volume.id} className="px-3 py-2">
                    <span className="font-medium">{label(volume)}</span>
                    <span className="text-muted-foreground"> · </span>
                    {card?.nameEs}
                    {copies > 1 ? ` ×${copies}` : null}
                    <span className="text-muted-foreground">
                      {' '}
                      · ahorra {wins(volume.cards.length)}
                      {copies > 1 ? ' cada cupón' : null}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : anyMissing ? (
          <p>A ningún volumen del evento le queda una sola carta por sacar todavía.</p>
        ) : null}
        {onlyCoupon.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground">
              Sin batalla en este evento ({plural(onlyCouponCopies, 'copia', 'copias')}): solo con cupón, si la tienda{' '}
              {onlyCouponCopies === 1 ? 'la tiene' : 'las tiene'}.
            </p>
            <ul className="text-xs">
              {onlyCoupon.map((volume) => (
                <li key={volume.id}>
                  <span className="font-medium">{label(volume)}</span>
                  <span className="text-muted-foreground"> · </span>
                  {volume.cards
                    .filter((card) => card.missing)
                    .map((card) => (card.needed > 1 ? `${card.nameEs} ×${card.needed}` : card.nameEs))
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
                Conviene ganar <span className="font-semibold">{label(picked)}</span>: {pickReason(picked, data.goal)}
              </p>
              {ties.length > 0 ? (
                <p>
                  {ties.length === 1 ? 'Empata' : 'Empatan'} en todo: {joinVolumes(ties)}. Te sugiero uno al azar cada
                  vez que entrás.
                </p>
              ) : null}
              {data.totals.copiesMissing > 0 ? (
                <p className="text-muted-foreground">
                  En el evento te {copiesLine(data.totals.copiesMissing, data.totals.cards, data.goal)}:{' '}
                  {wins(data.totals.winsToComplete)} sin cupones. Después de cada victoria, sincronizá la colección y
                  volvé a mirar: el orden cambia.
                </p>
              ) : null}
            </div>
          ) : (
            <EmptyState
              title={`Ya tenés ${data.goal} de cada carta del evento`}
              description="Ninguna victoria te daría algo que te falte."
            />
          )}
        </Section>
      ) : data.totals.copiesMissing > 0 ? (
        <p className="text-sm text-muted-foreground">
          De los sobres de promoción te {copiesLine(data.totals.copiesMissing, data.totals.cards, data.goal)}.
        </p>
      ) : (
        <EmptyState
          title={`Ya tenés ${data.goal} de cada promo de los sobres`}
          description="No te falta ninguna copia."
        />
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
          si el volumen tiene alguna; si no, una que no tenés en ninguna versión («nueva»); si no, una edición de la que
          te faltan copias para tener {data.goal} («edición»). Abajo de cada volumen, las otras chances.
        </p>
        <VolumeList volumes={inEvent} goal={data.goal} pick={data.pick} best={best} />
      </Section>

      {data.event && !noCollection ? (
        <Coupons inEvent={inEvent} outside={outside} goal={data.goal} coupons={data.coupons} />
      ) : null}

      {outside.length > 0 ? (
        <Fold title="Otros volúmenes" hint="sin batalla ahora" remember="promo-outside">
          <VolumeList volumes={outside} goal={data.goal} pick={null} best={new Set()} />
        </Fold>
      ) : null}

      <section className="flex flex-col gap-1 text-xs text-muted-foreground">
        <h2 className="text-sm font-medium text-foreground">Supuestos</h2>
        <ul className="list-disc pl-5">
          <li>Un sobre de promoción trae 1 carta de su volumen. El juego no publica las tasas: se toman iguales.</li>
          <li>
            Objetivo (tuyo, del 2/11): {data.goal} copias de cada edición. Victorias para completarlo: el promedio
            exacto con las copias que ya tenés. Con nada en la mano, en un volumen de 5 cartas: ~19 para tener 2 de cada
            una y ~11 para 1 de cada una.
          </li>
          <li>Cuenta cada edición: una promo que tenés en otra versión igual falta para la colección.</li>
          <li>
            Orden (tuyo, del 30/10): cartas para tus mazos, después cartas que no tenés en ninguna versión, después
            cualquier edición de la que te falten copias; entre los que empatan en todo, la sugerencia sale al azar.
          </li>
        </ul>
      </section>
    </div>
  )
}
