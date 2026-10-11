import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import type { JobSummary } from '@/api/schemas'
import { useSimulationPriority } from '@/api/simulations'
import { Button } from '@/components/ui/button'
import { isActive } from '@/lib/simulation'

export function SimulationPriorityButton({ job }: { job: JobSummary }) {
  const mutation = useSimulationPriority()
  if (!isActive(job.status)) return null
  const raised = job.priority > 0
  const label = raised ? 'Volver a normal' : 'Adelantar'
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={mutation.isPending}
      aria-label={`${label} #${job.id}`}
      onClick={() =>
        mutation.mutate(
          { id: job.id, priority: raised ? 0 : 1 },
          {
            onSuccess: () => toast.success(raised ? 'Simulación con prioridad normal' : 'Simulación adelantada'),
            onError: (error) => toast.error(errorMessage(error)),
          },
        )
      }
    >
      {label}
    </Button>
  )
}
