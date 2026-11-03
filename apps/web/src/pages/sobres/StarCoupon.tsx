/**
 * Cupón ★★ (3/11/2026): which pack of the shop to open a ★★-guaranteed coupon on (the 2nd anniversary's, and the one
 * of the «★★ garantizada» missions). Per pack on sale, its ★★ (☆☆) cards, each one as likely: the share a deck goal of
 * Sobres lacks, then the share of editions not owned. With the page's knobs (the list aimed at, «Copias por edición»),
 * and the coupons of the latest pokemon-zone import. It loads when the fold opens.
 */
import { useState } from 'react'
import { Link } from 'react-router'
import { type StarCoupon, type StarCouponPack, useStarCoupon } from '@/api/packs'
import type { DeckTarget } from '@/api/schemas'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Fold } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDateTime, plural } from '@/lib/format'
import { formatChance, formatDeadline, limitedLabel } from '@/lib/packs'

/** Packs shown before «Ver todos». */
const TOP = 3

/**
 * A row's headline is the share that decides its place, as in Sobres de promoción: for the decks when it has some,
 * else new editions, else below the goal (both shares are always in the line under it).
 */
const HEADLINES = [
  { count: (p: StarCouponPack) => p.forDecks, chance: (p: StarCouponPack) => p.chanceDecks, label: () => 'para mazos' },
  { count: (p: StarCouponPack) => p.newEditions, chance: (p: StarCouponPack) => p.chanceNew, label: () => 'nuevas' },
  {
    count: (p: StarCouponPack) => p.belowGoal,
    chance: (p: StarCouponPack) => p.chanceBelowGoal,
    label: (goal: number) => `con menos de ${goal}`,
  },
] as const

const packLabel = (pack: { nameEs: string; expansionId: string }) => `${pack.nameEs} · ${pack.expansionId}`

/** «Mega Mewtwo X · C1», «… y Suicune · A4a», «…, y 3 más». */
function joinPacks(packs: StarCouponPack[], max = 3): string {
  const names = packs.slice(0, max).map(packLabel)
  const rest = packs.length - names.length
  if (rest > 0) return `${names.join(', ')} y ${plural(rest, 'más', 'más')}`
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}

/** Why the first pack wins, by the first share where it has something. */
function reason(pack: StarCouponPack, goal: number): string {
  if (pack.forDecks > 0) {
    return `de sus ${plural(pack.size, '★★', '★★')}, ${pack.forDecks} ${pack.forDecks === 1 ? 'les sirve' : 'les sirven'} a tus mazos (${formatChance(pack.chanceDecks)}).`
  }
  if (pack.newEditions > 0) {
    return `ninguna ★★ a la venta les sirve a tus mazos, y es el sobre con más ediciones que no tenés (${pack.newEditions} de ${pack.size}, ${formatChance(pack.chanceNew)}).`
  }
  return `ya tenés todas las ★★ a la venta, y es el sobre con más ediciones de las que tenés menos de ${goal} copias (${pack.belowGoal} de ${pack.size}, ${formatChance(pack.chanceBelowGoal)}).`
}

