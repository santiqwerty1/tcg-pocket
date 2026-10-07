/**
 * «Mazo al azar» (pedido del 7/10/2026): picks a saved active deck, optionally only among the ones built in the game
 * or with a tag, and by default among the least played (to spread «10 partidas con cada mazo»).
 */
import { DicesIcon, SwordsIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { errorMessage } from '@/api/client'
import { fetchRandomDeck } from '@/api/decks'
import type { RandomDeck } from '@/api/schemas'
import { DeckNumber } from '@/components/DeckNumber'
import { EnergyChips } from '@/components/EnergyChip'
import { Spinner } from '@/components/ListState'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'

export function RandomDeckSheet({
  open,
  onOpenChange,
  onlyBuilt: initialOnlyBuilt,
  tag,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Starts from the list filters. */
  onlyBuilt: boolean
  tag: string | null
}) {
  const [onlyBuilt, setOnlyBuilt] = useState(initialOnlyBuilt)
  const [leastPlayed, setLeastPlayed] = useState(true)
  const [picked, setPicked] = useState<RandomDeck | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function pick() {
    setPending(true)
    setError(null)
    try {
      setPicked(
        await fetchRandomDeck({
          ...(onlyBuilt ? { builtInGame: true } : {}),
          ...(tag ? { tag } : {}),
          ...(leastPlayed ? { leastPlayed: true } : {}),
          ...(picked ? { exclude: picked.deck.id } : {}),
        }),
      )
    } catch (cause) {
      setPicked(null)
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setPicked(null)
          setError(null)
        }
      }}
    >
      <SheetContent side="bottom" className="pb-safe">
        <SheetHeader>
          <SheetTitle>Mazo al azar</SheetTitle>
          <SheetDescription>Entre los mazos guardados activos{tag ? ` con #${tag}` : ''}.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <Label className="flex min-h-11 items-center gap-2 font-normal">
            <Switch checked={onlyBuilt} onCheckedChange={setOnlyBuilt} />
            Solo los armados en el juego
          </Label>
          <Label className="flex min-h-11 items-center gap-2 font-normal">
            <Switch checked={leastPlayed} onCheckedChange={setLeastPlayed} />
            Entre los que tienen menos partidas
          </Label>
          {picked ? (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <DeckNumber id={picked.deck.id} name={picked.deck.name} />
                <span className="min-w-0 flex-1 truncate text-lg font-semibold">{picked.deck.name}</span>
                <EnergyChips energies={picked.deck.energies} />
              </div>
              <p className="text-xs text-muted-foreground">
                {picked.games === 0 ? 'Sin partidas registradas' : `${picked.games} partidas registradas`}
                {picked.deck.builtInGame ? ' · armado en el juego' : ''}
                {picked.deck.valid ? '' : ' · con errores de validación'}
                {picked.deck.complete ? '' : ` · faltan ${picked.deck.missingCount} copias`} · elegido entre{' '}
                {picked.candidates}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" asChild>
                  <Link to={`/mazos/${encodeURIComponent(picked.deck.id)}`}>Ver mazo</Link>
                </Button>
                <Button asChild>
                  <Link to={`/partidas?mazo=${encodeURIComponent(picked.deck.id)}`}>
                    <SwordsIcon data-icon="inline-start" />
                    Jugarlo
                  </Link>
                </Button>
              </div>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button size="lg" onClick={pick} disabled={pending}>
            {pending ? <Spinner /> : <DicesIcon data-icon="inline-start" />}
            {picked ? 'Otro' : 'Elegir'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
