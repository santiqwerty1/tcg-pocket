import { MinusIcon, PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface StepperProps {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  disabled?: boolean
  label: string
  className?: string
}

/** − value + with 44 px targets, for owned copies and deck counts. */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  disabled,
  label,
  className,
}: StepperProps) {
  return (
    <fieldset className={cn('inline-flex items-center gap-1', className)}>
      <legend className="sr-only">{label}</legend>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={`Restar uno a ${label}`}
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <MinusIcon />
      </Button>
      <span className="min-w-8 text-center text-lg font-semibold tabular" aria-live="polite">
        {value}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={`Sumar uno a ${label}`}
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <PlusIcon />
      </Button>
    </fieldset>
  )
}
