import { useExpansions } from '@/api/catalog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const ALL = '__all__'

export function ExpansionSelect({
  value,
  onChange,
  className,
}: {
  value: string | undefined
  onChange: (expansionId: string | undefined) => void
  className?: string
}) {
  const expansions = useExpansions()
  return (
    <Select value={value ?? ALL} onValueChange={(next) => onChange(next === ALL ? undefined : next)}>
      <SelectTrigger className={className} aria-label="Expansión">
        <SelectValue placeholder="Expansión" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Todas las expansiones</SelectItem>
        {(expansions.data ?? []).map((expansion) => (
          <SelectItem key={expansion.id} value={expansion.id}>
            {expansion.id} · {expansion.nameEs}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