/** The coupons Santi has, from the latest pokemon-zone import, and the anniversary's deadline. */
function Coupons({ data }: { data: StarCoupon }) {
  const { coupons } = data
  const items = coupons?.items ?? null
  const usable = (items ?? []).filter((item) => !item.expired)
  const total = usable.reduce((sum, item) => sum + item.count, 0)
  // The known coupons' deadlines, unless the count already says them.
  const deadlines = data.known.filter(
    (ticket) => ticket.until !== null && !usable.some((item) => item.key === ticket.key),
  )
  return (
    <div className="flex flex-col gap-1 text-sm" data-testid="star-coupons">
      {coupons === null ? (
        <p className="text-muted-foreground">
          Para ver cuántos cupones tenés,{' '}
          <Link to="/coleccion/pokemon-zone" className="underline">
            traelos del juego con pokemon-zone
          </Link>
          .
        </p>
      ) : items === null ? (
        <p className="text-muted-foreground">
          Tu última importación de pokemon-zone no dice cuántos cupones ★★ tenés: es de un marcador anterior.{' '}
          <Link to="/coleccion/pokemon-zone" className="underline">
            Copiá el marcador nuevo
          </Link>{' '}
          e importá de nuevo.
        </p>
      ) : (
        <>
          <p>
            {total > 0 ? (
              <>
                Tenés <span className="font-medium">{plural(total, 'cupón ★★', 'cupones ★★')}</span>.
              </>
            ) : (
              'No tenés cupones ★★.'
            )}
          </p>
          {usable.length > 0 ? (
            <ul className="text-xs text-muted-foreground">
              {usable.map((item) => (
                <li key={item.key}>
                  {item.count} · {item.nameEs ?? `«${item.name}» (nombre del juego en inglés)`}
                  {item.until ? `, hasta el ${formatDeadline(item.until)}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Según pokemon-zone (datos del juego del {formatDateTime(coupons.syncedAt)}).
          </p>
        </>
      )}
      {deadlines.map((ticket) => {
        const until = ticket.until as string
        return (
          <p key={ticket.key} className="text-xs text-muted-foreground">
            {ticket.nameEs}: {Date.parse(until) <= Date.now() ? 'venció el' : 'hasta el'} {formatDeadline(until)}.
          </p>
        )
      })}
    </div>
  )
}

function PackItem({
  pack,
  goal,
  mark,
  today,
}: {
  pack: StarCouponPack
  goal: number
  mark: 'pick' | 'tie' | null
  today: string
}) {
  const forDecks = pack.cards.filter((card) => card.decks.length > 0)
  const headline = HEADLINES.find((item) => item.count(pack) > 0) ?? HEADLINES[0]
  return (
    <li className="flex flex-col gap-1 px-3 py-2" data-testid="star-coupon-pack">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="min-w-0 font-medium break-words">{packLabel(pack)}</span>
        {mark === 'pick' ? <Badge>Conviene</Badge> : null}
        {mark === 'tie' ? <Badge variant="outline">Empata</Badge> : null}
        <span className="ml-auto text-sm whitespace-nowrap">
          <span className="font-semibold tabular">{formatChance(headline.chance(pack))}</span>
          <span className="text-xs text-muted-foreground"> {headline.label(goal)}</span>
        </span>
      </div>
      <p className="text-xs text-muted-foreground tabular" data-testid="star-coupon-line">
        <span className="whitespace-nowrap">{plural(pack.size, '★★', '★★')} ·</span>{' '}
        <span className="whitespace-nowrap">
          {pack.forDecks} para mazos ({formatChance(pack.chanceDecks)}) ·
        </span>{' '}
        <span className="whitespace-nowrap">
          {pack.newEditions === 1 ? '1 nueva' : `${pack.newEditions} nuevas`} ({formatChance(pack.chanceNew)})
        </span>
        {goal > 1 ? (
          <>
            {' '}
            <span className="whitespace-nowrap">
              · {pack.belowGoal} con menos de {goal}
            </span>
          </>
        ) : null}
      </p>
      {forDecks.length > 0 ? (
        <ul className="flex flex-col text-sm">
          {forDecks.map((card) => (
            <li key={card.cardId} className="break-words">
              <Link to={`/cartas/${encodeURIComponent(card.cardId)}`} className="font-medium hover:underline">
                {card.nameEs}
              </Link>{' '}
              <span className="font-mono text-xs text-muted-foreground">{card.cardId}</span>
              <span className="text-xs text-warning"> · falta en {card.decks.join(', ')}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {pack.limited ? <p className="text-xs text-warning">{limitedLabel(pack.limited, today)}</p> : null}
    </li>
  )
}

function Content({ deckTarget, copies }: { deckTarget: DeckTarget; copies: number }) {
  const query = useStarCoupon({ deckTarget, copies })
  const [showAll, setShowAll] = useState(false)
  if (query.isPending) return <LoadingRows rows={3} />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  const data = query.data
  const best = new Set(data.best)
  const first = data.packs[0]
  const top = first && best.has(first.packId) ? first : null
  const ties = data.packs.filter((pack) => best.has(pack.packId) && pack !== top)
  const shown = showAll ? data.packs : data.packs.slice(0, TOP)
  return (
    <div className={query.isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
      <div className="flex flex-col gap-3 text-sm">
        <Coupons data={data} />
        {top ? (
          <div className="flex flex-col gap-1">
            <p>
              Conviene <span className="font-semibold">{packLabel(top)}</span>: {reason(top, data.goalCopies)}
            </p>
            {ties.length > 0 ? (
              <p>
                {ties.length === 1 ? 'Empata con' : 'Empatan con él'} {joinPacks(ties)}.
              </p>
            ) : null}
          </div>
        ) : data.packs.length > 0 ? (
          <p>Ninguna ★★ de los sobres a la venta te falta: cualquiera da lo mismo.</p>
        ) : (
          <p>No hay sobres a la venta con cartas ★★.</p>
        )}
        {data.goals.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Ningún mazo tiene prioridad de sobres: el orden sale de las ediciones que no tenés.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Para mazos cuenta lo que les falta a tus {plural(data.goals.length, 'mazo objetivo', 'mazos objetivo')} (
            {data.deckTarget === 'tournament' ? 'versión de torneo' : 'lista guardada'}), con cualquier versión de la
            carta.
          </p>
        )}
        {data.packs.length > 0 ? (
          <ol className="divide-y rounded-lg border">
            {shown.map((pack) => (
              <PackItem
                key={pack.packId}
                pack={pack}
                goal={data.goalCopies}
                mark={pack === top ? 'pick' : best.has(pack.packId) ? 'tie' : null}
                today={data.today}
              />
            ))}
          </ol>
        ) : null}
        {data.packs.length > TOP ? (
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Ver menos' : `Ver todos (${data.packs.length})`}
          </Button>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Supuesto: todas las ★★ de un sobre con la misma chance; cuenta solo la carta ★★ garantizada.
          {data.lastImportAt ? ` Colección del ${formatDateTime(data.lastImportAt)}.` : ''}
        </p>
      </div>
    </div>
  )
}

export function StarCouponSection({ deckTarget, copies }: { deckTarget: DeckTarget; copies: number }) {
  return (
    <Fold title="Cupón ★★: qué sobre conviene" hint="en qué sobre usarlo" remember="sobres-star-coupon">
      <Content deckTarget={deckTarget} copies={copies} />
    </Fold>
  )
}
