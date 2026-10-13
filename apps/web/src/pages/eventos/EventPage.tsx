/**
 * One event (Fase 16): its rules (editable), the decks that comply — with a button to search variants under the
 * same rules in the Laboratorio — the ones that do not and why, and the era's tournament lists that comply.
 */
import { FlaskConicalIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useDeleteEvent, useEvent, useUpdateEvent } from '@/api/events'
import { useLabExplore } from '@/api/lab'
import type { EventRules } from '@/api/schemas'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { missing } from '@/lib/format'
import { formatRateValue } from '@/lib/matches'
import { RulesForm } from './RulesForm'

export function EventPage() {
  const { id = '' } = useParams()
  const event = useEvent(id)
  const update = useUpdateEvent()
  const remove = useDeleteEvent()
  const explore = useLabExplore()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [rules, setRules] = useState<EventRules>({})
  const [bannedNames, setBannedNames] = useState<Record<string, string>>({})
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (event.isPending) return <LoadingRows rows={5} />
  if (event.isError) return <ErrorState error={event.error} onRetry={() => event.refetch()} />
  const data = event.data
  const ok = data.decks.filter((deck) => deck.ok)
  const notOk = data.decks.filter((deck) => !deck.ok)

  async function saveRules() {
    try {
      await update.mutateAsync({ id, patch: { rules } })
      await event.refetch()
      setEditing(false)
      toast.success('Reglas guardadas')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function search(deckId: string) {
    try {
      const job = await explore.mutateAsync({ deck: { deckId }, eventId: id })
      toast.success(`Búsqueda #${job.id} en cola`)
      navigate(`/laboratorio/${job.id}`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Section
        title={data.name}
        action={
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setRules(data.rules)
                setEditing(!editing)
              }}
            >
              <PencilIcon data-icon="inline-start" />
              Reglas
            </Button>
            <Button size="sm" variant="ghost" aria-label="Borrar el evento" onClick={() => setConfirmDelete(true)}>
              <Trash2Icon />
            </Button>
          </div>
        }
      >
        {data.startsOn || data.endsOn ? (
          <p className="text-xs text-muted-foreground">
            {data.startsOn ?? '…'} → {data.endsOn ?? '…'}
          </p>
        ) : null}
        <ul className="list-inside list-disc text-sm">
          {data.rulesEs.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {editing ? (
          <div className="flex flex-col gap-3 rounded-lg border p-3">
            <RulesForm
              rules={rules}
              onChange={setRules}
              bannedNames={bannedNames}
              onBannedName={(groupId, nameEs) => setBannedNames((current) => ({ ...current, [groupId]: nameEs }))}
            />
            <div className="flex gap-2">
              <Button type="button" disabled={update.isPending} onClick={() => void saveRules()}>
                Guardar reglas
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : null}
      </Section>

      <Section title={`Tus mazos que cumplen (${ok.length})`}>
        {ok.length === 0 ? <p className="text-sm text-muted-foreground">Ninguno cumple tal como está.</p> : null}
        <ul className="divide-y rounded-lg border empty:hidden">
          {ok.map((deck) => (
            <li key={deck.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <Link to={`/mazos/${deck.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                {deck.name}
              </Link>
              {deck.builtInGame ? <span className="text-xs text-muted-foreground">armado</span> : null}
              <Button size="sm" variant="outline" disabled={explore.isPending} onClick={() => void search(deck.id)}>
                <FlaskConicalIcon data-icon="inline-start" />
                Buscar variantes
              </Button>
            </li>
          ))}
        </ul>
        {ok.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            «Buscar variantes» lanza una búsqueda del Laboratorio que solo prueba cartas que el evento permite.
          </p>
        ) : null}
      </Section>

      <Section title={`Listas de torneo que cumplen (${data.lists.length}${data.era ? `, era ${data.era}` : ''})`}>
        {data.lists.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ninguna lista exacta de la era cumple las reglas.</p>
        ) : null}
        <ul className="divide-y rounded-lg border empty:hidden">
          {data.lists.map((list) => (
            <li key={list.key} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
              <div className="flex items-baseline gap-2">
                <Link
                  to={`/torneos/listas/${list.key}`}
                  className="min-w-0 flex-1 truncate font-medium hover:underline"
                >
                  {list.archetype ?? 'Sin arquetipo'}
                </Link>
                <span className="shrink-0 text-xs tabular">
                  {list.missingCopies === 0 ? 'la podés armar' : missing(list.missingCopies)}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {list.pokemon.slice(0, 5).join(', ')} · {list.lists} {list.lists === 1 ? 'lista' : 'listas'}
                {list.rate ? ` · ${formatRateValue(list.rate.value)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`No cumplen (${notOk.length})`}>
        <details className="rounded-lg border">
          <summary className="cursor-pointer px-3 py-2 text-sm select-none">Ver por qué</summary>
          <ul className="divide-y border-t">
            {notOk.map((deck) => (
              <li key={deck.id} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
                <Link to={`/mazos/${deck.id}`} className="font-medium hover:underline">
                  {deck.name}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {deck.problems.slice(0, 3).join(' · ')}
                  {deck.problems.length > 3 ? ` · y ${deck.problems.length - 3} más` : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </Section>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`¿Borrar «${data.name}»?`}
        description="Se borran el evento y sus reglas. Los mazos no se tocan."
        confirmLabel="Borrar"
        destructive
        onConfirm={() =>
          remove.mutate(id, {
            onSuccess: () => {
              toast.success('Evento borrado')
              navigate('/eventos')
            },
            onError: (error) => toast.error(errorMessage(error)),
          })
        }
      />
    </div>
  )
}
