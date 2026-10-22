import { ClipboardCopyIcon, FileUpIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { ApiError, errorMessage } from '@/api/client'
import type { MatchMode } from '@/api/schemas'
import { MATCH_MODES } from '@/api/schemas'
import {
  type SheetImportApplied,
  type SheetImportPreview,
  type SheetImportRequest,
  type SheetImportRow,
  type SheetRowStatus,
  useSheetImportApply,
  useSheetImportPreview,
} from '@/api/sheetImport'
import { Spinner } from '@/components/ListState'
import { Fold, Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatNumber, plural } from '@/lib/format'
import { MODE_LABEL, RESULT_LABEL } from '@/lib/matches'

const STATUS_LABEL: Record<SheetRowStatus, string> = {
  new: 'Nueva',
  in_app: 'Ya en la app',
  duplicate: 'Ya importada',
  possible_duplicate: 'Posible repetida',
  unmapped: 'Sin mazo',
  error: 'Con errores',
}

const DELIMITER_LABEL = { comma: 'comas', semicolon: 'punto y coma', tab: 'tabulaciones' } as const

const RANK_ACTION: Record<'note' | 'same' | 'skip', string> = {
  note: 'se anota',
  same: 'ya estaba',
  skip: 'no se anota',
}

/** The day and time of a row as the owner reads it («19/10 21:40»), in his time zone. */
const SHORT = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function statusVariant(status: SheetRowStatus) {
  if (status === 'new') return 'default' as const
  if (status === 'error' || status === 'unmapped') return 'destructive' as const
  if (status === 'possible_duplicate') return 'outline' as const
  return 'secondary' as const
}

/** One row of the sheet: what it says and what the import does with it. */
function RowCard({
  row,
  included,
  onInclude,
}: {
  row: SheetImportRow
  included: boolean
  onInclude: (row: number, include: boolean) => void
}) {
  const turn = row.wentFirst === null ? null : row.wentFirst ? 'empecé yo' : 'empezó el rival'
  return (
    <li className="flex min-w-0 flex-col gap-1 px-3 py-2 text-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium tabular">Fila {row.row}</span>
        <Badge variant={statusVariant(row.status)}>
          {STATUS_LABEL[row.status]}
          {row.matchId ? ` · n.º ${row.matchId}` : ''}
        </Badge>
        <span className="min-w-0 break-words text-muted-foreground">
          {row.code ?? 'sin código'}
          {row.deck ? ` → ${row.deck.name}` : ''}
        </span>
      </div>
      {row.status !== 'in_app' && row.status !== 'duplicate' ? (
        <>
          <p className="break-words">
            {[
              row.result ? RESULT_LABEL[row.result] : null,
              turn,
              row.playedAt ? SHORT.format(new Date(row.playedAt)) : row.dateText || null,
            ]
              .filter(Boolean)
              .join(' · ')}
            {row.opponent ? ` · contra ${row.opponent}` : ''}
          </p>
          {row.note ? <p className="line-clamp-2 break-words text-muted-foreground">{row.note}</p> : null}
          {row.rank ? (
            <p className="text-muted-foreground">
              Rango: {row.rank.label}
              {row.rank.action ? ` (${RANK_ACTION[row.rank.action]})` : ''}
            </p>
          ) : null}
        </>
      ) : null}
      {row.errors.map((error) => (
        <p key={error} className="break-words text-destructive">
          {error}
        </p>
      ))}
      {row.warnings.map((warning) => (
        <p key={warning} className="break-words text-warning">
          {warning}
        </p>
      ))}
      {row.status === 'possible_duplicate' && row.duplicateOf ? (
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            className="size-5 shrink-0"
            checked={included}
            onChange={(event) => onInclude(row.row, event.target.checked)}
          />
          <span className="min-w-0 break-words">Importarla igual (se parece a la {row.duplicateOf.text})</span>
        </label>
      ) : null}
    </li>
  )
}

/** The text for column K, ready to copy, with where to paste it. */
function ColumnK({ columnK }: { columnK: NonNullable<SheetImportPreview['columnK']> }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(columnK.text)
      toast.success('Números copiados')
    } catch {
      toast.error('No se pudo copiar; mantené apretado el texto para copiarlo.')
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Pegalo en la columna K desde la fila {columnK.firstRow} (celda K{columnK.firstRow}): una línea por fila; las que
        no entraron quedan vacías y las que ya tenían número lo conservan.
      </p>
      <Textarea
        readOnly
        aria-label="Números para la columna K"
        value={columnK.text}
        rows={Math.min(12, columnK.text.split('\n').length)}
        className="font-mono text-sm tabular"
      />
      <Button variant="outline" onClick={() => void copy()} className="self-start">
        <ClipboardCopyIcon data-icon="inline-start" />
        Copiar los números
      </Button>
    </div>
  )
}

