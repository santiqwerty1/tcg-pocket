import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import type { ChatMovedRoom, ChatRoom } from '@/api/schemas'
import { useChatMoved, useClearChatMoved, useSetChatMoved } from '@/api/tokens'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDateTime } from '@/lib/format'

/**
 * The move of the chat to the hub (D-030, T1b): Santi marks a room as moved when the hub takes it (step 5 of D8), and
 * brings it back with the same button. A moved room takes no writes here: the bridge gets 410, and the old connector
 * goes to the hub (with HUB_MCP_TOKEN) or says where it went.
 */
export function ChatMovedSection() {
  const moved = useChatMoved()
  const set = useSetChatMoved()
  const clear = useClearChatMoved()
  const [urls, setUrls] = useState<Partial<Record<ChatRoom, string>>>({})
  const [confirm, setConfirm] = useState<{ room: ChatMovedRoom; action: 'move' | 'back' } | null>(null)

  async function apply() {
    if (!confirm) return
    const { room, action } = confirm
    try {
      if (action === 'move') {
        await set.mutateAsync({ room: room.room, url: (urls[room.room] ?? '').trim() })
        toast.success(`La sala «${room.room}» quedó mudada al hub`)
      } else {
        await clear.mutateAsync(room.room)
        toast.success(`La sala «${room.room}» volvió a tcg-pocket`)
      }
      setConfirm(null)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <Section title="Mudanza del chat al hub">
      <p className="text-sm text-muted-foreground">
        Cuando el hub toma una sala (paso 5 de la mudanza), marcala acá. Desde ese momento tcg-pocket no recibe nada en
        esa sala: el puente se frena con un aviso y las sesiones del conector viejo pasan al hub. El historial queda en
        la base hasta que se borre.
      </p>
      {moved.isPending ? <LoadingRows rows={2} /> : null}
      {moved.isError ? <ErrorState error={moved.error} onRetry={() => moved.refetch()} /> : null}
      {moved.data && !moved.data.forwarding ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Falta HUB_MCP_TOKEN: con una sala mudada, el conector viejo solo dice adónde se mudó, sin reenviar.
        </p>
      ) : null}
      {moved.data ? (
        <ul className="divide-y rounded-lg border">
          {moved.data.items.map((room) => {
            const id = `chat-moved-${room.room}`
            return (
              <li key={room.room} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">«{room.room}»</span>{' '}
                  <span className="text-sm text-muted-foreground">({room.label})</span>
                  {room.url ? (
                    <span className="block text-sm text-muted-foreground">
                      Mudada a {room.url}
                      {room.since ? ` desde el ${formatDateTime(room.since)}` : ''}
                    </span>
                  ) : (
                    <span className="block text-sm text-muted-foreground">En tcg-pocket</span>
                  )}
                </span>
                {room.url ? (
                  <Button variant="outline" onClick={() => setConfirm({ room, action: 'back' })}>
                    Volver a tcg-pocket
                  </Button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor={id} className="sr-only">
                      URL del hub para «{room.room}»
                    </Label>
                    <Input
                      id={id}
                      className="w-64"
                      placeholder="https://…"
                      value={urls[room.room] ?? ''}
                      onChange={(event) => setUrls((current) => ({ ...current, [room.room]: event.target.value }))}
                    />
                    <Button
                      variant="destructive"
                      disabled={!(urls[room.room] ?? '').trim()}
                      onClick={() => setConfirm({ room, action: 'move' })}
                    >
                      Marcar como mudada
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => (open ? undefined : setConfirm(null))}
        title={
          confirm?.action === 'back'
            ? `¿Volver «${confirm.room.room}» a tcg-pocket?`
            : `¿Marcar «${confirm?.room.room ?? ''}» como mudada al hub?`
        }
        description={
          confirm?.action === 'back'
            ? 'tcg-pocket vuelve a recibir esa sala: el puente y el conector viejo escriben acá otra vez. Hacelo con el hub sin escribir, después de traer lo suyo con chat-import.'
            : `Se corta todo lo de esa sala en tcg-pocket: el puente recibe 410 y se frena, y el conector viejo pasa a ${(confirm ? urls[confirm.room.room] : '')?.trim() ?? ''}. Nada se escribe acá hasta volverla atrás.`
        }
        confirmLabel={confirm?.action === 'back' ? 'Volver a tcg-pocket' : 'Marcar como mudada'}
        destructive={confirm?.action === 'move'}
        pending={set.isPending || clear.isPending}
        onConfirm={apply}
      />
    </Section>
  )
}
