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
} else {
  process.stdout.write(JSON.stringify({ error: `comando desconocido ${command}` }))
  process.exit(2)
}
