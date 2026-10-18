/**
 * `pnpm -F @tcg/api chat-import <url> [--salas …] [--despues <id>] [--aplicar]` (in production:
 * `node /app/apps/api/dist/cli/chat-import.js …` through `flyctl machine exec`, with IMPORT_TOKEN as a secret of a
 * while). The way back of the chat's move (D-030, T1a): brings the hub's `chat-export` v1. Without `--aplicar` a
 * preview, nothing written; with it, one transaction that, with a conflict, writes nothing and says why.
 */

import { describeChatImport } from '@tcg/domain'
import { ChatImportError, ChatTransferService } from '../chat/chat-transfer.service.js'
import { ChatImportArgsError, parseChatImportArgs } from './chat-import-args.js'
import { createCliContext } from './context.js'

let args: ReturnType<typeof parseChatImportArgs>
try {
  args = parseChatImportArgs(process.argv.slice(2), process.env)
} catch (error) {
  console.error(error instanceof ChatImportArgsError ? error.message : error)
  process.exit(1)
}

const { context } = await createCliContext()
let exitCode = 0
try {
  const transfer = context.get(ChatTransferService)
  const data = await transfer.fetchExport({ url: args.url, token: args.token, rooms: args.rooms, after: args.after })
  const plan = args.apply ? await transfer.apply(data) : await transfer.preview(data)
  console.log(describeChatImport(plan, args.apply ? 'applied' : 'preview'))
} catch (error) {
  console.error(error instanceof ChatImportError ? error.message : error)
  exitCode = 1
} finally {
  await context.close()
}
process.exit(exitCode)
