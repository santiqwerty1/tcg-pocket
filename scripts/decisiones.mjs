#!/usr/bin/env node
// docs/REVISION.md, «Decisiones sin conflictos»: un PR deja sus decisiones sin número en
// docs/decisiones/pendientes/<rama>.md (frontmatter `seccion:` y filas `| decisión | motivo |`). Al integrar, este
// script las numera y las pasa a docs/DECISIONES.md, y borra el pendiente:
// - en una sección que ya existe (`## <seccion>`, el título exacto), las filas van después de su última fila
//   numerada, con el bloque de esa fila (40, 45…) y el número siguiente al mayor de ese bloque en todo el archivo
//   (varias secciones comparten bloque);
// - una sección nueva va al final, con el bloque siguiente al mayor del archivo, desde .1; solo si el pendiente lo
//   pide con `nueva: true` (un título mal copiado no crea una sección: falla y dice cuál se parece);
// - varios pendientes de la misma sección se numeran seguidos, en el orden de sus nombres.
// Si un pendiente está mal (sin `seccion:`, con algo que no es una fila de dos celdas, una fila con número o una que
// ya está en DECISIONES), no aplica ninguno. Con --check solo dice qué haría (la CI lo corre en cada PR).
//
//   node scripts/decisiones.mjs [--check] [--root <carpeta del repo>]
import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const NUMBERED = /^\|\s*(\d+)\.(\d+)\s*\|/
const HEADER = '| # | Decisión | Motivo |'
const SEPARATOR = '|---|---|---|'
const IS_SEPARATOR = /^\|[\s:|-]+\|$/

/** The cells of a table row: the text between unescaped «|» (GitHub splits on them even inside backticks). */
const cells = (row) => row.split(/(?<!\\)\|/).slice(1, -1)

/** A title as a person would compare it: no leading «#», no accents, no case, single spaces. */
const loose = (title) =>
  title
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/^#+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

const exact = (title) => title.normalize('NFC').replace(/\s+/g, ' ').trim()

