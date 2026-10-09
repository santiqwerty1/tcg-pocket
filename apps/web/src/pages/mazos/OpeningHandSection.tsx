/**
 * «Mano inicial» (Fase 10): the chance of having a card of the deck in the opening hand and by each own turn, and of
 * having two cards at once. Exact numbers from the API; natural draws only.
 */
import { useState } from 'react'
import { useDrawOdds } from '@/api/decks'
import type { DeckDetail } from '@/api/schemas'
import { DrawOddsTable } from '@/components/DrawOddsTable'
import { EnergyZoneTable } from '@/components/EnergyZoneTable'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const KEY = '__key__'
const NONE = '__none__'

export function OpeningHandSection({ deck }: { deck: DeckDetail }) {
  const [first, setFirst] = useState(KEY)
  const [second, setSecond] = useState(NONE)
  // One option per functional card: editions of the same card count together.
  const options = deck.cards.filter(
    (entry, at, all) => all.findIndex((other) => other.card.functionalGroupId === entry.card.functionalGroupId) === at,
  )
  const odds = useDrawOdds(deck.id, first === KEY ? [] : [first], second === NONE ? [] : [second])
  const label = (value: string) => options.find((entry) => entry.card.id === value)?.card.nameEs ?? 'Atacante'
  const labels = [
    first === KEY ? (odds.data?.groups[0]?.cards.map((card) => card.nameEs).join(' o ') ?? 'Atacante') : label(first),
    ...(second === NONE ? [] : [label(second)]),
  ]

  return (
    <Section title="Mano inicial">
      <div className="flex flex-wrap gap-2">
        <Select value={first} onValueChange={setFirst}>
          <SelectTrigger aria-label="Carta" className="w-full sm:w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={KEY}>El atacante que más puntos da</SelectItem>
            {options.map((entry) => (
              <SelectItem key={entry.card.id} value={entry.card.id}>
                {entry.card.nameEs}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={second} onValueChange={setSecond}>
          <SelectTrigger aria-label="Y además" className="w-full sm:w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Y además… (opcional)</SelectItem>
            {options
              .filter((entry) => entry.card.id !== first)
              .map((entry) => (
                <SelectItem key={entry.card.id} value={entry.card.id}>
                  {entry.card.nameEs}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
      {odds.isPending ? <LoadingRows rows={3} /> : null}
      {odds.isError ? <ErrorState error={odds.error} onRetry={() => odds.refetch()} /> : null}
      {odds.data ? <DrawOddsTable data={odds.data} labels={labels} /> : null}
      {odds.data?.energy ? <EnergyZoneTable energy={odds.data.energy} /> : null}
    </Section>
  )
}
