// Tests de pantallas (T-015): a stand-in for the engine of the browser, with the exports wasm-bindgen gives
// engine/wasm (default init, engineInfo, LiveGame). Like apps/worker/test/fake-engine.mjs's `play`: two decisions of
// two options each; attacking both times wins. Served as /engine/ by navegador.spec.ts; the real engine is checked by
// engine/wasm/smoke.mjs.
const REV = 'fb792ebfbaca995af9750c28101ce92a51282825'
const STATE = { turn: 1, current_player: 0, points: [0, 0], players: [], stadium: null }
const OPTIONS = [
  { i: 0, text: 'EndTurn', action: 'EndTurn' },
  { i: 1, text: 'Attack(Vine Whip)', action: { Attack: { title: 'Vine Whip' } } },
]

export default async function init() {}

export function engineInfo() {
  return JSON.stringify({ engineRev: REV, version: 'fake' })
}

export class LiveGame {
  constructor(job) {
    this.job = JSON.parse(job)
    this.ply = 0
    this.choices = []
    this.pending = false
    this.ended = null
  }

  info() {
    return JSON.stringify({ type: 'start', engineRev: REV, seed: this.job.seed, you: 0, bot: this.job.bot })
  }

  decide(log) {
    return JSON.stringify({ type: 'decide', ply: this.ply, turn: this.ply, state: STATE, actions: OPTIONS, log })
  }

  advance(choice) {
    if (this.ended) return JSON.stringify({ ...this.ended, log: [] })
    const log = []
    if (choice === undefined || choice === null) {
      if (this.pending) return this.decide(log)
      log.push({ ply: 0, turn: 0, actor: 1, forced: true, text: 'Place', action: 'EndTurn', ctx: {} })
    } else {
      if (!this.pending) throw new Error('no hay ninguna decisión pendiente')
      if (choice > 1) throw new Error('elegí un número de 0 a 1')
      this.pending = false
      this.choices.push(choice)
      const option = OPTIONS[choice]
      log.push({
        ply: this.ply,
        turn: this.ply,
        actor: 0,
        forced: false,
        text: option.text,
        action: option.action,
        ctx: {},
      })
    }
    if (this.ply < 2) {
      this.ply += 1
      this.pending = true
      return this.decide(log)
    }
    this.ended = { type: 'end', winner: this.choices.every((c) => c === 1) ? 'you' : 'bot', turns: 4, state: STATE }
    return JSON.stringify({ ...this.ended, log })
  }

  coach() {
    return JSON.stringify({ scores: [-120.5, 30], best: 1, values: [-120.5, 30] })
  }

  restoreCoach() {}

  replay() {
    return this.ended ? JSON.stringify({ version: 1, steps: [], choices: this.choices }) : undefined
  }

  free() {}
}