function Summary({ data }: { data: SheetImportPreview }) {
  const { counts } = data
  const parts = [
    plural(counts.new, 'nueva', 'nuevas'),
    counts.inApp ? `${formatNumber(counts.inApp)} ya en la app (columna K)` : null,
    counts.duplicate ? `${formatNumber(counts.duplicate)} ya importadas antes` : null,
    counts.possibleDuplicate ? plural(counts.possibleDuplicate, 'posible repetida', 'posibles repetidas') : null,
    counts.unmapped ? `${formatNumber(counts.unmapped)} sin mazo` : null,
    counts.errors ? `${formatNumber(counts.errors)} con errores` : null,
    counts.warnings ? `${formatNumber(counts.warnings)} con avisos` : null,
  ].filter(Boolean)
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p>
        {plural(counts.rows, 'fila', 'filas')} con datos
        {data.delimiter ? ` (separadas por ${DELIMITER_LABEL[data.delimiter]}` : ''}
        {data.headerRow ? `, encabezados en la fila ${data.headerRow})` : data.delimiter ? ')' : ''}:{' '}
        {parts.join(' · ')}.
      </p>
      {counts.write > 0 ? (
        <p className="font-medium">
          Se importan {plural(counts.write, 'partida', 'partidas')}
          {counts.ranks > 0 ? ` y se anotan ${plural(counts.ranks, 'rango', 'rangos')}` : ''}.
        </p>
      ) : null}
      {data.tooMany ? (
        <p className="text-destructive">
          Son más de {formatNumber(data.maxNew)} partidas nuevas: importá la hoja en partes.
        </p>
      ) : null}
    </div>
  )
}

