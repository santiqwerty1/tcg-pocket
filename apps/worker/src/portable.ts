/**
 * The portable worker («paquete del worker»): `tcg-worker.exe` (Node and this worker in one executable) next to
 * `engine-cli.exe`, for another PC without the repository, Node or Rust. More PCs play the chunks of a simulation in
 * parallel; each one claims its own.
 *
 *   tcg-worker.exe              setup: token, cores and name; a check against the engine and the app; logon start
 *   tcg-worker.exe --run        what the logon start runs (the worker, hidden)
 *   tcg-worker.exe --check      configuration, engine and server reachability
 *   tcg-worker.exe --once       at most one chunk, then exit
 *   tcg-worker.exe --uninstall  removes the logon start
 */
import { availableParallelism, hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { installAutostart, uninstallAutostart } from './autostart.js'
import { configFile, readFileConfig, writeFileConfig } from './config.js'
import { run } from './run.js'
import { WORKER_VERSION } from './version.js'

const DEFAULT_SERVER = 'https://tcg-pocket.fly.dev'
const exe = process.execPath
const defaults = { enginePath: join(dirname(exe), process.platform === 'win32' ? 'engine-cli.exe' : 'engine-cli') }

async function setup(): Promise<void> {
  console.log(`TCG Pocket: worker de simulación ${WORKER_VERSION}\n`)
  const current = readFileConfig()
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const server = current.server ?? DEFAULT_SERVER
    console.log(`Servidor: ${server}`)
    const hasToken = current.token?.startsWith('tcg_wk_') === true
    let token = current.token ?? ''
    for (;;) {
      const answer = (
        await rl.question(
          hasToken
            ? 'Token del worker (Enter = dejar el que está): '
            : 'Token del worker (en la app: Más → Tokens de API → nuevo, tipo worker): ',
        )
      ).trim()
      if (!answer && hasToken) break
      if (answer.startsWith('tcg_wk_')) {
        token = answer
        break
      }
      console.log('Ese no es un token de worker: empieza con tcg_wk_.')
    }
    const max = availableParallelism()
    const suggested = current.cores ?? max
    const coresAnswer = (
      await rl.question(
        `Hilos a usar (esta PC tiene ${max}; la prioridad baja deja CPU a la CI; Enter = ${suggested}): `,
      )
    ).trim()
    const parsed = Number(coresAnswer)
    const cores = coresAnswer && Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : suggested
    const name = current.name ?? hostname()
    const nameAnswer = (await rl.question(`Nombre de esta PC en la app (Enter = ${name}): `)).trim()
    writeFileConfig({
      ...current,
      server,
      token,
      cores,
      priority: current.priority ?? 'below_normal',
      name: nameAnswer || name,
    })
    console.log(`\nConfiguración guardada en ${configFile()}.`)
    console.log('Probando el motor y la conexión con la app…')
    await run(['--check'], defaults)
    installAutostart([exe, '--run'])
    console.log(
      '\nListo: el worker queda corriendo y arranca solo cada vez que inicies sesión. En la app lo ves en Más → Simulación.',
    )
  } catch (error) {
    console.log(`\nNo se pudo terminar: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await rl.question('\nEnter para cerrar.')
    rl.close()
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--uninstall')) return uninstallAutostart()
  if (args.some((arg) => arg === '--run' || arg === '--check' || arg === '--once')) {
    return run(
      args.filter((arg) => arg !== '--run'),
      defaults,
    )
  }
  return setup()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
