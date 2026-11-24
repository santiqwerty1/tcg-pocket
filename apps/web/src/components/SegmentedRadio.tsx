import { RadioGroup } from 'radix-ui'
import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  /**
   * The option cannot be taken now. It stays in reach of the keyboard and of a screen reader (`aria-disabled`, not
   * `disabled`), so choosing it can say why: `onRefused` gets it instead of `onChange`.
   */
  unavailable?: boolean
}

/**
 * One choice among a few, as a row of segments (the `.seg` of mock-up D). A radio group: one Tab stop, and the arrows
 * move and choose. Radix gives the roles and the keyboard.
 */
export function SegmentedRadio<T extends string>({
  label,
  describedBy,
  value,
  options,
  onChange,
  onRefused,
  className,
}: {
  /** The name of the group, for a screen reader. */
  label: string
  /** The id of the line that says where the choice stands, read with the group. */
  describedBy?: string
  value: T
  options: readonly SegmentedOption<T>[]
  onChange: (value: T) => void
  onRefused?: (value: T) => void
  className?: string
}) {
  return (
    <RadioGroup.Root
      aria-label={label}
      aria-describedby={describedBy}
      // Controlled: an option that is refused never becomes the checked one.
      value={value}
      onValueChange={(next) => {
        const option = options.find((candidate) => candidate.value === next)
        if (!option) return
        if (option.unavailable) onRefused?.(option.value)
        else onChange(option.value)
      }}
      className={cn(
        'grid auto-cols-fr grid-flow-col gap-0.5 rounded-[14px] border border-input bg-surface-3 p-0.5',
        className,
      )}
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          aria-disabled={option.unavailable ? true : undefined}
          // A label may take two lines on a narrow phone: the height is a minimum.
          className="min-h-11 rounded-[11px] px-1.5 text-[15px] leading-[1.1] font-semibold text-foreground-2 transition-[background-color,color] duration-(--dur-2) ease-(--ease) outline-none select-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:opacity-45 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
        >
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  )
}
