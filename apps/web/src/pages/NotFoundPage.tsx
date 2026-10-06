import { Link } from 'react-router'
import { EmptyState } from '@/components/ListState'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <EmptyState
      title="Esta página no existe"
      action={
        <Button asChild>
          <Link to="/coleccion">Ir a la colección</Link>
        </Button>
      }
    />
  )
}
