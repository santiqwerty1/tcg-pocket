/** Notas por rival (Fase 12): the note shown read-only (quick entry) or with its editor (archetype page, list). */
import { NotebookPenIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useDeleteRivalNote, useRivalNote, useSaveRivalNote } from '@/api/rivals'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/**
 * Read-only, under the opponent field of the quick entry: only when there is a note. The quick entry keys it by the
 * rival, so another rival starts fresh; `onEditingChange` tells it a note is being edited, so the match is not saved
 * (and the form reset) over a note that was not saved yet.
 */
export function RivalNoteHint({
  opponent,
  onEditingChange,
}: {
  opponent: string
  onEditingChange?: (editing: boolean) => void
}) {
  const note = useRivalNote(opponent.trim() || null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    onEditingChange?.(editing)
  }, [editing, onEditingChange])
  // Leaving (another rival, the form reset) never leaves the quick entry thinking a note is still open.
  useEffect(() => () => onEditingChange?.(false), [onEditingChange])
  if (editing) {
    return (
      <div className="rounded-lg border border-dashed px-3 py-2">
        <RivalNoteEditor opponent={opponent.trim()} startEditing onDone={() => setEditing(false)} />
      </div>
    )
  }
  if (!note) return null
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-dashed px-3 py-2 text-sm">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <NotebookPenIcon className="size-3.5" aria-hidden="true" />
        Tu nota contra {note.label}
      </span>
      <p className={cn('whitespace-pre-wrap', !open && 'line-clamp-3')}>{note.text}</p>
      <span className="flex gap-3 text-xs">
        {note.text.length > 160 ? (
          <button type="button" className="text-primary hover:underline" onClick={() => setOpen(!open)}>
            {open ? 'Ver menos' : 'Ver todo'}
          </button>
        ) : null}
        {/* Fase 41: edited right here, so the half-filled match stays as it was. */}
        <button type="button" className="text-primary hover:underline" onClick={() => setEditing(true)}>
          Editar nota
        </button>
      </span>
    </div>
  )
}

/** The note with its editor: write, save, delete. */
export function RivalNoteEditor({
  opponent,
  archetypeId,
  startEditing = false,
  onDone,
}: {
  opponent: string
  archetypeId?: string | null
  startEditing?: boolean
  /** Called after saving or cancelling (the quick entry closes the editor). */
  onDone?: () => void
}) {
  const note = useRivalNote(opponent)
  const save = useSaveRivalNote()
  const remove = useDeleteRivalNote()
  const [editing, setEditing] = useState(startEditing)
  const [text, setText] = useState(note?.text ?? '')
  useEffect(() => {
    if (!editing) setText(note?.text ?? '')
  }, [note?.text, editing])

  async function submit() {
    try {
      await save.mutateAsync({ opponent, text, ...(archetypeId === undefined ? {} : { archetypeId }) })
      toast.success(text.trim() ? 'Nota guardada' : 'Nota borrada')
      setEditing(false)
      onDone?.()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        <Textarea
          aria-label={`Nota contra ${opponent}`}
          value={text}
          rows={5}
          maxLength={5000}
          placeholder="Cómo jugarle: qué guardar, a qué atacar primero, qué carta suya temer…"
          onChange={(event) => setText(event.target.value)}
        />
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={save.isPending} onClick={() => void submit()}>
            Guardar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false)
              onDone?.()
            }}
          >
            Cancelar
          </Button>
        </div>
      </div>
    )
  }
  if (!note) {
    return (
      <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setEditing(true)}>
        <NotebookPenIcon data-icon="inline-start" />
        Escribir una nota
      </Button>
    )
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border px-3 py-2">
      <p className="text-sm whitespace-pre-wrap">{note.text}</p>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
          <PencilIcon data-icon="inline-start" />
          Editar
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(note.key, {
              onSuccess: () => toast.success('Nota borrada'),
              onError: (error) => toast.error(errorMessage(error)),
            })
          }
        >
          <Trash2Icon data-icon="inline-start" />
          Borrar
        </Button>
      </div>
    </div>
  )
}
