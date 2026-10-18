import { CopyIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import {
  type ApiToken,
  CHAT_EXPORT_SCOPE,
  CHAT_RELAY_SCOPE,
  DEFAULT_SCOPES_BY_KIND,
  SCOPES_BY_KIND,
  SOLO_SCOPES,
  type TokenKind,
} from '@/api/schemas'
import { useCreateToken, useRevokeToken, useTokens } from '@/api/tokens'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState, ErrorState, LoadingRows, Spinner } from '@/components/ListState'
import { Field, Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { AndroidWorkerSection } from './AndroidWorkerSection'
import { ChatMovedSection } from './ChatMovedSection'
import { ChatParticipantsSection } from './ChatParticipantsSection'
import { ClaudeActivitySection } from './ClaudeActivitySection'

/** What each permission lets the holder do (Fase 7: Claude can write with `mcp:write`). */
const SCOPE_HINT: Record<string, string> = {
  'worker:claim': 'Tomar simulaciones de la cola y subir resultados (el worker de la PC).',
  'mcp:read': 'Leer colección, mazos, partidas, sobres, torneos y simulaciones.',
  'mcp:write':
    'Crear y editar mazos, registrar, corregir y borrar partidas, editar la colección y encolar o cancelar simulaciones. Cada escritura queda en «Actividad de Claude».',
  [CHAT_RELAY_SCOPE]:
    'Solo para el puente del chat entre sesiones de la PC: escribe como Santi, Coordinador, Principal, Laboratorio e Infra. Va solo, sin los otros permisos.',
  [CHAT_EXPORT_SCOPE]:
    'Solo para mudar el chat entre sesiones al hub: lee todo el chat de las salas, para importarlo allá. Va solo, y se revoca después de la mudanza.',
}

const KIND_LABEL: Record<TokenKind, string> = { worker: 'Worker (PC o Android)', mcp: 'Claude (MCP)' }

export function TokensPage() {
  const tokens = useTokens()
  const create = useCreateToken()
  const revoke = useRevokeToken()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<TokenKind>('mcp')
  const [scopes, setScopes] = useState<string[]>([...DEFAULT_SCOPES_BY_KIND.mcp])
  const [created, setCreated] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<ApiToken | null>(null)

  function changeKind(next: TokenKind) {
    setKind(next)
    setScopes([...DEFAULT_SCOPES_BY_KIND[next]])
  }

  /** The chat's bridge and export permissions go alone: checking one clears the others, and the other way round. */
  function toggleScope(scope: string, on: boolean) {
    setScopes((prev) => {
      if (!on) return prev.filter((s) => s !== scope)
      if (SOLO_SCOPES.includes(scope)) return [scope]
      return Array.from(new Set([...prev.filter((s) => !SOLO_SCOPES.includes(s)), scope]))
    })
  }

  async function submit() {
    try {
      const result = await create.mutateAsync({ name: name.trim(), kind, scopes })
      setCreated(result.token)
      setName('')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function copyToken() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created)
      toast.success('Token copiado')
    } catch {
      toast.error('No se pudo copiar; seleccionalo y copialo a mano.')
    }
  }

  async function doRevoke() {
    if (!revoking) return
    try {
      await revoke.mutateAsync(revoking.id)
      toast.success(`Token «${revoking.name}» revocado`)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setRevoking(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Section title="Nuevo token">
        <Field label="Nombre" htmlFor="token-name">
          <Input
            id="token-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Claude desde el celu"
          />
        </Field>
        <Field label="Tipo">
          <Select value={kind} onValueChange={(value) => changeKind(value as TokenKind)}>
            <SelectTrigger className="w-full" aria-label="Tipo de token">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(KIND_LABEL) as TokenKind[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {KIND_LABEL[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Permisos">
          <div className="flex flex-col gap-1">
            {SCOPES_BY_KIND[kind].map((scope) => (
              <Label key={scope} className="flex min-h-11 items-center gap-2 text-sm">
                <Checkbox
                  checked={scopes.includes(scope)}
                  onCheckedChange={(checked) => toggleScope(scope, checked === true)}
                />
                <span>
                  <span className="font-mono">{scope}</span>
                  {SCOPE_HINT[scope] ? (
                    <span className="block text-xs font-normal text-muted-foreground">{SCOPE_HINT[scope]}</span>
                  ) : null}
                </span>
              </Label>
            ))}
          </div>
        </Field>
        <Button onClick={submit} disabled={create.isPending || name.trim().length === 0 || scopes.length === 0}>
          {create.isPending ? <Spinner /> : null}
          Crear token
        </Button>
      </Section>

      <Section title="Tokens">
        {tokens.isPending ? <LoadingRows rows={3} /> : null}
        {tokens.isError ? <ErrorState error={tokens.error} onRetry={() => tokens.refetch()} /> : null}
        {tokens.data && tokens.data.length === 0 ? <EmptyState title="No hay tokens" /> : null}
        {tokens.data && tokens.data.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {tokens.data.map((token) => (
              <li key={token.id} className={cn('flex items-center gap-2 px-3 py-2', token.revokedAt && 'opacity-60')}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="font-medium">{token.name}</span>
                    <Badge variant="outline">{KIND_LABEL[token.kind]}</Badge>
                    {token.revokedAt ? <Badge variant="destructive">revocado</Badge> : null}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {token.prefix}… · {token.scopes.join(', ')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    creado {formatDateTime(token.createdAt)}
                    {token.lastUsedAt ? ` · usado ${formatDateTime(token.lastUsedAt)}` : ' · nunca usado'}
                    {token.expiresAt ? ` · vence ${formatDateTime(token.expiresAt)}` : ''}
                  </div>
                  {token.clients.length > 0 ? (
                    <div className="text-xs text-muted-foreground">
                      {token.clients.length === 1 ? 'Cliente: ' : 'Clientes: '}
                      {token.clients
                        .map((row) => `${row.client} (desde ${formatDateTime(row.firstSeenAt)})`)
                        .join(', ')}
                    </div>
                  ) : null}
                </div>
                {!token.revokedAt ? (
                  <Button variant="outline" size="sm" onClick={() => setRevoking(token)}>
                    Revocar
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <AndroidWorkerSection />
      <ClaudeActivitySection />

      <ChatParticipantsSection />
      <ChatMovedSection />

      <Dialog open={created !== null} onOpenChange={(open) => !open && setCreated(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Token creado</DialogTitle>
            <DialogDescription>
              Se muestra una sola vez. Guardalo en una variable de entorno, nunca en el repo.
            </DialogDescription>
          </DialogHeader>
          <code className="block break-all rounded-lg bg-muted p-3 font-mono text-sm select-all">{created}</code>
          <DialogFooter>
            <Button variant="outline" onClick={copyToken}>
              <CopyIcon data-icon="inline-start" />
              Copiar
            </Button>
            <Button onClick={() => setCreated(null)}>Listo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null)
        }}
        title={`¿Revocar «${revoking?.name ?? ''}»?`}
        description="Quien lo use deja de poder entrar al instante."
        confirmLabel="Revocar"
        destructive
        pending={revoke.isPending}
        onConfirm={doRevoke}
      />
    </div>
  )
}
