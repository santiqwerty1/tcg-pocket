/** Results of the pack recommendation: table per pack, missing cards with cost, packs to complete each deck. */
import { useState } from 'react'
import { Link } from 'react-router'
import type { DeckCompletion, MissingCard, PackRow, Recommendation } from '@/api/schemas'
import { Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  formatAmount,
  formatChance,
  formatExpectedPacks,
  formatPacks,
  MODEL_LABEL,
  REASON_LABEL,
  rarityLabel,
} from '@/lib/packs'
import { cn } from '@/lib/utils'

function packLabel(pack: { nameEs: string; expansionId: string }): string {
  return `${pack.nameEs} · ${pack.expansionId}`
}

function PackRowItem({ row, rank }: { row: PackRow; rank: number }) {
  const differs = Math.abs(row.otherModel.probability - row.probability) >= 0.005
  return (
    <li className={cn('flex flex-col gap-0.5 px-3 py-2', !row.available && 'opacity-60')}>
      <div className="flex items-baseline gap-2">
        <span className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular">{rank}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{packLabel(row)}</span>
        {!row.available ? <Badge variant="outline">no disponible</Badge> : null}
        <span className="shrink-0 font-semibold tabular">{formatChance(row.probability)}</span>
      </div>
      <div className="pl-8 text-xs text-muted-foreground tabular">
        <span className="whitespace-nowrap">{formatAmount(row.expected)} buscadas</span>
        <span className="whitespace-nowrap"> · puntaje {formatAmount(row.expectedValue)}</span>
        <span className="whitespace-nowrap"> · 50 %: {formatPacks(row.packsFor50)}</span>
        <span className="whitespace-nowrap"> · 90 %: {formatPacks(row.packsFor90)}</span>
      </div>
      {differs ? (
        <div className="pl-8 text-xs text-warning">
          Modelo {MODEL_LABEL[row.otherModel.model]}: {formatChance(row.otherModel.probability)}
          {row.otherModel.reasons.length > 0
            ? `, porque el tracker ${row.otherModel.reasons.map((reason) => REASON_LABEL[reason]).join(' y ')}`
            : ''}
        </div>
      ) : null}
    </li>
  )
}

export function PackTable({ recommendation }: { recommendation: Recommendation }) {
  const [showAll, setShowAll] = useState(false)
  const rows = showAll ? recommendation.rows : recommendation.rows.slice(0, 8)
  const nothingWanted = recommendation.rows.every((row) => row.wanted === 0)
  return (
    <Section title="Qué sobre abrir">
      {nothingWanted ? (
        <p className="text-sm text-muted-foreground">
          Nada que buscar con estos objetivos: elegí mazos o activá «Completar colección».
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Ordenados por puntaje: 1 es el mejor sobre posible. Cada objetivo se mide contra su mejor sobre (cartas
            buscadas esperadas, pesadas por la prioridad de cada mazo) y se combinan con el peso de los mazos. El
            porcentaje es la probabilidad de al menos una carta buscada por sobre.
          </p>
          <ol className="divide-y rounded-lg border">
            {rows.map((row, at) => (
              <PackRowItem key={row.packId} row={row} rank={at + 1} />
            ))}
          </ol>
          {recommendation.rows.length > 8 ? (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Ver menos' : `Ver los ${recommendation.rows.length}`}
            </Button>
          ) : null}
        </>
      )}
    </Section>
  )
}