/** A pending file: its section, whether it may create it, and its rows; or why it cannot be applied. */
export function parsePending(name, text) {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n/g, '\n')
  const front = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  if (!front) return { name, error: 'falta el frontmatter (--- seccion: … ---)' }
  const field = (key) => new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, 'm').exec(front[1] ?? '')?.[1] ?? ''
  const section = field('seccion')
    .replace(/^(["'])(.*)\1$/, '$2')
    .trim()
  if (!section) return { name, error: 'falta `seccion:` en el frontmatter, o está vacío' }
  if (/^[>|]$/.test(section)) return { name, error: '`seccion:` va en una sola línea' }
  const create = /^(true|sí|si)$/i.test(field('nueva'))
  const rows = []
  const lines = normalized.slice(front[0].length).split('\n')
  for (const [at, raw] of lines.entries()) {
    const line = raw.trim()
    if (line === '') continue
    if (!line.startsWith('|')) return { name, error: `algo que no es una fila de la tabla: ${line.slice(0, 60)}` }
    if (IS_SEPARATOR.test(line)) continue
    // A header: the row right before a separator.
    if (IS_SEPARATOR.test(lines[at + 1]?.trim() ?? '')) continue
    if (!line.endsWith('|')) return { name, error: `una fila no termina en «|»: ${line.slice(0, 60)}` }
    if (NUMBERED.test(line)) return { name, error: `una fila ya tiene número: ${line.slice(0, 60)}` }
    const count = cells(line).length
    if (count !== 2 || cells(line).some((cell) => cell.trim() === '')) {
      return {
        name,
        error: `una fila tiene que tener dos celdas con texto, decisión y motivo (tiene ${count}; un «|» dentro del texto va como «\\|»): ${line.slice(0, 60)}`,
      }
    }
    rows.push(line)
  }
  if (rows.length === 0) return { name, error: 'no tiene filas' }
  return { name, section, create, rows }
}

/** The sections of DECISIONES (title, lines, table header) and the highest number of each block. */
function survey(lines) {
  const sections = []
  const highest = new Map()
  let fenced = false
  for (const [at, line] of lines.entries()) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    if (fenced) continue
    if (line.startsWith('## ')) {
      const previous = sections.at(-1)
      if (previous) previous.end = at
      sections.push({ title: line.slice(3), start: at, end: lines.length, lastRow: null, block: null, header: null })
      continue
    }
    const section = sections.at(-1)
    if (section && /^\|\s*#\s*\|/.test(line)) section.header = line.trim()
    const number = NUMBERED.exec(line)
    if (number) {
      const block = Number(number[1])
      highest.set(block, Math.max(highest.get(block) ?? 0, Number(number[2])))
      if (section) {
        section.lastRow = at
        section.block = block
      }
    }
  }
  const topBlock = Math.max(0, ...highest.keys())
  return { sections, highest, topBlock }
}

/** The text of a row without its number, to find a row DECISIONES already has. */
const body = (row) => row.replace(NUMBERED, '|').replace(/\s+/g, ' ').trim()

/**
 * The text of DECISIONES with the pending rows numbered and in their sections, and what was done with each pending
 * file (in order); or the reasons it cannot be done (nothing applied).
 */
export function applyPending(text, pendings) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  let lines = text.replace(/\r\n/g, '\n').split('\n')
  const applied = []
  const errors = []
  const present = new Set(lines.filter((line) => NUMBERED.test(line)).map(body))
  for (const pending of pendings) {
    const { sections, highest, topBlock } = survey(lines)
    const matches = sections.filter((item) => exact(item.title) === exact(pending.section))
    if (matches.length > 1) {
      errors.push(`${pending.name}: hay ${matches.length} secciones «${pending.section}»`)
      continue
    }
    const section = matches[0]
    if (!section && !pending.create) {
      const near = sections.filter((item) => {
        const a = loose(item.title)
        const b = loose(pending.section)
        return a === b || a.startsWith(b) || b.startsWith(a)
      })
      errors.push(
        near.length > 0
          ? `${pending.name}: no hay una sección «${pending.section}»; ¿quisiste decir ${near.map((item) => `«${item.title}»`).join(' o ')}?`
          : `${pending.name}: no hay una sección «${pending.section}»; para crearla, \`nueva: true\` en el frontmatter`,
      )
      continue
    }
    if (section?.header && section.header !== HEADER) {
      errors.push(`${pending.name}: la tabla de «${section.title}» no es de decisiones (${section.header})`)
      continue
    }
    const repeated = pending.rows.filter((row) => present.has(body(row)))
    if (repeated.length > 0) {
      errors.push(
        `${pending.name}: ${repeated.length} fila(s) ya están en DECISIONES (¿quedó de una corrida anterior?)`,
      )
      continue
    }
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
    for (const row of pending.rows) present.add(body(row))
    applied.push({
      name: pending.name,
      section: pending.section,
      created: !section,
      from: `${block}.${first}`,
      to: `${block}.${first + pending.rows.length - 1}`,
    })
  }
  if (errors.length > 0) return { errors }
  return { text: lines.join('\n').replace(/\n/g, eol), applied, errors: [] }
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
  if (!existsSync(file)) {
    console.error(`✗ No encuentro ${file}: ¿--root es la carpeta del repo?`)
    return 1
  }
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
  const broken = pendings.filter((pending) => pending.error).map((pending) => `${pending.name}: ${pending.error}`)
  const result = broken.length > 0 ? { errors: broken } : applyPending(readFileSync(file, 'utf8'), pendings)
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`✗ ${error}`)
    console.error('No apliqué nada.')
    return 1
  }
  for (const item of result.applied) {
    const range = item.from === item.to ? item.from : `${item.from}–${item.to}`
    console.log(`${item.name} → «${item.section}»${item.created ? ' (sección nueva)' : ''}: ${range}`)
  }
  if (values.check) {
    console.log('(--check: no cambié nada)')
    return 0
  }
  // Through a temporary file: DECISIONES is either the old one or the new one. A pending that a failed delete leaves
  // behind is refused on the next run (its rows are already there), never applied twice.
  const temporary = `${file}.tmp-${process.pid}`
  writeFileSync(temporary, result.text)
  renameSync(temporary, file)
  for (const name of names) rmSync(join(folder, name))
  console.log(`DECISIONES.md actualizado; borré ${names.length} pendiente(s).`)
  return 0
}

/** True when this file is the one node was asked to run (also through a junction or a symbolic link). */
function invokedDirectly() {
  if (import.meta.main !== undefined) return import.meta.main
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (invokedDirectly()) process.exitCode = main()
