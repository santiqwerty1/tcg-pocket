import { Link } from 'react-router'
import { EmptyState } from '@/components/ListState'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <EmptyState
      title="Esta página no existe"
      description="Puede ser un enlace viejo o un mazo, una partida o una carta que ya no está."
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to="/partidas">Ir a Hoy</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/mazos">Mazos</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/coleccion">Colección</Link>
          </Button>
        </div>
      }
    />
  )
}
