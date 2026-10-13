import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useCommitDecks, useImportDecks } from '@/api/decks'
import {
  DECK_IMPORT_FORMATS,
  type DeckImportFormat,
  type DeckInput,
  type ImportedCard,
  type ImportedDeckDraft,
  type SelectableEnergy,
} from '@/api/schemas'
import { EnergyPicker } from '@/components/EnergyChip'
import { IssueList } from '@/components/IssueList'
import { ErrorState, Spinner } from '@/components/ListState'
import { Field, Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { missing } from '@/lib/format'
import { forgetSharedText, sharedText } from '@/lib/shared'
import { cn } from '@/lib/utils'
import { draftTitle, draftToDeckInput, isDraftReady, needsEnergyChoice, totalCount } from './deckLogic'

const FORMAT_LABEL: Record<DeckImportFormat, string> = {
  auto: 'Detectar automáticamente',
  spanish: 'Texto en español (- Pokémon: / - Entrenadores:)',
  'spanish-file': 'Archivo completo de 40 mazos (con tabla resumen)',
  limitless: 'Limitless / deckgym',
  json: 'JSON',
}

const PLACEHOLDER = `### 6. Mega-Lucario ex / Lucario
- Pokémon: 1 Riolu (A2-91), 1 Riolu (B3-79), 2 Mega-Lucario ex (B3-81), 1 Lucario (A2-92), 1 Bonsly (B3-168), 1 Hitmonlee (A1-154)
- Entrenadores: 2 Investigación de Profesores, 2 Copiona, 2 Poké Ball, 1 Corelia, 1 Chica del Centro Pokémon, 1 Helio, 1 Velocidad X, 1 Helado Suerte, 1 Soplador de Campo, 1 Arena Arcaica
- Energía: Lucha

…o pegá el texto de Limitless:
2 Riolu A2 91
Energy: Fighting`

/** Keys for the card lines: the same edition may appear more than once in an imported list. */
function ImportedCardList({
  cards,
  fallback,
}: {
  cards: ImportedCard[]
  fallback: { cardId: string; count: number }[]
}) {
  // Older API responses carry only ids; show them as they are.
  if (cards.length === 0) {
    return (
      <ul className="mt-1 columns-2 text-sm">
        {withKeys(fallback).map(({ key, entry }) => (
          <li key={key} className="font-mono text-xs">
            {entry.count} × {entry.cardId}
          </li>
        ))}
      </ul>
    )
  }
  const groups: { label: string; items: ImportedCard[] }[] = [
    { label: 'Pokémon', items: cards.filter((c) => c.cardType !== 'trainer') },
    { label: 'Entrenadores', items: cards.filter((c) => c.cardType === 'trainer') },
  ].filter((g) => g.items.length > 0)
  return (
    <div className="mt-1 space-y-2 text-sm">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="text-xs font-medium text-muted-foreground">
            {group.label} · {group.items.reduce((n, c) => n + c.count, 0)}
          </div>
          <ul>
            {withKeys(group.items).map(({ key, entry }) => (
              <li key={key} className="flex items-baseline gap-2">
                <span className="w-6 text-right font-mono text-xs">{entry.count}×</span>
                <span>{entry.nameEs}</span>
                <span className="font-mono text-xs text-muted-foreground">{entry.cardId}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function withKeys<T extends { cardId: string }>(entries: readonly T[]): { key: string; entry: T }[] {
  const seen = new Map<string, number>()
  return entries.map((entry) => {
    const n = (seen.get(entry.cardId) ?? 0) + 1
    seen.set(entry.cardId, n)
    return { key: `${entry.cardId}#${n}`, entry }
  })
}

interface DraftState {
  selected: boolean
  energies: SelectableEnergy[]
}

export function DeckImportPage() {
  const navigate = useNavigate()
  const location = useLocation()
  // «Importar como mazo» from a tournament list arrives with its Limitless text.
  const [text, setText] = useState(() => {
    const state = location.state as { text?: unknown } | null
    return typeof state?.text === 'string' ? state.text : ''
  })
  const [format, setFormat] = useState<DeckImportFormat>('auto')
  // Fase 41: a deck shared from a chat or a text file (manifest `share_target`) fills the box; it is forgotten once
  // it was analyzed, so an expired session in between does not lose it.
  const [params] = useSearchParams()
  const shared = params.get('compartido') === '1'
  const [fromShare, setFromShare] = useState(false)
  // A share that arrived while the box already had text: offered, never mixed in or forgotten silently.
  const [waitingShare, setWaitingShare] = useState<string | null>(null)
  const textRef = useRef(text)
  textRef.current = text
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new share (another `?compartido=1`) checks again.
  useEffect(() => {
    let cancelled = false
    void sharedText().then((found) => {
      if (cancelled || !found) return
      if (textRef.current.trim()) {
        setWaitingShare(found)
        return
      }
      setText(found)
      setFromShare(true)
    })
    return () => {
      cancelled = true
    }
  }, [shared])
  const importDecks = useImportDecks()
  const commit = useCommitDecks()
  const [drafts, setDrafts] = useState<ImportedDeckDraft[] | null>(null)
  const [states, setStates] = useState<DraftState[]>([])

  async function analyze() {
    try {
      const result = await importDecks.mutateAsync({ text, format })
      if (fromShare) {
        setFromShare(false)
        void forgetSharedText()
      }
      setDrafts(result.drafts)
      setStates(
        result.drafts.map((draft) => {
          const energies = draft.draft?.energies ?? []
          return { selected: isDraftReady(draft, energies), energies }
        }),
      )
      if (result.drafts.length === 0) toast.warning('No se encontró ningún mazo en el texto.')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  function updateState(index: number, partial: Partial<DraftState>) {
    setStates((prev) => prev.map((s, i) => (i === index ? { ...s, ...partial } : s)))
  }

  const inputs: DeckInput[] = (drafts ?? []).flatMap((draft, index) => {
    const state = states[index]
    if (!state?.selected || !isDraftReady(draft, state.energies)) return []
    const input = draftToDeckInput(draft, index, state.energies)
    return input ? [input] : []
  })

  async function createDecks() {
    try {
      const result = await commit.mutateAsync(inputs)
      toast.success(result.created.length === 1 ? 'Se creó 1 mazo' : `Se crearon ${result.created.length} mazos`)
      navigate('/mazos')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Section title="Pegá las listas">
        {waitingShare ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3 text-sm">
            <span className="min-w-0 flex-1">Hay un mazo compartido que todavía no se importó.</span>
            <Button
              size="sm"
              onClick={() => {
                setText(waitingShare)
                setFromShare(true)
                setWaitingShare(null)
              }}
            >
              Usarlo
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setWaitingShare(null)
                void forgetSharedText()
              }}
            >
              Descartar
            </Button>
          </div>
        ) : null}
        <Field label="Texto" htmlFor="deck-import-text">
          <Textarea
            id="deck-import-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={PLACEHOLDER}
            rows={12}
            className="font-mono text-sm"
            spellCheck={false}
          />
        </Field>
        <Field label="Formato">
          <Select value={format} onValueChange={(value) => setFormat(value as DeckImportFormat)}>
            <SelectTrigger className="w-full" aria-label="Formato">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DECK_IMPORT_FORMATS.map((value) => (
                <SelectItem key={value} value={value}>
                  {FORMAT_LABEL[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Button size="lg" onClick={analyze} disabled={text.trim().length === 0 || importDecks.isPending}>
          {importDecks.isPending ? <Spinner /> : null}
          Analizar
        </Button>
        {importDecks.isError ? <ErrorState error={importDecks.error} /> : null}
      </Section>

      {drafts && drafts.length > 0 ? (
        <Section title={`Vista previa (${drafts.length})`}>
          <ul className="flex flex-col gap-3">
            {drafts.map((draft, index) => {
              const state = states[index] ?? { selected: false, energies: [] }
              const ready = isDraftReady(draft, state.energies)
              const cardCount = draft.draft ? totalCount(draft.draft.cards) : 0
              return (
                <li
                  key={`${draft.number ?? index}-${draft.title ?? ''}`}
                  className={cn('rounded-lg border p-3', !ready && 'border-destructive/40')}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      className="mt-1"
                      checked={state.selected}
                      disabled={!ready}
                      onCheckedChange={(checked) => updateState(index, { selected: checked === true })}
                      aria-label={`Crear ${draftTitle(draft, index)}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {draft.number !== null && draft.number !== undefined ? `${draft.number}. ` : ''}
                        {draftTitle(draft, index)}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant={cardCount === 20 ? 'outline' : 'destructive'}>{cardCount} cartas</Badge>
                        {draft.validation ? (
                          draft.validation.ok ? (
                            <Badge variant="outline" className="text-success">
                              válido
                            </Badge>
                          ) : (
                            <Badge variant="destructive">
                              {draft.validation.errors.length === 1
                                ? '1 error'
                                : `${draft.validation.errors.length} errores`}
                            </Badge>
                          )
                        ) : null}
                        {draft.completeness ? (
                          draft.completeness.complete ? (
                            <Badge variant="outline" className="text-success">
                              completo
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-warning">
                              {missing(draft.completeness.missingCount)}
                            </Badge>
                          )
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {draft.draft ? (
                    <div className="mt-2 flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">
                        {needsEnergyChoice(draft) ? 'Elegí la energía (la lista no la define):' : 'Energía:'}
                      </span>
                      <EnergyPicker
                        value={state.energies}
                        onChange={(energies) =>
                          updateState(index, { energies, selected: isDraftReady(draft, energies) })
                        }
                        label={`Energías de ${draftTitle(draft, index)}`}
                      />
                    </div>
                  ) : null}

                  {draft.draft ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm text-muted-foreground select-none">
                        Ver las {cardCount} cartas
                      </summary>
                      <ImportedCardList cards={draft.cards} fallback={draft.draft.cards} />
                    </details>
                  ) : null}

                  {draft.errors.length > 0 ? (
                    <div className="mt-2">
                      <IssueList
                        level="error"
                        issues={draft.errors.map((issue) => ({
                          code: issue.code,
                          message: issue.candidates?.length
                            ? `${issue.message} (${issue.candidates.join(', ')})`
                            : issue.message,
                        }))}
                      />
                    </div>
                  ) : null}
                  {draft.warnings.length > 0 ? (
                    <div className="mt-2">
                      <IssueList level="warning" issues={draft.warnings} />
                    </div>
                  ) : null}
                  {draft.validation && !draft.validation.ok ? (
                    <div className="mt-2">
                      <IssueList level="error" issues={draft.validation.errors} />
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>

          <div className="sticky bottom-20 z-20 flex gap-2 rounded-lg border bg-background/95 p-2 backdrop-blur">
            <Button
              className="flex-1"
              size="lg"
              onClick={createDecks}
              disabled={inputs.length === 0 || commit.isPending}
            >
              {commit.isPending ? <Spinner /> : null}
              {inputs.length === 1 ? 'Crear 1 mazo' : `Crear ${inputs.length} mazos`}
            </Button>
          </div>
        </Section>
      ) : null}
    </div>
  )
}
