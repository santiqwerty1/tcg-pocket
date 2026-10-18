/**
 * Clasificar rivales (pedido de Santi del 14/10): the matches without a rival and with cards seen, grouped by similar
 * cards, each group with the era's archetypes its cards suggest, to give it one rival — an archetype's name or one of
 * the owner's own («Greninja Suicune»). Below, the rivals typed that are no archetype of the era, to move them to one or
 * rename them (reclassifying). Statistics by rival, «¿mala racha?» and «mi meta» read the rival from there.
 */
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { type Classified, undoClassify, useClassify, useUnclassified } from '@/api/matches'
import type { Unclassified } from '@/api/schemas'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDateTime } from '@/lib/format'
import { RESULT_LABEL } from '@/lib/matches'

/** A text box and «Asignar»: the name typed goes to every match given. */
function AssignName({
  label,
  onAssign,
  pending,
}: {
  label: string
  onAssign: (name: string) => void
  pending: boolean
}) {
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        const input = event.currentTarget.elements.namedItem('rival') as HTMLInputElement
        if (input.value.trim()) onAssign(input.value.trim())
      }}
    >
      <Input name="rival" aria-label={label} placeholder="Otro nombre, ej.: Greninja Suicune" maxLength={80} />
      <Button type="submit" variant="secondary" disabled={pending}>
        Asignar
      </Button>
    </form>
  )
}

/** Codex on #114: matches edited since are left as they are. */
function changedSince(count: number) {
  return count === 1
    ? 'Una partida cambió mientras tanto y la dejé como estaba.'
    : `${count} partidas cambiaron mientras tanto y las dejé como estaban.`
}

/** «Deshacer» on the toast: each match gets back the rival it had (self-review: a merge could not be told apart). */
function undoAction(done: Classified, queryClient: QueryClient) {
  return {
    label: 'Deshacer',
    onClick: () => {
      undoClassify(done, queryClient)
        .then((skipped) => {
          if (skipped > 0) toast.info(changedSince(skipped))
        })
        .catch((error) => toast.error(errorMessage(error)))
    },
  }
}

function Group({ group }: { group: Unclassified['groups'][number] }) {
  const classify = useClassify()
  const queryClient = useQueryClient()
  const matchIds = group.matches.map((match) => match.id)
  async function assign(opponent: string) {
    try {
      // Only the ones still without a rival (an edit since the list was read stays).
      const done = await classify.mutateAsync({ matchIds, opponent, expect: null })
      if (done.skipped.length > 0) toast.info(changedSince(done.skipped.length))
      // Deuda de #114: nothing changed (every match was edited or deleted since), nothing to undo.
      if (done.updated > 0) {
        toast.success(`${done.updated === 1 ? 'Una partida' : `${done.updated} partidas`} contra ${done.opponent}.`, {
          action: undoAction(done, queryClient),
        })
      }
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-sm font-medium">{group.text}</p>
      <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        {group.matches.map((match) => (
          <li key={match.id}>
            <Link to={`/partidas/${match.id}`} className="hover:underline">
              {formatDateTime(match.playedAt)} · {RESULT_LABEL[match.result]} con {match.deck.name}
            </Link>
          </li>
        ))}
      </ul>
      {group.suggestions.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">
            {group.suggestions[0]?.kind === 'fits'
              ? 'Arquetipos que las juegan:'
              : 'Ninguno encaja del todo; los más parecidos:'}
          </p>
          <ul className="flex flex-col gap-1">
            {group.suggestions.slice(0, 3).map((fit) => (
              <li key={fit.archetypeId}>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto w-full flex-col items-start gap-0 py-1.5 text-left whitespace-normal"
                  disabled={classify.isPending}
                  onClick={() => assign(fit.name)}
                >
                  <span className="font-medium">{fit.name}</span>
                  <span className="text-xs text-muted-foreground">{fit.text}</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Ninguna lista de la era juega esas cartas.</p>
      )}
      <AssignName label="Nombre para estas partidas" onAssign={assign} pending={classify.isPending} />
    </li>
  )
}

function OwnRival({ rival }: { rival: Unclassified['own'][number] }) {
  const classify = useClassify()
  const queryClient = useQueryClient()
  // Self-review: renaming changes every match of the rival (every mode and era); it asks first.
  const [target, setTarget] = useState<string | null>(null)
  async function move(opponent: string) {
    try {
      const done = await classify.mutateAsync({ from: rival.label, opponent })
      setTarget(null)
      const text = `${rival.label} → ${done.opponent} (${done.updated === 1 ? 'una partida' : `${done.updated} partidas`}).`
      // Deuda de #114: no «Deshacer» when no match changed.
      if (done.updated > 0) toast.success(text, { action: undoAction(done, queryClient) })
      else toast.info(`${rival.label}: ninguna partida cambió.`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  const games = rival.games === 1 ? 'una partida' : `${rival.games} partidas`
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border p-3">
      <p className="text-sm">
        <span className="font-medium">{rival.label}</span> <span className="text-muted-foreground">· {games}</span>
      </p>
      <AssignName label={`Nuevo nombre para ${rival.label}`} onAssign={setTarget} pending={classify.isPending} />
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null)
        }}
        title={`¿Pasar ${rival.label} a ${target ?? ''}?`}
        description={`Cambia el rival de ${games}, de todas las modalidades y eras. Si ${target ?? ''} ya tiene partidas, se juntan con estas; podés deshacerlo desde el aviso.`}
        confirmLabel="Cambiar"
        pending={classify.isPending}
        onConfirm={() => (target ? move(target) : undefined)}
      />
    </li>
  )
}

export function ClassifyRivalsPage() {
  const unclassified = useUnclassified()
  const data = unclassified.data
  return (
    <div className="flex flex-col gap-6">
      <Section title="Partidas sin clasificar">
        <p className="text-sm text-muted-foreground">
          Las partidas sin rival y con cartas vistas, agrupadas por cartas parecidas. Elegí el arquetipo o escribí un
          nombre propio: las estadísticas por rival, «¿mala racha?» y «mi meta» lo toman de acá.
        </p>
        {unclassified.isPending ? <LoadingRows rows={3} /> : null}
        {unclassified.isError ? <ErrorState error={unclassified.error} onRetry={() => unclassified.refetch()} /> : null}
        {data && data.groups.length === 0 ? (
          <EmptyState
            title="Nada para clasificar"
            description="Cuando cargues una partida con «Cartas que vi» y sin rival, aparece acá."
          />
        ) : null}
        {data && data.groups.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {data.groups.map((group) => (
              <Group key={group.matches.map((match) => match.id).join(',')} group={group} />
            ))}
          </ul>
        ) : null}
      </Section>
      {data && data.own.length > 0 ? (
        <Section title="Tus rivales propios">
          <p className="text-sm text-muted-foreground">
            Rivales que anotaste y no son arquetipos de la era {data.era}. Podés pasarlos a un arquetipo o cambiarles el
            nombre: cambia en todas sus partidas.
          </p>
          <ul className="flex flex-col gap-3">
            {data.own.map((rival) => (
              <OwnRival key={rival.key} rival={rival} />
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  )
}
