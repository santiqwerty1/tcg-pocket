#!/usr/bin/env node
// Seudónimos para los fixtures de Limitless (repo público, D-022): los jugadores de los standings y de las rondas
// guardados en docs/fase0/limitless/ pasan a «Jugador 001»… con un id «jugador-001»… y sin país. El mapeo es
// determinista (orden de aparición: PMPT #45 y después el NOEX) y el mismo en standings y en rondas, así que los
// cruces (quién jugó contra quién, con qué lista) siguen cerrando. Las listas, los récords y los puestos no cambian.
// Correrlo de nuevo no cambia nada: lo que ya es un seudónimo queda igual.
//
//   node scripts/pseudonymize-limitless.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(import.meta.dirname, '..', 'docs', 'fase0', 'limitless')
const TOURNAMENTS = ['big', 'noex']
const PSEUDONYM = /^jugador-\d{3,}$/

const read = (file) => JSON.parse(readFileSync(join(DIR, file), 'utf8'))
const write = (file, value) => writeFileSync(join(DIR, file), JSON.stringify(value))

const ids = new Map()
const pseudonym = (player) => {
  if (player === null || player === undefined || player === '') return player
  const key = String(player)
  if (PSEUDONYM.test(key)) return key
  if (!ids.has(key)) ids.set(key, `jugador-${String(ids.size + 1).padStart(3, '0')}`)
  return ids.get(key)
}
const displayName = (id) => `Jugador ${id.slice('jugador-'.length)}`

const standings = TOURNAMENTS.map((t) => read(`${t}_standings.json`))
const pairings = TOURNAMENTS.map((t) => read(`${t}_pairings.json`))
for (const rows of standings) for (const row of rows) pseudonym(row.player)
for (const rows of pairings) {
  for (const row of rows) {
    pseudonym(row.player1)
    pseudonym(row.player2)
  }
}

for (const [at, t] of TOURNAMENTS.entries()) {
  const rows = standings[at].map((row) => {
    const id = pseudonym(row.player)
    return { ...row, name: displayName(id), country: null, player: id }
  })
  write(`${t}_standings.json`, rows)
  const rounds = pairings[at].map((row) => {
    const out = { ...row, player1: pseudonym(row.player1) }
    if ('player2' in row) out.player2 = pseudonym(row.player2)
    // The winner is a player id, or 0 (tie) / -1 (double loss).
    if (typeof row.winner === 'string' && row.winner !== '0' && row.winner !== '-1') out.winner = pseudonym(row.winner)
    return out
  })
  write(`${t}_pairings.json`, rounds)
}
console.log(`${ids.size} jugadores con seudónimo`)
