import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { CHAT_CHANNEL_LABEL, CHAT_CHANNELS, type ChatChannel } from '@/api/schemas'
import { useChatParticipants, useRemoveChatParticipant, useSaveChatParticipant } from '@/api/tokens'
import { EmptyState, ErrorState, LoadingRows, Spinner } from '@/components/ListState'
import { Field, Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/** Channels a session can get here: Santi's (`owner`) is only his. */
const SESSION_CHANNELS = CHAT_CHANNELS.filter((value) => value !== 'owner')

/**
 * D-021: who takes part in the chat between the Claude sessions, and from where each one writes. A name has to be
 * exactly one of these (only the case does not matter): no variant passes. Santi is always there, as himself.
 */
export function ChatParticipantsSection() {
  const participants = useChatParticipants()
  const save = useSaveChatParticipant()
  const remove = useRemoveChatParticipant()
  const [name, setName] = useState('')
  const [channel, setChannel] = useState<ChatChannel>('connector')

  async function add() {
    try {
      await save.mutateAsync({ name: name.trim(), channel })
      setName('')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function change(participant: string, next: ChatChannel) {
    try {
      await save.mutateAsync({ name: participant, channel: next })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function drop(participant: string) {
    try {
      await remove.mutateAsync(participant)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <Section title="Chat entre sesiones">
      <p className="text-sm text-muted-foreground">
        Quién participa en el chat de las sesiones de Claude y por dónde escribe cada una. Solo valen estos nombres, tal
        cual (sin importar mayúsculas).
      </p>
      {participants.isPending ? <LoadingRows rows={3} /> : null}
      {participants.isError ? <ErrorState error={participants.error} onRetry={() => participants.refetch()} /> : null}
      {participants.data && participants.data.length === 0 ? <EmptyState title="Nadie en la lista" /> : null}
      {participants.data && participants.data.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {participants.data.map((participant) => {
            const fixed = participant.channel === 'owner'
            return (
              <li key={participant.name} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 font-medium">{participant.name}</span>
                <Select
                  value={participant.channel}
                  onValueChange={(value) => change(participant.name, value as ChatChannel)}
                  disabled={fixed}
                >
                  <SelectTrigger className="w-56" aria-label={`Canal de ${participant.name}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(fixed ? CHAT_CHANNELS : SESSION_CHANNELS).map((value) => (
                      <SelectItem key={value} value={value}>
                        {CHAT_CHANNEL_LABEL[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => drop(participant.name)}
                  disabled={fixed || remove.isPending}
                >
                  Quitar
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}
      <Field label="Sesión nueva">
        <div className="flex flex-wrap gap-2">
          <Input
            className="min-w-40 flex-1"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nube-3"
            aria-label="Nombre de la sesión"
          />
          <Select value={channel} onValueChange={(value) => setChannel(value as ChatChannel)}>
            <SelectTrigger className="w-56" aria-label="Canal de la sesión nueva">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SESSION_CHANNELS.map((value) => (
                <SelectItem key={value} value={value}>
                  {CHAT_CHANNEL_LABEL[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={add} disabled={save.isPending || name.trim().length === 0}>
            {save.isPending ? <Spinner /> : null}
            Sumar
          </Button>
        </div>
      </Field>
    </Section>
  )
}
