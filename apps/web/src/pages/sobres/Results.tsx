/** Results of the pack recommendation: table per pack, missing cards with cost, packs to complete each deck. */
import { useState } from 'react'
import { Link } from 'react-router'
import type { DeckCompletion, ExclusiveVersion, MissingCard, PackRow, Recommendation } from '@/api/schemas'
import { Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  formatAmount,
  formatBoost,
  formatChance,
  formatExpectedPacks,
  formatPacks,
  limitedLabel,
  MODEL_LABEL,
  REASON_LABEL,
  rarityLabel,
} from '@/lib/packs'
import { cn } from '@/lib/utils'

function packLabel(pack: { nameEs: string; expansionId: string }): string {
  return `${pack.nameEs} · ${pack.expansionId}`
}

function versionLabel(item: ExclusiveVersion): string {
  return `${item.nameEs} ${rarityLabel(item.rarity)}${item.holo ? ' holo' : ''}`
}

/** What only a limited pack gives: functional cards for the decks, versions (art, holo) for the collection. */
function ExclusiveList({ items, boost }: { items: ExclusiveVersion[]; boost: number }) {
  const forDecks = items.filter((item) => item.goal === 'decks')
  const forCollection = items.filter((item) => item.goal === 'collection')
  return (
    <details className="pl-8 text-xs">
      <summary className="cursor-pointer text-warning select-none">
        {items.length === 1 ? 'Solo de este sobre: 1 carta buscada' : `Solo de este sobre: ${items.length} buscadas`}
        {boost > 1 ? `, pesan ${formatBoost(boost)}` : ''}
      </summary>
      {forDecks.length > 0 ? (
        <p className="mt-1">
          <span className="text-muted-foreground">Para mazos: </span>
          {forDecks.map((item) => item.nameEs).join(', ')}
        </p>
      ) : null}
      {forCollection.length > 0 ? (
        <ul className="mt-1 grid grid-cols-1 gap-x-3 sm:grid-cols-2">
          {forCollection.map((item) => (
            <li key={item.cardId} className="truncate">
              <span className="font-mono text-muted-foreground">{item.cardId}</span> {versionLabel(item)}
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  )
}

function PackRowItem({ row, rank, today, boost }: { row: PackRow; rank: number; today: string; boost: number }) {
  const differs = Math.abs(row.otherModel.probability - row.probability) >= 0.005
  return (
    <li className={cn('flex flex-col gap-0.5 px-3 py-2', !row.available && 'opacity-60')}>
      <div className="flex items-baseline gap-2">
        <span className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular">{rank}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{packLabel(row)}</span>
        {row.limited && row.available ? (
          <Badge className="bg-warning text-white">limitado</Badge>
        ) : !row.available ? (
          <Badge variant="outline">no disponible</Badge>
        ) : null}
        <span className="shrink-0 font-semibold tabular">{formatChance(row.probability)}</span>
      </div>
      {row.limited ? <div className="pl-8 text-xs text-warning">{limitedLabel(row.limited, today)}</div> : null}
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
      {row.limited && row.available && row.limited.exclusive.length > 0 ? (
        <ExclusiveList items={row.limited.exclusive} boost={boost} />
      ) : null}
    </li>
  )
}

export function PackTable({ recommendation }: { recommendation: Recommendation }) {
  const [showAll, setShowAll] = useState(false)
  const rows = showAll ? recommendation.rows : recommendation.rows.slice(0, 8)
  const nothingWanted = recommendation.rows.every((row) => row.wanted === 0)
  const out = recommendation.collectionOutOfPacks
  return (
    <Section title="Qué sobre abrir">
      {nothingWanted ? (
        <p className="text-sm text-muted-foreground">
          {recommendation.goals.decks.length > 0 && recommendation.deckTarget === 'saved'
            ? 'Nada que buscar: los mazos marcados ya están completos con su lista guardada. Activá «Apuntar a la versión de torneo» para buscar lo que les falta para la lista de torneo, o «Completar colección».'
            : 'Nada que buscar con estos objetivos: elegí mazos o activá «Completar colección».'}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Ordenados por puntaje: 1 es el mejor sobre a la venta. Cada objetivo se mide contra su mejor sobre (cartas
            buscadas esperadas, pesadas por la prioridad de cada mazo) y se combinan con el peso de los mazos. El
            porcentaje es la probabilidad de al menos una carta buscada por sobre. Los que no están a la venta van al
            final; su puntaje dice cuánto mejor serían.
          </p>
          <ol className="divide-y rounded-lg border">
            {rows.map((row, at) => (
              <PackRowItem
                key={row.packId}
                row={row}
                rank={at + 1}
                today={recommendation.today}
                boost={recommendation.limitedBoost}
              />
            ))}
          </ol>
          {recommendation.rows.length > 8 ? (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Ver menos' : `Ver los ${recommendation.rows.length}`}
            </Button>
          ) : null}
          {out && out.versions > 0 ? (
            <p className="text-xs text-muted-foreground">
              {out.versions === 1
                ? '1 versión que buscás no sale de ningún sobre a la venta'
                : `${out.versions} versiones que buscás no salen de ningún sobre a la venta`}{' '}
              (sobres retirados como el Deluxe ex, promos): {out.tradeable} se pueden conseguir por intercambio.
            </p>
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
        {item.advice === 'redeem' ? (
          <Badge className="bg-success text-white">canjear</Badge>
        ) : item.advice === 'buy' ? (
          <Badge className="bg-success text-white">comprar</Badge>
        ) : item.advice === 'open' ? (
          <Badge variant="secondary">abrir</Badge>
        ) : item.advice === 'trade' ? (
          <Badge variant="outline">intercambiar</Badge>
        ) : null}
      </div>
      <div className="text-xs text-muted-foreground">
        {item.decks.map((deck) => `${deck.name} (${deck.priority})`).join(' · ')}
      </div>
      {item.redeem ? (
        <div className="text-xs text-success">
          Con tus puntos guardados: <span className="font-mono">{item.redeem.cardId}</span>{' '}
          {rarityLabel(item.redeem.rarity)} · {item.redeem.points} puntos (tenés {item.redeem.saved}; alcanzan para{' '}
          {item.redeem.copies} {item.redeem.copies === 1 ? 'copia' : 'copias'})
        </div>
      ) : null}
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
        ) : item.retiredCheapest ? (
          <>
            No se compra con puntos que se puedan ganar; si te quedan puntos de su expansión:{' '}
            <span className="font-mono">{item.retiredCheapest.cardId}</span> {rarityLabel(item.retiredCheapest.rarity)}{' '}
            · {item.retiredCheapest.points} puntos{item.retiredCheapest.verified ? '' : ' (sin verificar)'}
          </>
        ) : (
          'No se compra con puntos que se puedan ganar'
        )}
      </div>
      <div className="text-xs text-muted-foreground">
        {item.bestPack
          ? `Mejor sobre: ${packLabel(item.bestPack)} · ${formatChance(item.bestPack.probability)} · ~${formatExpectedPacks(item.bestPack.packsPerCopy)} sobres por copia${item.bestPack.limited ? ' (tiempo limitado)' : ''}`
          : `No sale de ningún sobre a la venta${item.tradeable ? '; se puede intercambiar' : ''}`}
      </div>
      {item.bestPack?.limited ? (
        <div className="text-xs text-muted-foreground">
          {item.afterLimited
            ? `Cuando termine: ${packLabel(item.afterLimited)} · ${formatChance(item.afterLimited.probability)} · ~${formatExpectedPacks(item.afterLimited.packsPerCopy)} sobres por copia`
            : 'Cuando termine no la da ningún sobre a la venta'}
        </div>
      ) : null}
    </li>
  )
}

export function MissingCards({ items }: { items: MissingCard[] }) {
  if (items.length === 0) return null
  return (
    <Section title={`Cartas que faltan (${items.length})`}>
      <p className="text-xs text-muted-foreground">
        «Comprar» cuando juntar los puntos lleva menos sobres que sacarla: cada sobre da 5 puntos de su expansión.
        «Intercambiar» cuando ningún sobre a la venta la da ni sus puntos se pueden ganar.
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
          {pack.limited ? ' · tiempo limitado' : ''}
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
