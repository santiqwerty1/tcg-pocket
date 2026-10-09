/**
 * Ejercicios de cálculo (Fase 30): one question at a time from your decks — the chance of drawing a card by a turn,
 * or whether an attack reaches the KO — four options at most, graded at once with the explanation, and the tally.
 */
import { CheckIcon, SkipForwardIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useDecks } from '@/api/decks'
import { type DrillAnswer, type DrillKind, useAnswerDrill, useDrill, useDrillStats } from '@/api/drills'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Field, Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

const ANY = 'any'
const newSeed = () => Math.floor(Math.random() * 2 ** 31)

function Tally() {
  const stats = useDrillStats()
  if (!stats.data) return null
  const { today, streak, byKind } = stats.data
  const share = (tally: { answered: number; correct: number }) =>
    tally.answered === 0 ? '—' : `${tally.correct} de ${tally.answered}`
  return (
    <p role="status" className="text-sm text-muted-foreground" aria-label="Cómo vas">
      Hoy {share(today)}
      {streak > 1 ? ` · ${streak} seguidas` : ''} · 30 días: robos {share(byKind.draw)}, KO {share(byKind.ko)}
    </p>
  )
}

export function DrillsPage() {
  const decks = useDecks({ archived: false })
  const [kind, setKind] = useState<DrillKind>('draw')
  const [deckId, setDeckId] = useState(ANY)
  const [seed, setSeed] = useState(newSeed)
  const drill = useDrill(kind, deckId === ANY ? '' : deckId, seed)
  const answer = useAnswerDrill()
  const [result, setResult] = useState<(DrillAnswer & { choice: number }) | null>(null)

  function next() {
    setResult(null)
    setSeed(newSeed())
  }

  async function choose(choice: number) {
    if (!drill.data || result || answer.isPending) return
    try {
      const graded = await answer.mutateAsync({ kind, deckId: drill.data.deckId, seed: drill.data.seed, choice })
      setResult({ ...graded, choice })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        value={kind}
        onValueChange={(value) => {
          setKind(value as DrillKind)
          next()
        }}
      >
        <TabsList className="w-full">
          <TabsTrigger value="draw">Robos</TabsTrigger>
          <TabsTrigger value="ko">¿Llega al KO?</TabsTrigger>
        </TabsList>
      </Tabs>
      <Field label="Con el mazo">
        <Select
          value={deckId}
          onValueChange={(value) => {
            setDeckId(value)
            next()
          }}
        >
          <SelectTrigger aria-label="Mazo de los ejercicios" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Cualquiera de mis mazos</SelectItem>
            {(decks.data ?? []).map((deck) => (
              <SelectItem key={deck.id} value={deck.id}>
                {deck.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Tally />

      {drill.isPending ? <LoadingRows rows={4} /> : null}
      {drill.isError ? <ErrorState error={drill.error} onRetry={next} /> : null}
      {drill.data ? (
        <Section title={drill.data.prompt}>
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {drill.data.facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
          <div
            className={cn('grid gap-2', drill.data.choices.length === 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4')}
          >
            {drill.data.choices.map((choice, i) => {
              const right = result && i === result.answer
              const wrong = result && i === result.choice && !result.correct
              return (
                <Button
                  key={choice}
                  variant="outline"
                  size="lg"
                  className={cn(
                    'h-14 text-base',
                    right && 'border-success bg-success/10 text-success',
                    wrong && 'border-destructive bg-destructive/10 text-destructive',
                  )}
                  aria-pressed={result?.choice === i}
                  disabled={answer.isPending || (result !== null && !right && !wrong)}
                  onClick={() => void choose(i)}
                >
                  {right ? <CheckIcon data-icon="inline-start" /> : wrong ? <XIcon data-icon="inline-start" /> : null}
                  {choice}
                </Button>
              )
            })}
          </div>
          {result ? (
            <div role="status" className="flex flex-col gap-2 rounded-lg border p-3">
              <p className={cn('font-semibold', result.correct ? 'text-success' : 'text-destructive')}>
                {result.correct ? '¡Bien!' : 'No'}
              </p>
              <p className="text-sm">{result.explanation}</p>
            </div>
          ) : null}
          <Button variant={result ? 'default' : 'ghost'} className="self-start" onClick={next}>
            <SkipForwardIcon data-icon="inline-start" />
            {result ? 'Otra' : 'Saltear'}
          </Button>
        </Section>
      ) : null}
    </div>
  )
}
