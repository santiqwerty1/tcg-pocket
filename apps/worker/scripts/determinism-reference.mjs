// The determinism reference of a worker package (T-015, D-026): the same games played by the native reference
// engine, which every package's engine must reproduce exactly before it takes work (`--check-engine`).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DECK = `Energy: Psychic
2 Swablu A4a 64
2 Mega Altaria ex B1 102
1 Jirachi B1 106
2 Chingling B1 109
1 Indeedee ex B1 121
1 Altaria B1 197
1 Sabrina A1 225
2 Rocky Helmet A2 148
1 Cyrus A2 150
1 Mars A2 155
1 Poké Ball A2b 111
2 Professor's Research A4b 373
1 Copycat B1 225
2 Lisia B1 226`

/** Plays the reference games with `referenceEngine` (scratch files in `work`); returns `determinism.json`. */
export function determinismReference(referenceEngine, work) {
  const nativeVersion = JSON.parse(execFileSync(referenceEngine, ['version'], { encoding: 'utf8' }))
  const cases = []
  for (const bot of ['r', 'e2', 'f2']) {
    const job = {
      deckA: DECK,
      deckB: DECK,
      players: [bot, bot],
      seed: 20261010,
      games: 8,
      threads: 2,
      replaySample: 0,
      perGame: true,
    }
    const input = join(work, 'job.json')
    const output = join(work, 'result.json')
    writeFileSync(input, JSON.stringify(job))
    execFileSync(referenceEngine, ['simulate', input, output], { stdio: ['ignore', 'pipe', 'inherit'] })
    const { durationMs: _duration, replays: _replays, ...expected } = JSON.parse(readFileSync(output, 'utf8'))
    cases.push({ job, expected })
  }
  return { version: { engineRev: nativeVersion.engineRev, cliVersion: nativeVersion.cliVersion }, cases }
}
