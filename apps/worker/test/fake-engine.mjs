// A stand-in for engine-cli with the same command line, files, stderr progress and exit codes (engine/src/main.rs).
// Behaviour by job: games 13 → engine failure (exit 3); games 99 → plays forever (for cancel tests).
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const REV = 'fb792ebfbaca995af9750c28101ce92a51282825'
const [command, jobFile, resultFile] = process.argv.slice(2)

if (command === 'version') {
  // FAKE_ENGINE_OLD: an engine from before H-010 and B2 (no features).
  // FAKE_ENGINE_RESUME: an engine that resumes a pairing from its checkpoint (engine-cli 0.3.8, H-054).
  const known = [
    'perGame',
    'batch',
    ...(process.env.FAKE_ENGINE_RESUME ? ['resume'] : []),
    ...(process.env.FAKE_ENGINE_REGULATE ? ['regulate'] : []),
    ...(process.env.FAKE_ENGINE_REGULATE_PING ? ['regulatePing'] : []),
  ]
  const features = process.env.FAKE_ENGINE_OLD ? {} : { features: known }
  // FAKE_ENGINE_GAMES_REV: an engine that says how it plays (phase 42, engine-cli 0.3.6 on).
  const gamesRev = process.env.FAKE_ENGINE_GAMES_REV ? { gamesRev: Number(process.env.FAKE_ENGINE_GAMES_REV) } : {}
  process.stdout.write(JSON.stringify({ engineRev: REV, cliVersion: '0.1.0-fake', cards: 2, ...features, ...gamesRev }))
} else if (command === 'batch') {
  // B2: every pairing as simulate would play it. A pairing of 13 games fails alone (like a deck the engine refuses),
  // of 11 makes the whole batch fail, of 98 hangs it, of 97 takes 300 ms (so heartbeats run).
  const job = JSON.parse(readFileSync(jobFile, 'utf8'))
  if (job.pairings.some((pairing) => pairing.games === 11)) {
    process.stdout.write(JSON.stringify({ error: 'el lote falló', code: 'engine_failure' }))
    process.exit(3)
  }
  const total = job.pairings.reduce((sum, pairing) => sum + pairing.games, 0)
  process.stderr.write(`total ${total}\n`)
  const slow = job.pairings.some((pairing) => pairing.games === 97)
  if (job.pairings.some((pairing) => pairing.games === 98)) setInterval(() => {}, 1000)
  else setTimeout(finish, slow ? 300 : 0)
  function finish() {
    for (let i = 1; i <= total; i++) process.stderr.write(`progress ${i}\n`)
    const pairings = job.pairings.map((pairing, p) => {
      const games = pairing.games
      if (games === 13) {
        return {
          seed: pairing.seed,
          winsA: 0,
          winsB: 0,
          ties: 0,
          games: 0,
          turns: 0,
          replays: [],
          error: { error: 'deck inválido', code: 'bad_input' },
        }
      }
      const winsA = Math.ceil(games / 2)
      const replays = []
      if (pairing.replaySample > 0) {
        const dir = join(job.replayDir, String(p))
        mkdirSync(dir, { recursive: true })
        for (let i = 0; i < pairing.replaySample; i++) {
          const file = join(dir, `game-${i}.json`)
          writeFileSync(file, JSON.stringify({ version: 1, steps: [], pairing: p, index: i }))
          replays.push({
            gameId: `0000000${i}-0000-0000-0000-00000000000${p}`,
            index: i,
            seed: String(pairing.seed + i),
            file,
            winner: 'a',
          })
        }
      }
      return {
        seed: pairing.seed,
        winsA,
        winsB: games - winsA,
        ties: 0,
        games,
        turns: games * 10,
        replays,
        ...(job.perGame
          ? {
              perGame: {
                winners: 'A'.repeat(winsA) + 'B'.repeat(games - winsA),
                starters: 'AB'.repeat(games).slice(0, games),
                endings: 'P'.repeat(games),
                turns: Array.from({ length: games }, () => 10),
                stagesA: '1'.repeat(games),
                stagesB: '0'.repeat(games),
              },
            }
          : {}),
      }
    })
    writeFileSync(
      resultFile,
      JSON.stringify({ engineRev: REV, cliVersion: '0.1.0-fake', players: job.players, durationMs: 900, pairings }),
    )
  }
} else if (command === 'regulate') {
  // The CPU regulator: 20 logical processors, 2 less for each managed engine (a stand-in for the others' load).
  const heard = (line) => process.env.FAKE_REGULATE_LOG && appendFileSync(process.env.FAKE_REGULATE_LOG, `${line}\n`)
  heard(`start ${process.argv.slice(3).join(' ')}`)
  if (process.env.FAKE_REGULATE_PID) writeFileSync(process.env.FAKE_REGULATE_PID, String(process.pid))
  // FAKE_REGULATE_FAIL: a machine it cannot run on (an input error, exit 2, as engine-cli says it).
  if (process.env.FAKE_REGULATE_FAIL) {
    const error = { error: 'la máquina tiene más de un grupo de procesadores (más de 64 lógicos)', code: 'bad_input' }
    process.stdout.write(`${JSON.stringify(error)}\n`)
    process.stderr.write('fin error 2\n')
    process.exit(2)
  }
  // FAKE_REGULATE_SILENT: it never says its first line (hung while starting).
  if (!process.env.FAKE_REGULATE_SILENT) {
    process.stdout.write('regulador 20 logicos 12 nucleos (4 eficientes) maximo 20 piso 2\n')
  }
  const managed = new Set()
  let buffer = ''
  process.stdin.setEncoding('utf8').on('data', (data) => {
    buffer += data
    let at = buffer.indexOf('\n')
    while (at >= 0) {
      const line = buffer.slice(0, at).trim()
      buffer = buffer.slice(at + 1)
      at = buffer.indexOf('\n')
      heard(line)
      const [verb, pid, kind] = line.split(' ')
      if (process.env.FAKE_REGULATE_CRASH && verb === 'add') process.exit(1)
      // FAKE_REGULATE_DEAF: hung, it reads the lines but answers nothing.
      if (verb === 'ping') {
        if (!process.env.FAKE_REGULATE_DEAF) process.stdout.write('pong\n')
        continue
      }
      // PID 1 is never one of our engines.
      if (verb === 'add' && pid === '1') process.stdout.write('aviso 1 no es un motor: no lo toco\n')
      if (verb === 'add' && kind === 'managed') managed.add(pid)
      if (verb === 'remove') managed.delete(pid)
      const allowed = 20 - 2 * managed.size
      process.stdout.write(`permitido ${allowed} de 20 ajena ${(20 - allowed).toFixed(1)} mascara fffff\n`)
    }
  })
  process.stdin.on('end', () => {
    heard('end')
    // FAKE_REGULATE_HANG: it does not end when its stdin does.
    if (process.env.FAKE_REGULATE_HANG) {
      setInterval(() => {}, 1000)
      return
    }
    process.stdout.write('regulador terminado\n')
    process.exit(0)
  })
} else if (command === 'status') {
  process.stdout.write(
    JSON.stringify([
      { id: 'A1 001', name: 'Bulbasaur', status: 'implemented', complete: true },
      { id: 'B4b 198', name: 'Lucky Ice Pop', status: 'missing', complete: false },
    ]),
  )
} else if (command === 'simulate' || command === 'optimize') {
  const job = JSON.parse(readFileSync(jobFile, 'utf8'))
  // FAKE_ENGINE_HOLD_PIPES=<ms>: a process it leaves behind keeps its stdout and stderr open that long after it ends
  // (its 'close' comes that much after its 'exit').
  if (process.env.FAKE_ENGINE_HOLD_PIPES) {
    const ms = Number(process.env.FAKE_ENGINE_HOLD_PIPES)
    spawn(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`], {
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: true,
    }).unref()
  }
  const games = command === 'simulate' ? job.games : 4
  // B of H-054 (`resume`): 89 games are cut at their first run (exit 0, no result, 40 games in the checkpoint) and
  // played to the end by a run that finds them there; 88 are cut every time; 87 are cut and their folder goes; 86 are
  // cut and their job.json becomes a folder (the next run cannot write it); 85 are killed with SIGKILL at their first
  // run, as Android's low memory killer would, and 84 every time (review of #104).
  if ([89, 88, 87, 86, 85, 84].includes(games) && job.checkpoint) {
    let kept = 0
    try {
      kept = readFileSync(job.checkpoint, 'utf8').split('\n').filter(Boolean).length - 1
    } catch {
      // no checkpoint yet
    }
    if (games === 88 || games === 84 || kept <= 0) {
      const lines = Array.from({ length: 40 }, (_, i) => `${i} A0P 10 11 ${i}`)
      writeFileSync(job.checkpoint, `# fake\n${lines.join('\n')}\n`)
      process.stderr.write(`total ${games}\n`)
      for (let i = 1; i <= 40; i++) process.stderr.write(`progress ${i}\n`)
      if (games === 87) rmSync(dirname(jobFile), { recursive: true, force: true })
      if (games === 86) {
        rmSync(jobFile, { force: true })
        mkdirSync(jobFile)
      }
      if (games === 85 || games === 84) process.kill(process.pid, 'SIGKILL')
      process.exit(0)
    }
  }
  // A process that exits successfully but violates the file-output contract.
  if (games === 96) process.exit(0)
  // The S25 of 12/10/2026: part of the games played, then exit 0 with no result (the last progress short of the total).
  if (games === 92) {
    process.stderr.write('total 92\n')
    for (let i = 1; i <= 60; i++) process.stderr.write(`progress ${i}\n`)
    // Nothing after this runs: the process ends from the timer.
    await new Promise(() => setTimeout(() => process.exit(0), 300))
  }
  // engine-cli 0.3.7 says how it ended: here a normal end whose result.json is not there.
  if (games === 91) {
    process.stderr.write('total 91\nprogress 91\nfin ok\n')
    process.exit(0)
  }
  // The same, with its last line in two pieces a while apart (a pipe can split any line).
  if (games === 90) {
    process.stderr.write('total 90\nprogress 90\nfin o')
    await new Promise((done) => setTimeout(done, 150))
    process.stderr.write('k\n')
    process.exit(0)
  }
  if (games === 94 || games === 93) {
    writeFileSync(resultFile, games === 94 ? '{incomplete' : 'null')
    process.exit(0)
  }
  // A kill by the OS must never be confused with successful exit.
  if (games === 95) process.kill(process.pid, 'SIGKILL')
  if (games === 13) {
    process.stdout.write(JSON.stringify({ error: 'deck inválido', code: 'bad_deck', detail: { deck: 'A' } }))
    process.exit(3)
  }
  process.stderr.write(`total ${games}\n`)
  if (games === 99) setInterval(() => process.stderr.write('progress 1\n'), 50)
  // games 98 → hangs without printing anything (watchdog tests, H-014).
  else if (games === 98) setInterval(() => {}, 1000)
  else {
    for (let i = 1; i <= games; i++) process.stderr.write(`progress ${i}\n`)
    if (command === 'simulate') {
      const replays = []
      if (job.replaySample > 0) {
        mkdirSync(job.replayDir, { recursive: true })
        for (let i = 0; i < job.replaySample; i++) {
          const file = join(job.replayDir, `game-${i}.json`)
          writeFileSync(file, JSON.stringify({ version: 1, steps: [], index: i }))
          replays.push({
            gameId: `0000000${i}-0000-0000-0000-000000000000`,
            index: i,
            seed: String(job.seed + i),
            file,
            winner: 'a',
          })
        }
      }
      const winsA = Math.ceil(games / 2)
      // perGame (H-010): A wins the first half, B the rest; FAKE_ENGINE_OLD plays an engine that ignores the flag.
      const perGame =
        job.perGame && !process.env.FAKE_ENGINE_OLD
          ? {
              perGame: {
                winners: 'A'.repeat(winsA) + 'B'.repeat(games - winsA),
                starters: 'AB'.repeat(games).slice(0, games),
                endings: 'P'.repeat(games),
                turns: Array.from({ length: games }, () => 10),
                stagesA: '1'.repeat(games),
                stagesB: '0'.repeat(games),
              },
            }
          : {}
      writeFileSync(
        resultFile,
        JSON.stringify({
          engineRev: REV,
          cliVersion: '0.1.0-fake',
          build: '0123456789abcdef',
          players: job.players,
          seed: job.seed,
          winsA,
          winsB: games - winsA,
          ties: 0,
          games,
          turns: games * 10,
          durationMs: 5,
          replays,
          ...perGame,
        }),
      )
    } else {
      writeFileSync(
        resultFile,
        JSON.stringify({
          engineRev: REV,
          durationMs: 5,
          combinations: [
            { cards: ['A1 001'], winsA: 1, winsB: 1, ties: 0, games: 2, turns: 20 },
            { cards: ['A1 002'], winsA: 2, winsB: 0, ties: 0, games: 2, turns: 18 },
          ],
        }),
      )
    }
  }
} else if (command === 'consistency') {
  const job = JSON.parse(readFileSync(jobFile, 'utf8'))
  process.stderr.write(`total ${job.games}
`)
  const half = Math.floor(job.games / 2)
  const histogram = (games) => ({
    games,
    firstOnTurn: [0, Math.floor(games / 2), games - Math.floor(games / 2) - 1],
    never: 1,
  })
  const split = { first: histogram(half), second: histogram(job.games - half) }
  const rivals = job.rivals ?? []
  writeFileSync(
    resultFile,
    JSON.stringify({
      engineRev: REV,
      ...(process.env.FAKE_ENGINE_OLD ? {} : { mode: rivals.length > 0 ? 'meta' : 'goldfish', rivals: rivals.length }),
      games: job.games,
      keyCards: job.keyCards,
      ready: split,
      attack: split,
      durationMs: 7,
    }),
  )
} else if (command === 'play') {
  // Two decisions of two options each; the winner depends on the owner's choices (both 1 → «you»).
  const job = JSON.parse(readFileSync(jobFile, 'utf8'))
  if (process.env.FAKE_ENGINE_HOLD_PIPES) {
    const ms = Number(process.env.FAKE_ENGINE_HOLD_PIPES)
    spawn(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`], {
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: true,
    }).unref()
  }
  // An engine that fails before playing and only says how it ended (engine-cli 0.3.7).
  if (Number(job.seed) === 404) {
    process.stderr.write('fin error 2\n')
    process.exit(2)
  }
  const say = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
  const state = { turn: 1, current_player: 0, points: [0, 0], players: [], stadium: null }
  const options = [
    { i: 0, text: 'EndTurn', action: 'EndTurn' },
    { i: 1, text: 'Attack(Vine Whip)', action: { Attack: { title: 'Vine Whip' } } },
  ]
  say({ type: 'start', seed: String(job.seed), you: 0, bot: job.bot })
  say({ type: 'action', ply: 0, turn: 0, actor: 1, forced: true, text: 'Place', action: 'EndTurn', ctx: {} })
  const choices = []
  let ply = 0
  const ask = () => {
    ply++
    // Modo entrenador: scores for each option, unless the seed plays an engine built before the coach (666).
    const coach = job.coach && job.seed !== 666 ? { coach: { scores: [-120.5, 30], best: 1 } } : {}
    say({ type: 'decide', ply, turn: ply, state, actions: options, ...coach })
  }
  ask()
  let buffer = ''
  process.stdin.setEncoding('utf8').on('data', (data) => {
    buffer += data
    let at = buffer.indexOf('\n')
    while (at >= 0) {
      const line = buffer.slice(0, at)
      buffer = buffer.slice(at + 1)
      at = buffer.indexOf('\n')
      const i = JSON.parse(line).i
      choices.push(i)
      say({
        type: 'action',
        ply,
        turn: ply,
        actor: 0,
        forced: false,
        text: options[i].text,
        action: options[i].action,
        ctx: {},
      })
      if (ply < 2) ask()
      else {
        mkdirSync(job.replayDir, { recursive: true })
        const replay = join(job.replayDir, 'game.json')
        writeFileSync(replay, JSON.stringify({ version: 1, steps: [], choices }))
        say({ type: 'end', winner: choices.every((c) => c === 1) ? 'you' : 'bot', turns: 4, state, replay })
        process.exit(0)
      }
    }
  })
} else {
  process.stdout.write(JSON.stringify({ error: `comando desconocido ${command}` }))
  process.exit(2)
}
