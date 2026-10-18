/**
 * The arguments of `chat-import` (D-030, T1a): `<url> [--salas sala,…] [--despues <id>] [--aplicar]`, and the token
 * of the other side in IMPORT_TOKEN (a secret of a while, never an argument: it would stay in the history).
 */
import { parseArgs } from 'node:util'

export class ChatImportArgsError extends Error {}

export interface ChatImportArgs {
  url: string
  token: string
  rooms: string[]
  after: number
  apply: boolean
}

export const CHAT_IMPORT_USAGE =
  'Uso: chat-import <url> [--salas sala,…] [--despues <id>] [--aplicar]   (el token del otro lado en IMPORT_TOKEN; sin --aplicar, solo la vista previa)'

export function parseChatImportArgs(argv: readonly string[], env: Record<string, string | undefined>): ChatImportArgs {
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        salas: { type: 'string' },
        despues: { type: 'string' },
        aplicar: { type: 'boolean', default: false },
      },
    })
  } catch (error) {
    throw new ChatImportArgsError(`${error instanceof Error ? error.message : String(error)}\n${CHAT_IMPORT_USAGE}`)
  }
  const { values, positionals } = parsed
  const url = positionals[0]
  if (!url || positionals.length > 1) throw new ChatImportArgsError(CHAT_IMPORT_USAGE)
  let target: URL
  try {
    target = new URL(url)
  } catch {
    throw new ChatImportArgsError(`«${url}» no es una URL.`)
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && local)) {
    throw new ChatImportArgsError('La exportación va por https (http solo contra esta máquina).')
  }
  const token = env.IMPORT_TOKEN ?? ''
  if (!token)
    throw new ChatImportArgsError(
      'Falta IMPORT_TOKEN: el token de exportación del otro lado, como secreto por un rato.',
    )
  const after = values.despues
  if (after !== undefined && (typeof after !== 'string' || !/^\d+$/.test(after))) {
    throw new ChatImportArgsError('--despues <id>: un número.')
  }
  const rooms =
    typeof values.salas === 'string'
      ? values.salas
          .split(',')
          .map((room) => room.trim())
          .filter(Boolean)
      : []
  if (typeof values.salas === 'string' && rooms.length === 0) throw new ChatImportArgsError('--salas va con un valor.')
  return { url, token, rooms, after: after === undefined ? 0 : Number(after), apply: values.aplicar === true }
}
