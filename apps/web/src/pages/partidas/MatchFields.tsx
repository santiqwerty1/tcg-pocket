/**
 * Inputs of a match, shared by the quick-entry sheet and the edit page. Every choice is a big toggle button
 * (`aria-pressed`) inside a named `fieldset`, so the sheet works with one thumb and each answer costs one tap.
 */
import { type ReactNode, useMemo } from 'react'
import {
  MATCH_MODES,
  type MatchMode,
  type MatchResult,
  type OpponentSuggestion,
  type PickerDeck,
  type SelectableEnergy,
} from '@/api/schemas'
import { EnergyChips } from '@/components/EnergyChip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MODE_LABEL, opponentKeyOf, RESULT_LABEL, WENT_FIRST_LABEL } from '@/lib/matches'
import { cn } from '@/lib/utils'

const RESULT_STYLE: Record<MatchResult, string> = {
  win: 'aria-pressed:border-success aria-pressed:bg-success aria-pressed:text-white',
  loss: 'aria-pressed:border-destructive aria-pressed:bg-destructive aria-pressed:text-white',
  tie: 'aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background',
}

const PRESSED = 'aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground'

/** A named group of toggle buttons; `hiddenLabel` keeps the name for screen readers only. */
export function ChoiceGroup({
  label,
  hiddenLabel = false,
  className,
  children,
}: {
  label: string
  hiddenLabel?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <fieldset className="min-w-0">
      <legend className={hiddenLabel ? 'sr-only' : 'mb-1.5 text-sm font-medium text-muted-foreground'}>{label}</legend>
      <div className={className}>{children}</div>
    </fieldset>
  )
}

export function ResultPicker({
  value,
  onChange,
}: {
  value: MatchResult | null
  onChange: (value: MatchResult) => void
}) {
  return (
    <ChoiceGroup label="Resultado" className="grid grid-cols-3 gap-2">
      {(['win', 'loss', 'tie'] as const).map((result) => (
        <Button
          key={result}
          type="button"
          variant="outline"
          size="lg"
          aria-pressed={value === result}
          className={cn('h-14 text-base', RESULT_STYLE[result])}
          onClick={() => onChange(result)}
        >
          {RESULT_LABEL[result]}
        </Button>
      ))}
    </ChoiceGroup>
  )
}

export function WentFirstPicker({
  value,
  onChange,
}: {
  value: boolean | null
  onChange: (value: boolean | null) => void
}) {
  return (
    <ChoiceGroup label="¿Quién empezó?" className="grid grid-cols-2 gap-2">
      {([true, false] as const).map((first) => (
        <Button
          key={String(first)}
          type="button"
          variant="outline"
          aria-pressed={value === first}
          className={PRESSED}
          // A second tap clears the answer: who started is optional.
          onClick={() => onChange(value === first ? null : first)}
        >
          {first ? WENT_FIRST_LABEL.first : WENT_FIRST_LABEL.second}
        </Button>
      ))}
    </ChoiceGroup>
  )
}

export function ModePicker({ value, onChange }: { value: MatchMode; onChange: (value: MatchMode) => void }) {
  return (
    <ChoiceGroup label="Modalidad" className="flex flex-wrap gap-1.5">
      {MATCH_MODES.map((mode) => (
        <Button
          key={mode}
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={value === mode}
          className={PRESSED}
          onClick={() => onChange(mode)}
        >
          {MODE_LABEL[mode]}
        </Button>
      ))}
    </ChoiceGroup>
  )
}

/** Free text with the opponents already logged as one-tap chips, filtered by what is typed. */
export function OpponentField({
  value,
  onChange,
  suggestions,
  max = 8,
}: {
  value: string
  onChange: (value: string) => void
  suggestions: OpponentSuggestion[]
  max?: number
}) {
  const typedKey = opponentKeyOf(value)
  const visible = useMemo(() => {
    const matching = typedKey ? suggestions.filter((item) => item.key.includes(typedKey)) : suggestions
    return matching.slice(0, max)
  }, [suggestions, typedKey, max])
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="match-opponent" className="text-sm font-medium text-muted-foreground">
        Rival (arquetipo)
      </label>
      <Input
        id="match-opponent"
        value={value}
        maxLength={80}
        autoComplete="off"
        enterKeyHint="done"
        placeholder="Ej.: Mega-Blaziken ex"
        onChange={(event) => onChange(event.target.value)}
      />
      {visible.length > 0 ? (
        <ChoiceGroup label="Rivales anteriores" hiddenLabel className="flex flex-wrap gap-1.5">
          {visible.map((item) => {
            const selected = item.key === typedKey
            return (
              <Button
                key={item.key}
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={selected}
                className={cn('max-w-full', PRESSED)}
                onClick={() => onChange(selected ? '' : item.label)}
              >
                <span className="truncate">{item.label}</span>
              </Button>
            )
          })}
        </ChoiceGroup>
      ) : null}
    </div>
  )
}

/**
 * Recent decks as one-tap chips in a single horizontally scrolling row (the result buttons stay on screen), plus
 * «Otro mazo…» for the full list.
 */
export function DeckChips({
  decks,
  value,
  onChange,
  onMore,
  max = 8,
}: {
  decks: PickerDeck[]
  value: string | null
  onChange: (deckId: string) => void
  onMore: () => void
  max?: number
}) {
  const visible = useMemo(() => {
    const top = decks.slice(0, max)
    const selected = decks.find((deck) => deck.id === value)
    // A deck chosen from the full list shows up first, so the choice stays visible.
    return selected && !top.includes(selected) ? [selected, ...top.slice(0, max - 1)] : top
  }, [decks, value, max])
  return (
    <ChoiceGroup
      label="Mazo"
      className="-mx-4 flex snap-x scroll-px-4 gap-1.5 overflow-x-auto px-4 pt-0.5 pb-1.5 [scrollbar-width:thin]"
    >
      {visible.map((deck) => (
        <Button
          key={deck.id}
          type="button"
          variant="outline"
          aria-pressed={value === deck.id}
          className="shrink-0 snap-start aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:ring-2 aria-pressed:ring-primary"
          onClick={() => onChange(deck.id)}
        >
          <span className="max-w-52 truncate">{deck.name}</span>
          {deck.energies.length > 0 ? <EnergyChips energies={deck.energies as SelectableEnergy[]} /> : null}
        </Button>
      ))}
      <Button type="button" variant="ghost" className="shrink-0" onClick={onMore}>
        Otro mazo…
      </Button>
    </ChoiceGroup>
  )
}