function MissingRow({ item }: { item: MissingCard }) {
  return (
    <li className="flex flex-col gap-0.5 px-3 py-2 text-sm">
      <div className="flex items-baseline gap-2">
        <Link
          to={`/grupos/${encodeURIComponent(item.groupId)}`}
          className="min-w-0 flex-1 truncate font-medium hover:underline"
        >
          {item.nameEs}
        </Link>
        <span className="shrink-0 text-muted-foreground tabular">falta {item.missing}</span>
        {item.advice === 'buy' ? (
          <Badge className="bg-success text-white">comprar</Badge>
        ) : item.advice === 'open' ? (
          <Badge variant="secondary">abrir</Badge>
        ) : null}
      </div>
      <div className="text-xs text-muted-foreground">
        {item.decks.map((deck) => `${deck.name} (${deck.priority})`).join(' · ')}
      </div>
      <div className="text-xs">
        {item.cheapest ? (
          <>
            <span className="font-mono">{item.cheapest.cardId}</span> {rarityLabel(item.cheapest.rarity)} ·{' '}
            {item.cheapest.points} puntos{item.cheapest.verified ? '' : ' (sin verificar)'} ·{' '}
            {item.cheapest.tradeable ? 'intercambiable' : 'no intercambiable'}
            {item.pointsInPacks !== null ? (
              <span className="text-muted-foreground">
                {' '}
                · equivale a {formatAmount(item.pointsInPacks)} sobres de puntos
              </span>
            ) : null}
          </>
        ) : (
          'No se compra con puntos'
        )}
      </div>
      <div className="text-xs text-muted-foreground">
        {item.bestPack
          ? `Mejor sobre: ${packLabel(item.bestPack)} · ${formatChance(item.bestPack.probability)} · ~${formatExpectedPacks(item.bestPack.packsPerCopy)} sobres por copia`
          : 'No sale de ningún sobre disponible'}
      </div>
    </li>
  )
}

export function MissingCards({ items }: { items: MissingCard[] }) {
  if (items.length === 0) return null
  return (
    <Section title={`Cartas que faltan (${items.length})`}>
      <p className="text-xs text-muted-foreground">
        «Comprar» cuando juntar los puntos lleva menos sobres que sacarla: cada sobre da 5 puntos de su expansión.
      </p>
      <ul className="divide-y rounded-lg border">
        {items.map((item) => (
          <MissingRow key={item.groupId} item={item} />
        ))}
      </ul>
    </Section>
  )
}

function CompletionRow({ deck }: { deck: DeckCompletion }) {
  return (
    <li className="flex flex-col gap-0.5 px-3 py-2 text-sm">
      <div className="flex items-baseline gap-2">
        <Link
          to={`/mazos/${encodeURIComponent(deck.deckId)}`}
          className="min-w-0 flex-1 truncate font-medium hover:underline"
        >
          #{deck.deckId} {deck.name}
        </Link>
        <span className="shrink-0 text-muted-foreground tabular">
          {deck.missingCopies === 0
            ? 'completo'
            : deck.missingCopies === 1
              ? 'falta 1'
              : `faltan ${deck.missingCopies}`}
        </span>
      </div>
      {deck.bestPacks.map((pack) => (
        <div key={pack.packId} className="text-xs tabular">
          {packLabel(pack)}:{' '}
          {pack.covered === deck.missingCopies ? 'todas' : `${pack.covered} de ${deck.missingCopies}`} en ~
          {formatExpectedPacks(pack.expectedPacks)} sobres
          {pack.method === 'simulation' && pack.ci95
            ? ` (simulación, IC ${formatAmount(pack.ci95[0])}–${formatAmount(pack.ci95[1])})`
            : ''}
        </div>
      ))}
      {deck.notInPacks.length > 0 ? (
        <div className="text-xs text-warning">No salen de sobres disponibles: {deck.notInPacks.join(', ')}</div>
      ) : null}
    </li>
  )
}

export function DeckCompletions({ decks }: { decks: DeckCompletion[] }) {
  if (decks.length === 0) return null
  return (
    <Section title="Sobres para completar cada mazo">
      <p className="text-xs text-muted-foreground">
        Abriendo siempre el mismo sobre: cuántas de las copias que faltan puede dar y en cuántos sobres esperados.
      </p>
      <ul className="divide-y rounded-lg border">
        {decks.map((deck) => (
          <CompletionRow key={deck.deckId} deck={deck} />
        ))}
      </ul>
    </Section>
  )
}
