// A stand-in for engine-cli with the same command line, files, stderr progress and exit codes (engine/src/main.rs).
// Behaviour by job: games 13 → engine failure (exit 3); games 99 → plays forever (for cancel tests).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REV = 'fb792ebfbaca995af9750c28101ce92a51282825'
const [command, jobFile, resultFile] = process.argv.slice(2)

if (command === 'version') {
  process.stdout.write(JSON.stringify({ engineRev: REV, cliVersion: '0.1.0-fake', cards: 2 }))
} else if (command === 'status') {
  process.stdout.write(
    JSON.stringify([
      { id: 'A1 001', name: 'Bulbasaur', status: 'implemented', complete: true },
      { id: 'B4b 198', name: 'Lucky Ice Pop', status: 'missing', complete: false },
    ]),
  )
} else if (command === 'simulate' || command === 'optimize') {
  const job = JSON.parse(readFileSync(jobFile, 'utf8'))
  const games = command === 'simulate' ? job.games : 4
  if (games === 13) {
    process.stdout.write(JSON.stringify({ error: 'deck inválido', code: 'bad_deck', detail: { deck: 'A' } }))
    process.exit(3)
  }
  process.stderr.write(`total ${games}\n`)
  if (games === 99) setInterval(() => process.stderr.write('progress 1\n'), 50)
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
      writeFileSync(
        resultFile,
        JSON.stringify({
          engineRev: REV,
          cliVersion: '0.1.0-fake',
          players: job.players,
          seed: job.seed,
          winsA,
          winsB: games - winsA,
          ties: 0,
          games,
          turns: games * 10,
          durationMs: 5,
          replays,
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
  writeFileSync(
    resultFile,
    JSON.stringify({
      engineRev: REV,
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
    say({ type: 'decide', ply, turn: ply, state, actions: options })
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
