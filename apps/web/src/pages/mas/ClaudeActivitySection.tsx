/**
 * Actividad de Claude (Fase 43, R-010): every write Claude made through the MCP — token, client, tool and arguments —
 * and «Deshacer» for the two that lose something (a deleted match, a collection edit).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Undo2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { errorMessage, request } from '@/api/client'
import { EmptyState, ErrorState, LoadingRows, Spinner } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/format'

const auditSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  at: z.string(),
  token: z.object({ id: z.string().nullable(), name: z.string() }),
  client: z.string(),
  tool: z.string(),
  title: z.string(),
  args: z.unknown(),
  ok: z.boolean(),
  error: z.string().nullable(),
  ms: z.number(),
  undo: z.object({ kind: z.string(), label: z.string() }).nullable(),
  undoneAt: z.string().nullable(),
})
export type ClaudeWrite = z.infer<typeof auditSchema>
const listSchema = z.object({ items: z.array(auditSchema) })
const auditKey = ['mcp-audit'] as const

/** «deck: 7 · result: win · opponent: Mega-Blaziken»: the short arguments, long texts left out. */
export function argsSummary(args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (value === null || value === undefined) continue
    if (typeof value === 'string') parts.push(`${key}: ${value.length > 40 ? `${value.slice(0, 40)}…` : value}`)
    else if (typeof value === 'number' || typeof value === 'boolean') parts.push(`${key}: ${String(value)}`)
    else if (Array.isArray(value))
      parts.push(`${key}: ${value.length} ${value.length === 1 ? 'elemento' : 'elementos'}`)
  }
  const text = parts.join(' · ')
  return text.length > 160 ? `${text.slice(0, 160)}…` : text
}

export function ClaudeActivitySection() {
  const queryClient = useQueryClient()
  const list = useQuery({
    queryKey: auditKey,
    queryFn: ({ signal }) => request('/api/mcp-audit?limit=30', { schema: listSchema, signal }),
    select: (data) => data.items,
  })
  const undo = useMutation({
    mutationFn: (id: string) =>
      request(`/api/mcp-audit/${encodeURIComponent(id)}/undo`, { method: 'POST', schema: auditSchema }),
    onSuccess: () => {
      toast.success('Listo: quedó como antes')
      // A restored match or a collection row changes what other screens show.
      void queryClient.invalidateQueries()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <Section title="Actividad de Claude">
      <p className="text-sm text-muted-foreground">
        Lo que Claude escribió con un token con permiso de escritura. Para el uso de todos los días conviene un token
        solo de lectura y dejar el de escritura aparte.
      </p>
      {list.isPending ? <LoadingRows rows={3} /> : null}
      {list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : null}
      {list.data && list.data.length === 0 ? <EmptyState title="Claude todavía no escribió nada" /> : null}
      {list.data && list.data.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {list.data.map((row) => (
            <li key={row.id} className="flex items-start gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="font-medium">{row.title}</span>
                  {row.ok ? null : <Badge variant="destructive">falló</Badge>}
                  {row.undoneAt ? <Badge variant="outline">deshecho</Badge> : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDateTime(row.at)} · {row.token.name} · {row.client}
                </div>
                {argsSummary(row.args) ? (
                  <div className="break-words font-mono text-xs text-muted-foreground">{argsSummary(row.args)}</div>
                ) : null}
                {row.error ? <div className="text-xs text-destructive">{row.error}</div> : null}
                {row.undo ? <div className="text-xs">{row.undo.label}</div> : null}
              </div>
              {row.undo ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  disabled={undo.isPending}
                  onClick={() => undo.mutate(row.id)}
                >
                  {undo.isPending && undo.variables === row.id ? <Spinner /> : <Undo2Icon data-icon="inline-start" />}
                  Deshacer
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  )
}
