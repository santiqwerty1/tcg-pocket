/**
 * `pnpm -F @tcg/worker install-task`: starts this repository's worker (`node dist/main.js`) at logon, hidden
 * (`autostart.ts`). `uninstall-task` removes the task and the launchers.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installAutostart, uninstallAutostart } from './autostart.js'

const main = resolve(fileURLToPath(import.meta.url), '..', 'main.js')

const action = process.argv[2]
if (action === 'install') installAutostart([process.execPath, main])
else if (action === 'uninstall') uninstallAutostart()
else console.log('uso: install-task.js install | uninstall')
