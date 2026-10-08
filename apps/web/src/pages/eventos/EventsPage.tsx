/**
 * Eventos con restricciones (Fase 16): the events typed by the owner, newest first, and a new one. Nobody publishes
 * an event's deck rules, so they are typed by hand; the event page says which decks and which tournament lists
 * comply.
 */
import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useCreateEvent, useEvents } from '@/api/events'
import type { EventRules } from '@/api/schemas'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RulesForm } from './RulesForm'

export function EventsPage() {
  const events = useEvents()
  const create = useCreateEvent()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [rules, setRules] = useState<EventRules>({})
  const [bannedNames, setBannedNames] = useState<Record<string, string>>({})

  async function save() {
    try {
      const created = await create.mutateAsync({
        name,
        startsOn: startsOn || null,
        endsOn: endsOn || null,
        rules,
      })
      toast.success('Evento guardado')
      navigate(`/eventos/${created.id}`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Eventos"
        action={
          open ? null : (
            <Button size="sm" onClick={() => setOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              Nuevo
            </Button>
          )
        }
      >
        <p className="text-sm text-muted-foreground">
          Cargá las reglas de un evento del juego (tipos, sin ex, rarezas, expansiones, cartas prohibidas): la app te
          dice qué mazos tuyos cumplen, qué listas de torneo cumplen y podés armar, y el Laboratorio busca variantes sin
          romper las reglas.
        </p>
        {open ? (
          <div className="flex flex-col gap-4 rounded-lg border p-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-name">Nombre</Label>
              <Input id="event-name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="event-from">Desde</Label>
                <Input
                  id="event-from"
                  type="date"
                  value={startsOn}
                  onChange={(event) => setStartsOn(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="event-to">Hasta</Label>
                <Input id="event-to" type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
              </div>
            </div>
            <RulesForm
              rules={rules}
              onChange={setRules}
              bannedNames={bannedNames}
              onBannedName={(id, nameEs) => setBannedNames((current) => ({ ...current, [id]: nameEs }))}
            />
            <div className="flex gap-2">
              <Button type="button" disabled={!name.trim() || create.isPending} onClick={() => void save()}>
                Guardar
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : null}
      </Section>
      {events.isPending ? <LoadingRows rows={3} /> : null}
      {events.isError ? <ErrorState error={events.error} onRetry={() => events.refetch()} /> : null}
      {events.data && events.data.length === 0 && !open ? <EmptyState title="Todavía no cargaste eventos" /> : null}
      <ul className="divide-y rounded-lg border empty:hidden">
        {(events.data ?? []).map((event) => (
          <li key={event.id}>
            <Link to={`/eventos/${event.id}`} className="flex flex-col gap-0.5 px-3 py-2 hover:bg-muted">
              <span className="font-medium">{event.name}</span>
              <span className="text-xs text-muted-foreground">
                {event.startsOn || event.endsOn ? `${event.startsOn ?? '…'} → ${event.endsOn ?? '…'} · ` : ''}
                {event.rulesEs.join(' ')}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
