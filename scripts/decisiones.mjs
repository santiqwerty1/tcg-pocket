#!/usr/bin/env node
// docs/REVISION.md, «Decisiones sin conflictos»: un PR deja sus decisiones sin número en
// docs/decisiones/pendientes/<rama>.md (frontmatter `seccion:` y filas `| decisión | motivo |`). Al integrar, este
// script las numera y las pasa a docs/DECISIONES.md, y borra el pendiente:
// - en una sección que ya existe (`## <seccion>`), las filas van después de su última fila numerada, con el bloque de
//   esa fila (40, 45…) y el número siguiente al mayor de ese bloque en todo el archivo (dos secciones comparten el 40 y
//   el 45);
// - una sección nueva va al final, con el bloque siguiente al mayor del archivo, desde .1;
// - varios pendientes de la misma sección se numeran seguidos, en el orden de sus nombres.
// Si un pendiente está mal (sin `seccion:`, sin filas, o con una fila que ya tiene número), no aplica ninguno.
// Con --check solo dice qué haría.
//
//   node scripts/decisiones.mjs [--check] [--root <carpeta del repo>]
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const NUMBERED = /^\|\s*(\d+)\.(\d+)\s*\|/
const HEADER = '| # | Decisión | Motivo |'
const SEPARATOR = '|---|---|---|'

/** A pending file: its section and its rows, or why it cannot be applied. */
export function parsePending(name, text) {
  const normalized = text.replace(/\r\n/g, '\n')
  const front = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  if (!front) return { name, error: 'falta el frontmatter (--- seccion: … ---)' }
  const section = /^seccion:\s*(.+?)\s*$/m.exec(front[1] ?? '')?.[1]?.replace(/^["']|["']$/g, '')
  if (!section) return { name, error: 'falta `seccion:` en el frontmatter' }
  const rows = []
  for (const raw of normalized.slice(front[0].length).split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('|')) continue
    if (/^\|[\s:|-]+\|$/.test(line)) continue // |---|---|
    if (/^\|\s*(#\s*\|\s*)?decisi[oó]n\s*\|/i.test(line)) continue // a header row
    if (NUMBERED.test(line)) return { name, error: `una fila ya tiene número: ${line.slice(0, 60)}` }
    if (!line.endsWith('|')) return { name, error: `una fila no termina en «|»: ${line.slice(0, 60)}` }
    rows.push(line)
  }
  if (rows.length === 0) return { name, error: 'no tiene filas' }
  return { name, section, rows }
}

const same = (a, b) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()

/** The sections of DECISIONES (title, first and last line) and the highest number of each block. */
function survey(lines) {
  const sections = []
  const highest = new Map()
  for (const [at, line] of lines.entries()) {
    if (line.startsWith('## ')) {
      const previous = sections.at(-1)
      if (previous) previous.end = at
      sections.push({ title: line.slice(3), start: at, end: lines.length, lastRow: null, block: null })
    }
    const number = NUMBERED.exec(line)
    if (number) {
      const block = Number(number[1])
      highest.set(block, Math.max(highest.get(block) ?? 0, Number(number[2])))
      const section = sections.at(-1)
      if (section) {
        section.lastRow = at
        section.block = block
      }
    }
  }
  const topBlock = Math.max(0, ...highest.keys())
  return { sections, highest, topBlock }
}

/**
 * The text of DECISIONES with the pending rows numbered and in their sections, and what was done with each pending
 * file (in order).
 */
export function applyPending(text, pendings) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  let lines = text.replace(/\r\n/g, '\n').split('\n')
  const applied = []
  for (const pending of pendings) {
    const { sections, highest, topBlock } = survey(lines)
    const section = sections.find((item) => same(item.title, pending.section))
    const block = section?.block ?? topBlock + 1
    const first = (highest.get(block) ?? 0) + 1
    const numbered = pending.rows.map((row, at) => `| ${block}.${first + at} | ${row.slice(1).trimStart()}`)
    if (section && section.lastRow !== null) {
      lines = [...lines.slice(0, section.lastRow + 1), ...numbered, ...lines.slice(section.lastRow + 1)]
    } else if (section) {
      // A section without a numbered table: one at its end.
      let end = section.end
      while (end > section.start + 1 && lines[end - 1].trim() === '') end--
      lines = [...lines.slice(0, end), '', HEADER, SEPARATOR, ...numbered, ...lines.slice(end)]
    } else {
      while (lines.length > 0 && lines.at(-1).trim() === '') lines.pop()
      lines = [...lines, '', `## ${pending.section}`, '', HEADER, SEPARATOR, ...numbered, '']
    }
    applied.push({
      name: pending.name,
      section: pending.section,
      created: !section,
      from: `${block}.${first}`,
      to: `${block}.${first + pending.rows.length - 1}`,
    })
  }
  return { text: lines.join('\n').replace(/\n/g, eol), applied }
}

function main() {
  const { values } = parseArgs({
    options: {
      check: { type: 'boolean', default: false },
      root: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  })
  if (values.help) {
    console.log('node scripts/decisiones.mjs [--check] [--root <carpeta del repo>]')
    return 0
  }
  const root = resolve(values.root ?? join(dirname(fileURLToPath(import.meta.url)), '..'))
  const file = join(root, 'docs', 'DECISIONES.md')
  const folder = join(root, 'docs', 'decisiones', 'pendientes')
  const names = existsSync(folder)
    ? readdirSync(folder)
        .filter((name) => name.endsWith('.md') && name !== 'LEEME.md')
        .sort()
    : []
  if (names.length === 0) {
    console.log('No hay decisiones pendientes.')
    return 0
  }
  const pendings = names.map((name) => parsePending(name, readFileSync(join(folder, name), 'utf8')))
  const broken = pendings.filter((pending) => pending.error)
  if (broken.length > 0) {
    for (const pending of broken) console.error(`✗ ${pending.name}: ${pending.error}`)
    console.error('No apliqué nada.')
    return 1
  }
  const { text, applied } = applyPending(readFileSync(file, 'utf8'), pendings)
  for (const item of applied) {
    const range = item.from === item.to ? item.from : `${item.from}–${item.to}`
    console.log(`${item.name} → «${item.section}»${item.created ? ' (sección nueva)' : ''}: ${range}`)
  }
  if (values.check) {
    console.log('(--check: no cambié nada)')
    return 0
  }
  writeFileSync(file, text)
  for (const name of names) rmSync(join(folder, name))
  console.log(`DECISIONES.md actualizado; borré ${names.length} pendiente(s).`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main()
