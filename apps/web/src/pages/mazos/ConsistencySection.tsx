/**
 * «¿En qué turno está listo?» (Fase 8): the latest consistency measures of the deck, against a passive rival and
 * against the meta (D-019), and the buttons to measure again (1.000 games on the PC) with the key attacker to look at.
 */
import { GaugeIcon, SwordsIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import type { Consistency, DeckDetail, JobSummary } from '@/api/schemas'
import { useDeckConsistency, useMeasureConsistency } from '@/api/simulations'
import { ConsistencyTable } from '@/components/ConsistencyTable'
import { LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const SUGGESTED = '__suggested__'

function Measured({ title, data }: { title: string; data: { job: JobSummary; consistency: Consistency } }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">{title}</h3>
      <ConsistencyTable data={data.consistency} />
      <Link to={`/simulacion/${data.job.id}`} className="text-xs text-primary hover:underline">
        Simulación #{data.job.id} · semilla {data.job.baseSeed}
      </Link>
    </div>
  )
}

export function ConsistencySection({ deck }: { deck: DeckDetail }) {
  const result = useDeckConsistency(deck.id)
  const measure = useMeasureConsistency()
  const [key, setKey] = useState(SUGGESTED)
  const pokemon = deck.cards.filter((entry) => entry.card.cardType === 'pokemon')
  const goldfish = result.data?.goldfish ?? null
  const meta = result.data?.meta ?? null

  async function start(mode: 'goldfish' | 'meta') {
    try {
      const job = await measure.mutateAsync({
        mode,
        deckId: deck.id,
        ...(key === SUGGESTED ? {} : { keyCards: [key] }),
      })
      toast.success(`Midiendo ${mode === 'meta' ? 'contra el meta' : 'contra un rival pasivo'}: simulación #${job.id}`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <Section title="¿En qué turno está listo?">
      {result.isLoading ? <LoadingRows rows={2} /> : null}
      {goldfish ? <Measured title="Contra un rival pasivo" data={goldfish} /> : null}
      {meta ? <Measured title="Contra el meta" data={meta} /> : null}
      {result.isSuccess && !goldfish && !meta ? (
        <p className="text-sm text-muted-foreground">
          Todavía no se midió. Contra un rival pasivo, 1.000 partidas dicen cómo se arma la lista sola; contra el meta,
          cómo llega cuando el rival pega.
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Select value={key} onValueChange={setKey}>
          <SelectTrigger aria-label="Atacante a mirar" className="w-full sm:w-64">
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
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={measure.isPending} onClick={() => void start('goldfish')}>
            <GaugeIcon aria-hidden="true" />
            Contra un rival pasivo
          </Button>
          <Button type="button" variant="outline" disabled={measure.isPending} onClick={() => void start('meta')}>
            <SwordsIcon aria-hidden="true" />
            Contra el meta
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          1.000 partidas cada una, en la PC. Contra el meta usa el banco del Laboratorio (era actual, 15 arquetipos).
        </p>
      </div>
    </Section>
  )
}
