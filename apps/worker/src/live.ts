/**
 * Games against a bot (PLAN §3.7, Fase 8): a second loop next to the chunks. It claims a game, runs `engine-cli play`
 * and relays it: each `decide` goes to the app and the owner's choice comes back (long-poll, no time limit); the
 * actions go along as the game's log. A game the app already has choices for (the worker restarted) is rebuilt by
 * sending those choices again: the same seed and choices give the same game. At the end, the result and the replay.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as sleep } from 'node:timers/promises'
import { gzipSync } from 'node:zlib'
import { ApiError, type LiveGame, type Log, type WorkerClient } from './client.js'
import type { WorkerConfig } from './config.js'
import { WORKER_VERSION } from './version.js'

/** An engine built before the coach (Fase 20) ignores `coach` in the job: say how to fix it. */
export const OLD_ENGINE_COACH =
  'El motor de esta PC no tiene el modo entrenador: recompilá el motor (cargo build --release en engine/) y reiniciá el worker.'

type EngineLine =
  | { type: 'start'; seed: string }
  | { type: 'action'; [key: string]: unknown }
  | {
      type: 'decide'
      ply: number
      turn: number
      state: Record<string, unknown>
      actions: { i: number; text: string; action: unknown }[]
      coach?: { scores: number[]; best: number }
    }
  | { type: 'invalid'; ply: number; message: string }
  | { type: 'end'; winner: 'you' | 'bot' | 'tie'; turns: number; state: Record<string, unknown>; replay: string | null }

export class LiveRunner {
  constructor(
    private readonly config: WorkerConfig,
    private readonly client: WorkerClient,
    private readonly log: Log,
    private readonly workDir: string,
  ) {}

  /** Runs until the signal aborts; an unexpected error restarts the loop a minute later. Never rejects. */
  async start(engineRev: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.loop(engineRev, signal)
      } catch (error) {
        if (signal.aborted) return
        this.log('las partidas contra el bot fallaron; vuelvo a empezar en 60 s', {
          error: String(error).slice(0, 500),
        })
        await sleep(60_000, undefined, { signal }).catch(() => undefined)
      }
    }
  }

  async loop(engineRev: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      let game: LiveGame | null
      try {
        game = (
          await this.client.liveClaim({ workerId: this.config.workerId, engineRev, version: WORKER_VERSION }, signal)
        ).game
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof ApiError && error.status === 404) {
          // An app without games against a bot (older server): look again later.
          await sleep(300_000, undefined, { signal }).catch(() => undefined)
          continue
        }
        throw error
      }
      if (!game) continue
      this.log('partida contra el bot', { game: game.id, bot: game.bot, resumed: game.choices.length })
      try {
        await this.run(game, signal)
      } catch (error) {
        if (signal.aborted) return
        this.log('la partida falló', { game: game.id, error: String(error).slice(0, 500) })
        await this.client
          .liveFailure(game.id, { workerId: this.config.workerId, error: String(error) })
          .catch(() => undefined)
      }
    }
  }

  /** Runs one game to its end (or until the owner abandons it). */
  async run(game: LiveGame, signal: AbortSignal): Promise<void> {
    const dir = await mkdtemp(join(this.workDir, 'play-'))
    const jobFile = join(dir, 'job.json')
    await writeFile(
      jobFile,
      JSON.stringify({
        deckHuman: game.deckHuman,
        deckBot: game.deckBot,
        bot: game.bot,
        seed: Number(game.seed),
        replayDir: join(dir, 'replays'),
        coach: game.coach === true,
      }),
    )
    const [command, prefix] = /\.m?js$/.test(this.config.enginePath)
      ? [process.execPath, [this.config.enginePath]]
      : [this.config.enginePath, []]
    const child = spawn(command, [...prefix, 'play', jobFile], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000)
    })
    const exited = new Promise<number | null>((resolve) => child.on('close', (code) => resolve(code)))
    const kill = () => child.kill()
    signal.addEventListener('abort', kill, { once: true })
    const actions: Record<string, unknown>[] = []
    const answer = (i: number) => child.stdin.write(`${JSON.stringify({ i })}\n`)
    let finished = false
    let abandoned = false
    try {
      for await (const line of createInterface({ input: child.stdout })) {
        if (!line.trim()) continue
        const message = JSON.parse(line) as EngineLine
        if (message.type === 'action') {
          const { type: _type, ...entry } = message
          actions.push(entry)
        } else if (message.type === 'decide') {
          if (game.coach === true && !message.coach) throw new Error(OLD_ENGINE_COACH)
          const known = game.choices[message.ply - 1]
          if (known !== undefined) {
            answer(known)
            continue
          }
          const choice = await this.ask(game.id, message, actions, signal)
          if (choice === null) {
            this.log('partida abandonada', { game: game.id })
            abandoned = true
            kill()
            break
          }
          game.choices.push(choice)
          answer(choice)
        } else if (message.type === 'invalid') {
          throw new Error(`el motor rechazó una elección: ${message.message}`)
        } else if (message.type === 'end') {
          await this.client.liveEnd(game.id, {
            workerId: this.config.workerId,
            winner: message.winner,
            turns: message.turns,
            state: message.state,
            log: actions,
          })
          if (message.replay) {
            const data = await readFile(message.replay).catch(() => null)
            if (data) {
              await this.client
                .liveReplay(game.id, this.config.workerId, gzipSync(data))
                .catch((error) => this.log('no se pudo subir la repetición', { game: game.id, error: String(error) }))
            }
          }
          this.log('partida terminada', { game: game.id, winner: message.winner, turns: message.turns })
          finished = true
        }
      }
      const code = await exited
      // Killed after an abandon or a shutdown exits non-zero too: only a run that ended on its own is a failure.
      if (!finished && !abandoned && !signal.aborted) {
        throw new Error(stderr.trim() || `engine-cli play terminó con código ${code} sin terminar la partida`)
      }
    } finally {
      signal.removeEventListener('abort', kill)
      if (!child.killed && child.exitCode === null) child.kill()
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** Sends a decision and waits for the owner's choice; null when the game was abandoned. */
  private async ask(
    id: number,
    decision: Extract<EngineLine, { type: 'decide' }>,
    log: Record<string, unknown>[],
    signal: AbortSignal,
  ): Promise<number | null> {
    const workerId = this.config.workerId
    const sent = await this.client.liveDecision(id, {
      workerId,
      ply: decision.ply,
      turn: decision.turn,
      state: decision.state,
      actions: decision.actions,
      log,
      ...(decision.coach ? { coach: decision.coach } : {}),
    })
    if (sent.choice !== null) return sent.choice
    if (!['running', 'waiting'].includes(sent.status)) return null
    for (;;) {
      if (signal.aborted) return null
      const reply = await this.client.liveChoice(id, { workerId, ply: decision.ply }, signal)
      if (reply.choice !== null) return reply.choice
      if (!['running', 'waiting'].includes(reply.status)) return null
    }
  }
}
