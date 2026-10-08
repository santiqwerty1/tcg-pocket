/**
 * Notas por rival (Fase 12): every note, and a new one by name. A note belongs to the rival's name without minding
 * case, accents or hyphens, so it shows up when a match is logged against that rival and on its archetype page.
 */
import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { useRivalNotes } from '@/api/rivals'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { RivalNoteEditor } from '@/components/RivalNote'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDateTime } from '@/lib/format'

export function RivalNotesPage() {
  const notes = useRivalNotes()
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <Section title="Notas por rival">
        <p className="text-sm text-muted-foreground">
          Cómo jugarle a cada rival. La nota aparece al cargar una partida contra él y en su arquetipo de Torneos;
          Claude también la lee.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (draft.trim()) setAdding(draft.trim())
          }}
        >
          <Input
            aria-label="Rival"
            placeholder="Rival (arquetipo)"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" variant="outline" disabled={!draft.trim()}>
            <PlusIcon data-icon="inline-start" />
            Nueva
          </Button>
        </form>
        {adding ? (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{adding}</span>
            <RivalNoteEditor opponent={adding} startEditing />
          </div>
        ) : null}
      </Section>
      {notes.isPending ? <LoadingRows rows={3} /> : null}
      {notes.isError ? <ErrorState error={notes.error} onRetry={() => notes.refetch()} /> : null}
      {notes.data && notes.data.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">Todavía no escribiste ninguna nota.</p>
      ) : null}
      <ul className="flex flex-col gap-4">
        {(notes.data ?? []).map((note) => (
          <li key={note.key} className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate font-medium">{note.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(note.updatedAt)}</span>
            </div>
            <RivalNoteEditor opponent={note.label} />
          </li>
        ))}
      </ul>
    </div>
  )
}
