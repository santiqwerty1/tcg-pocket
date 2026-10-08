/**
 * «¿En qué turno está listo?» (Fase 8): the latest consistency measure of the deck and a button to measure it again
 * (1.000 goldfish games on the PC), with the key attacker to look at.
 */
import { GaugeIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import type { DeckDetail } from '@/api/schemas'
import { useDeckConsistency, useMeasureConsistency } from '@/api/simulations'
import { ConsistencyTable } from '@/components/ConsistencyTable'
import { LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const SUGGESTED = '__suggested__'

export function ConsistencySection({ deck }: { deck: DeckDetail }) {
  const result = useDeckConsistency(deck.id)
  const measure = useMeasureConsistency()
  const [key, setKey] = useState(SUGGESTED)
  const pokemon = deck.cards.filter((entry) => entry.card.cardType === 'pokemon')

  async function start() {
    try {
      const job = await measure.mutateAsync({ deckId: deck.id, ...(key === SUGGESTED ? {} : { keyCards: [key] }) })
      toast.success(`Midiendo: simulación #${job.id}`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <Section title="¿En qué turno está listo?">
      {result.isLoading ? <LoadingRows rows={2} /> : null}
      {result.data ? (
        <>
          <ConsistencyTable data={result.data.consistency} />
          <Link to={`/simulacion/${result.data.job.id}`} className="text-xs text-primary hover:underline">
            Simulación #{result.data.job.id} · semilla {result.data.job.baseSeed}
          </Link>
        </>
      ) : result.isSuccess ? (
        <p className="text-sm text-muted-foreground">
          Todavía no se midió: 1.000 partidas en la PC dicen en qué turno suele tener al atacante en juego con energía.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={key} onValueChange={setKey}>
          <SelectTrigger aria-label="Atacante a mirar" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SUGGESTED}>Atacante: el que más puntos da</SelectItem>
            {pokemon.map((entry) => (
              <SelectItem key={entry.card.id} value={entry.card.id}>
                {entry.card.nameEs}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" disabled={measure.isPending} onClick={() => void start()}>
          <GaugeIcon aria-hidden="true" />
          Medir (1.000 partidas)
        </Button>
      </div>
    </Section>
  )
}
