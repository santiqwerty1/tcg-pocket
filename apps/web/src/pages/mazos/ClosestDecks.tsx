/**
 * «¿Qué mazo ya armado modifico para armar este?» (pedido del 7/10/2026): the saved decks that need the fewest card
 * swaps, counted by functional card, with what to take out and put in and whether the Energy Zone changes.
 */
import { useState } from 'react'
import { Link } from 'react-router'
import { useClosestDecks } from '@/api/decks'
import type { CardChange, DeckDistance } from '@/api/schemas'
import { DeckNumber } from '@/components/DeckNumber'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { energyLabel } from '@/lib/energies'

function changeText(changes: CardChange[]): string {
  return changes.map((change) => `${change.count}× ${change.nameEs} (${change.cardIds.join(', ')})`).join(' · ')
}

function DistanceRow({ distance }: { distance: DeckDistance }) {
  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-center gap-2">
        <DeckNumber id={distance.deckId} name={distance.name} className="text-sm" />
        <Link
          to={`/mazos/${encodeURIComponent(distance.deckId)}`}
          className="min-w-0 flex-1 truncate font-medium hover:underline"
        >
          {distance.name}
        </Link>
        <Badge variant={distance.swaps === 0 ? 'outline' : 'secondary'} className="tabular">
          {distance.swaps === 0 ? 'sin cambios' : distance.swaps === 1 ? '1 cambio' : `${distance.swaps} cambios`}
        </Badge>
      </div>
      {distance.energies.change ? (
        <p className="text-xs text-warning">
          Energía: {distance.energies.from.map(energyLabel).join(', ') || 'ninguna'} a{' '}
          {distance.energies.to.map(energyLabel).join(', ') || 'ninguna'}
        </p>
      ) : null}
      {distance.toRemove.length > 0 || distance.toAdd.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground select-none">Ver qué cambiar</summary>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {distance.toRemove.length > 0 ? (
              <>
                <dt className="text-muted-foreground">Sacar</dt>
                <dd>{changeText(distance.toRemove)}</dd>
              </>
            ) : null}
            {distance.toAdd.length > 0 ? (
              <>
                <dt className="text-muted-foreground">Poner</dt>
                <dd>{changeText(distance.toAdd)}</dd>
              </>
            ) : null}
            {distance.otherEdition.length > 0 ? (
              <>
                <dt className="text-muted-foreground">Igual</dt>
                <dd className="text-muted-foreground">
                  {changeText(distance.otherEdition)} (misma carta en otra edición: no hace falta cambiarla)
                </dd>
              </>
            ) : null}
          </dl>
        </details>
      ) : null}
    </li>
  )
}

export function ClosestDecksSection({ deckId }: { deckId: string }) {
  const [scope, setScope] = useState<'built' | 'all'>('built')
  const closest = useClosestDecks(deckId, scope)

  return (
    <Section
      title="Mazo armado más cercano"
      action={
        <Label className="flex min-h-11 items-center gap-2 text-sm font-normal">
          <Switch checked={scope === 'all'} onCheckedChange={(on) => setScope(on ? 'all' : 'built')} />
          Todos los guardados
        </Label>
      }
    >
      <p className="text-sm text-muted-foreground">
        Para armar este mazo cambiando lo menos posible{' '}
        {scope === 'built' ? 'uno que ya tengas armado en el juego' : 'otro mazo guardado'}. Cuenta por carta: otra
        edición de la misma carta no es un cambio.
      </p>
      {closest.isPending ? <LoadingRows rows={2} /> : null}
      {closest.isError ? <ErrorState error={closest.error} onRetry={() => closest.refetch()} /> : null}
      {closest.data && closest.data.scope === 'built' && closest.data.builtInGameDecks === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-2 text-sm">
          No marcaste ningún mazo como «armado en el juego». Marcalos desde su ficha (hasta 30) o activá «Todos los
          guardados».
        </p>
      ) : null}
      {closest.data && closest.data.results.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {closest.data.results.map((distance) => (
            <DistanceRow key={distance.deckId} distance={distance} />
          ))}
        </ul>
      ) : null}
      {closest.data &&
      closest.data.results.length === 0 &&
      closest.data.candidates === 0 &&
      closest.data.builtInGameDecks > 0 ? (
        <p className="text-sm text-muted-foreground">Este es el único mazo armado en el juego.</p>
      ) : null}
    </Section>
  )
}
