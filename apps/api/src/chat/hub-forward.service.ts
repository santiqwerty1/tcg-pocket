/**
 * D5 of the move to the hub (D-030, T1b): while a cloud session keeps the old connector, its `chat_read` and
 * `chat_write` of a moved room go to the hub's MCP, with tcg-pocket's own connector token there (`HUB_MCP_TOKEN`, a
 * secret). One `tools/call` without a session, in the 2025-06-18 era (the hub serves both eras); what the hub answers
 * goes back as it is, with a line that says the room moved.
 *
 * The hub ties its tokens to rooms, not to participants: this token acts as any cloud participant of its rooms, like
 * tcg-pocket's own connector. What it shares among the forwarded sessions: 5 waits at once (H3.13), 600 calls a minute,
 * and its name as the `via` of what they write.
 */
import { randomInt } from 'node:crypto'
import type { CallToolResult } from '@modelcontextprotocol/server'
import { Inject, Injectable } from '@nestjs/common'
import type { ChatRoom } from '@tcg/domain'
import { PinoLogger } from 'nestjs-pino'
import { ENV, type Env } from '../config/env.js'

/** The MCP protocol version of the forwarded call: the 2025 era, which needs no session for one `tools/call`. */
export const HUB_MCP_PROTOCOL = '2025-06-18'
/** Past the wait the call asks for, this long for the hub to answer. */
const HUB_ANSWER_MS = 15_000
/** The most characters of the hub's answer that are read (a read gives about 30,000 characters of messages). */
const MAX_ANSWER_CHARS = 2_000_000
/** Characters of an error answer that are kept for the message. */
const ERROR_DETAIL_CHARS = 300

type JsonRpcAnswer = { id?: unknown; result?: CallToolResult; error?: { message?: unknown } }

/** The `tools/call` answer with `id` in the hub's body: plain JSON, or the `data:` lines of an event stream. */
export function hubAnswerFrom(body: string, contentType: string | null, id: number): JsonRpcAnswer | null {
  const candidates: unknown[] = []
  if ((contentType ?? '').includes('text/event-stream')) {
    // One event per blank line; an event's `data:` lines are joined with newlines (the SSE format).
    for (const event of body.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n')
      if (!data) continue
      try {
        candidates.push(JSON.parse(data))
      } catch {}
    }
  } else {
    try {
      candidates.push(JSON.parse(body))
    } catch {}
  }
  for (const candidate of candidates.flat()) {
    if (candidate && typeof candidate === 'object' && (candidate as JsonRpcAnswer).id === id) {
      return candidate as JsonRpcAnswer
    }
  }
  return null
}

/** A tool error the model reads, like the other expected failures of the chat tools. */
function toolError(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** At most `cap` characters of a body (the rest is never read); null past it. */
async function readUpTo(response: Response, cap: number): Promise<string | null> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
    if (text.length > cap) {
      await reader.cancel().catch(() => undefined)
      return null
    }
  }
  return text + decoder.decode()
}

@Injectable()
export class HubForwardService {
  /** The connector token in the hub (`HUB_MCP_TOKEN`); null: the moved rooms only say where they went. */
  token: string | null
  /** Past the wait asked, how long the hub has to answer (the tests shorten it). */
  answerMs = HUB_ANSWER_MS
  /** The most characters of an answer that are read (the tests shorten it). */
  maxAnswerChars = MAX_ANSWER_CHARS

  constructor(
    @Inject(ENV) env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.token = env.hubMcpToken
    this.logger.setContext(HubForwardService.name)
  }

  /** `tool` with `args` (its room in `sala`) at the hub `base`, while the client is there (`signal`). */
  async call(input: {
    base: string
    room: ChatRoom
    tool: 'chat_read' | 'chat_write'
    args: Record<string, unknown>
    signal: AbortSignal
    waitSeconds?: number | undefined
    /** Who asked (token and client), for the log: a leaked token shows up there. */
    caller?: string | undefined
  }): Promise<CallToolResult> {
    const moved = `La sala «${input.room}» se mudó al hub (${input.base})`
    if (!this.token) {
      return toolError(`${moved}: usá el conector nuevo. tcg-pocket no tiene el token para reenviarle el pedido.`)
    }
    const id = randomInt(1, 2_147_483_647)
    const started = Date.now()
    const timeout = AbortSignal.timeout((input.waitSeconds ?? 0) * 1000 + this.answerMs)
    const who = { tool: input.tool, room: input.room, caller: input.caller }
    /** A request or a body cut on the way: the client left, the time ran out, or the hub went away (a deploy). */
    const failed = (error: unknown, step: string): CallToolResult => {
      this.logger.warn({ ...who, step, err: error }, 'hub forward failed')
      if (input.signal.aborted) return toolError('El pedido se canceló antes de que contestara el hub.')
      if (timeout.aborted) return toolError(`${moved}, y no contestó a tiempo: probá de nuevo en unos segundos.`)
      return toolError(`${moved}, y se cortó la conexión: probá de nuevo en unos segundos.`)
    }
    let response: Response
    try {
      response = await fetch(`${input.base}/api/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': HUB_MCP_PROTOCOL,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name: input.tool, arguments: input.args },
        }),
        redirect: 'error',
        signal: AbortSignal.any([input.signal, timeout]),
      })
    } catch (error) {
      return failed(error, 'request')
    }
    if (!response.ok) {
      const detail = ((await readUpTo(response, ERROR_DETAIL_CHARS * 10).catch(() => '')) ?? '').slice(
        0,
        ERROR_DETAIL_CHARS,
      )
      this.logger.warn({ ...who, status: response.status }, 'hub forward refused')
      if (response.status === 401 || response.status === 403) {
        return toolError(`${moved}, y rechazó el token de reenvío (${response.status}): avisale a Santi.`)
      }
      if (response.status === 429 || response.status >= 500) {
        return toolError(`${moved}, y contestó ${response.status}: probá de nuevo en unos segundos.`)
      }
      return toolError(`${moved}, y contestó ${response.status}: ${detail}`)
    }
    // The 2025 era sends the event stream's headers at once: a read waits while its body is being read.
    let body: string | null
    try {
      body = await readUpTo(response, this.maxAnswerChars)
    } catch (error) {
      return failed(error, 'body')
    }
    if (body === null) {
      this.logger.warn({ ...who }, 'hub forward answer too long')
      return toolError(`${moved}, y su respuesta pasó los ${this.maxAnswerChars} caracteres.`)
    }
    const answer = hubAnswerFrom(body, response.headers.get('content-type'), id)
    if (!answer) return toolError(`${moved}, y su respuesta no se entendió.`)
    if (answer.error || !answer.result) {
      return toolError(`${moved}, y contestó un error: ${String(answer.error?.message ?? 'sin detalle')}`)
    }
    this.logger.info({ ...who, ms: Date.now() - started }, 'hub forward')
    return {
      ...answer.result,
      content: [
        ...(answer.result.content ?? []),
        {
          type: 'text',
          text: `${moved}: tcg-pocket reenvió el pedido. Pasá al conector nuevo del hub cuando puedas.`,
        },
      ],
    }
  }
}
