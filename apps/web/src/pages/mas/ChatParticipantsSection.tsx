import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import {
  CHAT_CHANNEL_LABEL,
  CHAT_CHANNELS,
  CHAT_ROOM_LABEL,
  CHAT_ROOMS,
  type ChatChannel,
  type ChatParticipant,
  type ChatRoom,
} from '@/api/schemas'
import { useChatParticipants, useRemoveChatParticipant, useSaveChatParticipant } from '@/api/tokens'
import { EmptyState, ErrorState, LoadingRows, Spinner } from '@/components/ListState'
import { Field, Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/** Channels a session can get here: Santi's (`owner`) is only his. */
const SESSION_CHANNELS = CHAT_CHANNELS.filter((value) => value !== 'owner')

/**
 * D-021: who takes part in the chat between the Claude sessions, and from where each one writes. A name has to be
 * exactly one of these (only the case does not matter): no variant passes. Santi is always there, as himself, and in
 * every room. Each session is in one room or more (13/10/2026): the first one is its main room, where what it writes
 * without saying a room goes.
 */
export function ChatParticipantsSection() {
  const participants = useChatParticipants()
  const save = useSaveChatParticipant()
  const remove = useRemoveChatParticipant()
  const [name, setName] = useState('')
  const [channel, setChannel] = useState<ChatChannel>('connector')
  const [room, setRoom] = useState<ChatRoom>('tcg')

  async function add() {
    try {
      await save.mutateAsync({ name: name.trim(), channel, rooms: [room] })
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

  /** Its rooms, the main one first; at least one. */
  async function setRooms(participant: ChatParticipant, rooms: ChatRoom[]) {
    if (rooms.length === 0) return
    try {
      await save.mutateAsync({ name: participant.name, channel: participant.channel, rooms })
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
        Quién participa en el chat de las sesiones de Claude, por dónde escribe cada una y en qué salas está. Solo valen
        estos nombres, tal cual (sin importar mayúsculas). La primera sala es la principal: ahí va lo que una sesión
        escribe sin decir la sala.
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
                <div className="flex flex-wrap items-center gap-3">
                  {CHAT_ROOMS.map((value) => {
                    const checked = participant.rooms.includes(value)
                    const id = `chat-room-${encodeURIComponent(participant.name)}-${value}`
                    return (
                      <div key={value} className="flex items-center gap-1.5">
                        <Checkbox
                          id={id}
                          checked={checked}
                          // Santi is in every room; a session keeps at least one.
                          disabled={fixed || (checked && participant.rooms.length === 1) || save.isPending}
                          onCheckedChange={(next) =>
                            setRooms(
                              participant,
                              next === true
                                ? [...participant.rooms, value]
                                : participant.rooms.filter((item) => item !== value),
                            )
                          }
                          aria-label={`${participant.name} en la sala ${CHAT_ROOM_LABEL[value]}`}
                        />
                        <Label htmlFor={id} className="font-normal">
                          {CHAT_ROOM_LABEL[value]}
                        </Label>
                      </div>
                    )
                  })}
                  {!fixed && participant.rooms.length > 1 ? (
                    <Select
                      value={participant.rooms[0]}
                      onValueChange={(main) =>
                        setRooms(participant, [main as ChatRoom, ...participant.rooms.filter((item) => item !== main)])
                      }
                    >
                      <SelectTrigger className="w-40" aria-label={`Sala principal de ${participant.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {participant.rooms.map((value) => (
                          <SelectItem key={value} value={value}>
                            Principal: {CHAT_ROOM_LABEL[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>
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
          <Select value={room} onValueChange={(value) => setRoom(value as ChatRoom)}>
            <SelectTrigger className="w-40" aria-label="Sala de la sesión nueva">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHAT_ROOMS.map((value) => (
                <SelectItem key={value} value={value}>
                  Sala: {CHAT_ROOM_LABEL[value]}
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