/** T-022: «Importar desde la hoja» — the owner's match sheet (its CSV or the cells pasted) into matches. */
export function SheetImportPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [deckMap, setDeckMap] = useState<Record<string, string | null>>({})
  const [mode, setMode] = useState<MatchMode>('competitive')
  const [include, setInclude] = useState<number[]>([])
  const [applied, setApplied] = useState<SheetImportApplied | null>(null)
  const preview = useSheetImportPreview()
  const apply = useSheetImportApply()
  // The last preview stays on screen while the next one loads (mutate's own callbacks fire for the latest call only).
  const [data, setData] = useState<SheetImportPreview | null>(null)
  /** What the shown preview was asked with: applying sends exactly that, with its fingerprint. */
  const [asked, setAsked] = useState<SheetImportRequest | null>(null)

  function run(next: Partial<SheetImportRequest> = {}) {
    const body: SheetImportRequest = { text, deckMap, mode, include, ...next }
    if (body.text.trim() === '') return
    setApplied(null)
    preview.mutate(body, {
      onSuccess: (result) => {
        setData(result)
        setAsked(body)
      },
      onError: (error) => toast.error(errorMessage(error)),
    })
  }

  async function readFile(file: File) {
    const content = await file.text()
    setFileName(file.name)
    setText(content)
    setInclude([])
    setData(null)
    setAsked(null)
    run({ text: content, include: [] })
  }

  function choose(code: string, deckId: string) {
    const next = { ...deckMap, [code]: deckId === '' ? null : deckId }
    setDeckMap(next)
    run({ deckMap: next })
  }

  function applySuggestions() {
    if (!data) return
    const next = { ...deckMap }
    for (const code of data.codes) if (!code.deckId && code.suggestion) next[code.code] = code.suggestion.deckId
    setDeckMap(next)
    run({ deckMap: next })
  }

  function toggle(row: number, value: boolean) {
    const next = value ? [...new Set([...include, row])] : include.filter((item) => item !== row)
    setInclude(next)
    run({ include: next })
  }

  async function doApply() {
    if (!data || !asked) return
    try {
      const result = await apply.mutateAsync({ ...asked, fingerprint: data.fingerprint })
      setApplied(result)
      toast.success(
        result.imported.length === 0
          ? 'No había partidas nuevas'
          : `Importé ${plural(result.imported.length, 'partida', 'partidas')}`,
      )
    } catch (error) {
      toast.error(errorMessage(error))
      // Something changed since the preview: show the new one.
      if (error instanceof ApiError && error.code === 'import_changed') run(asked)
    }
  }

  const missing = data?.codes.filter((code) => !code.deckId) ?? []
  const shown = data?.rows.filter((row) => row.status !== 'in_app' && row.status !== 'duplicate') ?? []
  const known = data?.rows.filter((row) => row.status === 'in_app' || row.status === 'duplicate') ?? []
  const canApply =
    data !== null &&
    asked !== null &&
    data.error === null &&
    !data.tooMany &&
    data.counts.write > 0 &&
    data.counts.unmapped === 0 &&
    !preview.isPending &&
    !apply.isPending

  return (
    <div className="flex flex-col gap-6">
      <Section title="La hoja">
        <p className="text-sm text-muted-foreground">
          En Sheets, con la pestaña «Partidas» abierta: Archivo → Descargar → Valores separados por comas (.csv), y
          subilo acá. O seleccioná toda la hoja, copiala y pegala abajo. Nada cambia hasta que confirmes la importación.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
          className="sr-only"
          aria-label="Archivo CSV de la hoja"
          onChange={(event) => {
            const chosen = event.target.files?.[0]
            event.target.value = ''
            if (chosen) void readFile(chosen)
          }}
        />
        <Button variant="outline" onClick={() => fileRef.current?.click()} className="self-start">
          <FileUpIcon data-icon="inline-start" />
          Subir el CSV
        </Button>
        {fileName ? <p className="break-words text-sm text-muted-foreground">{fileName}</p> : null}
        <Textarea
          aria-label="Celdas pegadas de la hoja"
          placeholder="…o pegá acá las celdas copiadas de la hoja (con los encabezados)"
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setFileName(null)
            // Another text: the preview shown is no longer this one's.
            setData(null)
            setAsked(null)
          }}
          className="max-h-48 font-mono text-sm"
        />
        <Button
          onClick={() => {
            setInclude([])
            run({ include: [] })
          }}
          disabled={text.trim() === '' || preview.isPending}
          className="self-start"
        >
          {preview.isPending ? <Spinner /> : null}
          Ver la vista previa
        </Button>
      </Section>

      {data?.error ? <p className="text-sm text-destructive">{data.error}</p> : null}

      {data && !data.error ? (
        <>
          <Section title="Vista previa">
            <Summary data={data} />
            <label className="flex min-w-0 flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Modalidad de todas las partidas</span>
              <select
                className="h-11 rounded-lg border bg-background px-2 text-base"
                value={mode}
                onChange={(event) => {
                  const next = event.target.value as MatchMode
                  setMode(next)
                  run({ mode: next })
                }}
              >
                {MATCH_MODES.map((item) => (
                  <option key={item} value={item}>
                    {MODE_LABEL[item]}
                  </option>
                ))}
              </select>
            </label>
          </Section>

          {data.codes.length > 0 ? (
            <Section
              title="Mazos de la hoja"
              action={
                missing.some((code) => code.suggestion) ? (
                  <Button size="sm" variant="outline" onClick={applySuggestions} disabled={preview.isPending}>
                    Usar los sugeridos
                  </Button>
                ) : undefined
              }
            >
              <p className="text-sm text-muted-foreground">
                Cada código de tu lista va a un mazo de la app. Lo que elijas queda guardado para la próxima.
              </p>
              <ul className="flex flex-col gap-3">
                {data.codes.map((code) => (
                  <li key={code.code}>
                    <label className="flex min-w-0 flex-col gap-1 text-sm">
                      <span className="break-words">
                        <span className="font-medium">{code.code}</span>
                        {code.names.length > 0 ? ` «${code.names.join('», «')}»` : ''} ·{' '}
                        {plural(code.rows, 'fila', 'filas')}
                        {!code.deckId && code.suggestion ? (
                          <span className="text-muted-foreground"> · sugerido {code.suggestion.reason}</span>
                        ) : null}
                      </span>
                      <select
                        aria-label={`Mazo de ${code.code}`}
                        className="h-11 min-w-0 rounded-lg border bg-background px-2 text-base"
                        value={code.deckId ?? ''}
                        onChange={(event) => choose(code.code, event.target.value)}
                      >
                        <option value="">Elegí un mazo…</option>
                        {data.decks.map((deck) => (
                          <option key={deck.id} value={deck.id}>
                            {deck.name}
                            {deck.archived ? ' (archivado)' : ''}
                            {code.suggestion?.deckId === deck.id && !code.deckId ? ' (sugerido)' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {shown.length > 0 ? (
            <Section title="Filas para revisar">
              <ul className="divide-y rounded-lg border">
                {shown.map((row) => (
                  <RowCard key={row.row} row={row} included={include.includes(row.row)} onInclude={toggle} />
                ))}
              </ul>
            </Section>
          ) : null}

          {known.length > 0 ? (
            <Fold title="Ya están en la app" hint={plural(known.length, 'fila', 'filas')}>
              <ul className="divide-y">
                {known.map((row) => (
                  <RowCard key={row.row} row={row} included={false} onInclude={toggle} />
                ))}
              </ul>
            </Fold>
          ) : null}

          {applied ? null : (
            <div className="flex flex-col gap-2">
              {missing.length > 0 ? (
                <p className="text-sm text-destructive">
                  Elegí el mazo de {missing.map((code) => code.code).join(', ')} para seguir.
                </p>
              ) : null}
              <Button size="lg" onClick={() => void doApply()} disabled={!canApply}>
                {apply.isPending ? <Spinner /> : null}
                {data.counts.write > 0
                  ? `Importar ${plural(data.counts.write, 'partida', 'partidas')}`
                  : 'No hay partidas para importar'}
              </Button>
              {data.counts.write === 0 && data.columnK ? (
                <Section title="Números para la columna K">
                  <ColumnK columnK={data.columnK} />
                </Section>
              ) : null}
            </div>
          )}
        </>
      ) : null}

      {applied ? (
        <Section title="Listo">
          <p className="text-sm">
            Importé {plural(applied.imported.length, 'partida', 'partidas')}
            {applied.ranks > 0 ? ` y anoté ${plural(applied.ranks, 'rango', 'rangos')}` : ''}.
          </p>
          {applied.imported.length > 0 ? (
            <ul className="flex flex-col text-sm tabular">
              {applied.imported.map((item) => (
                <li key={item.row}>
                  Fila {item.row} → n.º {item.matchId}
                </li>
              ))}
            </ul>
          ) : null}
          {applied.columnK ? <ColumnK columnK={applied.columnK} /> : null}
          <Link to="/partidas/historial" className="text-sm text-primary hover:underline">
            Ver el historial
          </Link>
        </Section>
      ) : null}
    </div>
  )
}
